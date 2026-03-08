import { randomUUID } from "node:crypto";
import { Inngest, EventSchemas } from "inngest";
import type { ReleaseFlowEvent } from "./events";

export function buildIdempotencyKey(scope: string, ...parts: Array<string | number>): string {
  const normalized = parts
    .map((part) => String(part).trim().toLowerCase())
    .map((part) => part.replace(/\s+/g, "-"));
  return [scope, ...normalized].join(":");
}

export function buildTraceId(prefix = "trace"): string {
  return `${prefix}_${randomUUID()}`;
}

export function buildRequestId(scope: string, ...parts: Array<string | number>): string {
  return buildIdempotencyKey(`request:${scope}`, ...parts);
}

export function normalizeEventData<T>(name: string, data: T): T {
  return data;
}

export const inngest = new Inngest({
  id: "releaseflow",
  name: "ReleaseFlow",
  schemas: new EventSchemas().fromUnion<ReleaseFlowEvent>(),
});
