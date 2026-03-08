import { supabaseAdmin } from "@/lib/supabase-admin";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export interface AgentRunInput {
  userId?: string | null;
  agentName: string;
  input: Record<string, JsonValue>;
  traceId?: string;
  idempotencyKey?: string;
  requestId?: string;
  releaseId?: string;
  campaignId?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
}

export interface AgentRunExecutionResult<T> {
  value: T;
  output?: Record<string, JsonValue> | JsonValue[];
  tokensUsed?: number;
  costCents?: number;
}

export interface AgentRunSuccess<T> {
  ok: true;
  value: T;
  attempts: number;
  durationMs: number;
  tokensUsed: number;
  costCents: number;
}

export interface AgentRunFailure {
  ok: false;
  attempts: number;
  durationMs: number;
  error: string;
}

export type AgentRunResult<T> = AgentRunSuccess<T> | AgentRunFailure;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function safeJson(
  value: Record<string, JsonValue> | JsonValue[] | JsonValue
): Record<string, JsonValue> | JsonValue[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value as Record<string, JsonValue>;
  return { value };
}

function buildRunInput(meta: AgentRunInput) {
  return {
    ...meta.input,
    trace_id: meta.traceId ?? null,
    idempotency_key: meta.idempotencyKey ?? null,
    request_id: meta.requestId ?? null,
    release_id: meta.releaseId ?? null,
    campaign_id: meta.campaignId ?? null,
  };
}

export async function runAgentWithResilience<T>(
  meta: AgentRunInput,
  execute: (attempt: number) => Promise<AgentRunExecutionResult<T>>
): Promise<AgentRunResult<T>> {
  const maxAttempts = meta.maxAttempts ?? 3;
  const baseDelayMs = meta.baseDelayMs ?? 500;
  const startedAt = Date.now();
  let attempts = 0;
  let lastError = "Unknown error";

  while (attempts < maxAttempts) {
    attempts += 1;
    const attemptStart = Date.now();

    try {
      const result = await execute(attempts);
      const durationMs = Date.now() - startedAt;

      await supabaseAdmin.from("agent_runs").insert({
        user_id: meta.userId ?? null,
        agent_name: meta.agentName,
        input: safeJson(buildRunInput(meta)),
        output: safeJson(
          result.output ?? {
            ok: true,
            attempt: attempts,
            value: result.value as unknown as JsonValue,
          }
        ),
        duration_ms: durationMs,
        tokens_used: result.tokensUsed ?? 0,
        cost_cents: result.costCents ?? 0,
        status: "completed",
        error: null,
      });

      return {
        ok: true,
        value: result.value,
        attempts,
        durationMs,
        tokensUsed: result.tokensUsed ?? 0,
        costCents: result.costCents ?? 0,
      };
    } catch (error) {
      lastError = normalizeError(error);
      const delay = baseDelayMs * Math.pow(2, attempts - 1);

      console.error("[agent-runner] attempt failed", {
        agentName: meta.agentName,
        attempt: attempts,
        maxAttempts,
        traceId: meta.traceId,
        durationMs: Date.now() - attemptStart,
        error: lastError,
      });

      if (attempts < maxAttempts) {
        await wait(delay);
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  await supabaseAdmin.from("agent_runs").insert({
    user_id: meta.userId ?? null,
    agent_name: meta.agentName,
    input: safeJson(buildRunInput(meta)),
    output: {},
    duration_ms: durationMs,
    tokens_used: 0,
    cost_cents: 0,
    status: "failed",
    error: lastError,
  });

  return {
    ok: false,
    attempts,
    durationMs,
    error: lastError,
  };
}

