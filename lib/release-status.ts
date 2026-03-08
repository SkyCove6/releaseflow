import { z } from "zod";

export const RELEASE_STATUSES = ["draft", "planned", "active", "completed"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const RELEASE_STATUS_INPUTS = [...RELEASE_STATUSES, "scheduled", "published"] as const;
export type ReleaseStatusInput = (typeof RELEASE_STATUS_INPUTS)[number];
export type ReleaseStatusAlias = Exclude<ReleaseStatusInput, ReleaseStatus>;

export const RELEASE_STATUS_ALIASES: Record<ReleaseStatusAlias, ReleaseStatus> = {
  scheduled: "planned",
  published: "active",
};

export const RELEASE_STATUS_SET = new Set<ReleaseStatus>(RELEASE_STATUSES);

export const releaseStatusSchema = z.enum(RELEASE_STATUSES) as z.ZodType<ReleaseStatus>;
export const releaseStatusInputSchema = z.enum(RELEASE_STATUS_INPUTS);

export const RELEASE_STATUS_TRANSITIONS: Record<ReleaseStatus, readonly ReleaseStatus[]> = {
  draft: ["planned"],
  planned: ["active"],
  active: ["completed"],
  completed: [],
};

export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  active: "Active",
  completed: "Completed",
};

export const RELEASE_STATUS_CTA: Record<ReleaseStatus, string[]> = {
  draft: ["Build rollout plan"],
  planned: ["Approve plan", "Generate content"],
  active: ["Generate analytics"],
  completed: ["Review report"],
};

export function normalizeReleaseStatus(status: string): ReleaseStatus {
  if ((RELEASE_STATUSES as readonly string[]).includes(status)) {
    return status as ReleaseStatus;
  }

  if (status in RELEASE_STATUS_ALIASES) {
    return RELEASE_STATUS_ALIASES[status as ReleaseStatusAlias];
  }

  throw new Error(`Unsupported release status: ${status}`);
}

export function isReleaseStatus(value: string | null | undefined): value is ReleaseStatus {
  if (!value) return false;
  return RELEASE_STATUS_SET.has(value as ReleaseStatus);
}

export function canTransitionReleaseStatus(from: ReleaseStatus, to: ReleaseStatus): boolean {
  if (from === to) return true;
  return (RELEASE_STATUS_TRANSITIONS[from]?.includes(to)) ?? false;
}

export function releaseStatusLabel(status: ReleaseStatus): string {
  return RELEASE_STATUS_LABELS[status];
}

export function normalizeReleaseStatusForUpdate(status: ReleaseStatusInput): ReleaseStatus {
  return normalizeReleaseStatus(status);
}
