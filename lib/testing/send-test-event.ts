import { inngest } from "@/inngest/client";
import type { ReleaseFlowEvent } from "@/inngest/events";
import { supabaseAdmin } from "@/lib/supabase-admin";

type CanonicalEventName = ReleaseFlowEvent["name"];
type ExtendedEventName = CanonicalEventName | "content/approved" | "content/rejected";
type DotEventName =
  | "artist.created"
  | "release.created"
  | "campaign.approved"
  | "content.approved"
  | "content.rejected"
  | "pitch.requested"
  | "release.published"
  | "user.signed-up"
  | "analytics.report.requested";

const EVENT_ALIAS: Record<DotEventName, ExtendedEventName> = {
  "artist.created": "artist/created",
  "release.created": "release/created",
  "campaign.approved": "campaign/approved",
  "content.approved": "content/approved",
  "content.rejected": "content/rejected",
  "pitch.requested": "pitch/requested",
  "release.published": "release/published",
  "user.signed-up": "user/signed-up",
  "analytics.report.requested": "analytics/report.requested",
};

export interface SendTestEventResult {
  ids?: string[];
}

function normalizeEventName(name: CanonicalEventName | DotEventName): ExtendedEventName {
  if (name in EVENT_ALIAS) {
    return EVENT_ALIAS[name as DotEventName];
  }
  return name as CanonicalEventName;
}

export async function sendTestEvent(
  name: ExtendedEventName | DotEventName,
  data: Record<string, unknown>
): Promise<SendTestEventResult> {
  const normalized = normalizeEventName(name as CanonicalEventName | DotEventName) as ExtendedEventName;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (inngest.send as any)({
      name: normalized,
      data,
    });

    const payload = data as Record<string, unknown>;
    await supabaseAdmin.from("event_logs").insert({
      event_name: normalized,
      payload,
      status: "sent",
      event_id: Array.isArray(result?.ids) ? (result.ids[0] ?? null) : null,
      trace_id: typeof payload.traceId === "string" ? payload.traceId : null,
      idempotency_key:
        typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : null,
      user_id: typeof payload.userId === "string" ? payload.userId : null,
      error: null,
    });

    return result as SendTestEventResult;
  } catch (error) {
    const payload = data as Record<string, unknown>;
    await supabaseAdmin.from("event_logs").insert({
      event_name: normalized,
      payload,
      status: "failed",
      event_id: null,
      trace_id: typeof payload.traceId === "string" ? payload.traceId : null,
      idempotency_key:
        typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : null,
      user_id: typeof payload.userId === "string" ? payload.userId : null,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}
