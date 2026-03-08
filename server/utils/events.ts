import { inngest } from "@/inngest/client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { ReleaseFlowEvent } from "@/inngest/events";
import { randomUUID } from "node:crypto";

export type LifecycleEventName = ReleaseFlowEvent["name"];
export type ReleaseFlowEventData<T extends LifecycleEventName> =
  Extract<ReleaseFlowEvent, { name: T }>["data"];

export interface EventEmitResult {
  ok: boolean;
  traceId: string;
  eventId?: string;
  error?: string;
}

const sendLifecycleEvent = inngest.send as unknown as (payload: {
  name: LifecycleEventName;
  data: ReleaseFlowEventData<LifecycleEventName>;
}) => Promise<{ ids?: string[] }>;

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

async function writeEventLog<T extends LifecycleEventName>(params: {
  name: T;
  data: ReleaseFlowEventData<T>;
  traceId: string;
  eventId?: string;
  status: "sent" | "failed";
  error?: string;
}) {
  await supabaseAdmin.from("event_logs").insert({
    event_name: params.name,
    payload: params.data,
    idempotency_key: params.data.idempotencyKey,
    trace_id: params.traceId,
    event_id: params.eventId ?? null,
    status: params.status,
    error: params.error ?? null,
    user_id: params.data.userId ?? null,
  });
}

export async function emitLifecycleEvent<T extends LifecycleEventName>(
  name: T,
  data: ReleaseFlowEventData<T>
): Promise<EventEmitResult> {
  const traceId = data.traceId ?? randomUUID();
  const eventData = { ...data, traceId } as ReleaseFlowEventData<T>;

  try {
    const result = await sendLifecycleEvent({
      name,
      data: eventData as ReleaseFlowEventData<LifecycleEventName>,
    });

    const eventId =
      Array.isArray(result?.ids) && result.ids.length > 0 ? (result.ids[0] ?? undefined) : undefined;

    await writeEventLog({
      name,
      data: eventData,
      traceId,
      eventId,
      status: "sent",
    });

    console.info("[event] emitted", {
      name,
      traceId,
      eventId,
      idempotencyKey: eventData.idempotencyKey,
      userId: eventData.userId,
      resourceId: eventData.resourceId,
    });

    return { ok: true, traceId, eventId };
  } catch (error) {
    const message = normalizeError(error);
    const eventId =
      Array.isArray((error as { ids?: string[] })?.ids) &&
      (error as { ids?: string[] }).ids?.length
        ? ((error as { ids: string[] }).ids[0] ?? undefined)
        : undefined;

    await writeEventLog({
      name,
      data: eventData,
      traceId,
      eventId,
      status: "failed",
      error: message,
    }).catch(() => undefined);

    await supabaseAdmin.from("agent_alerts").insert({
      agent_name: `lifecycle-event:${name}`,
      failure_count: 1,
      last_error: `Event ${name} failed: ${message}`,
      notified_at: new Date().toISOString(),
    }).catch(() => undefined);

    console.warn("[event] failed", {
      name,
      traceId,
      eventId,
      idempotencyKey: eventData.idempotencyKey,
      userId: eventData.userId,
      resourceId: eventData.resourceId,
      error: message,
    });

    return { ok: false, traceId, eventId, error: message };
  }
}

