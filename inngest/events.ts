/**
 * Typed event definitions for ReleaseFlow's Inngest event bus.
 *
 * Every event consumed or produced by an Inngest function must be listed here.
 * The EventSchemas type is passed to the Inngest client so all `inngest.send()`
 * and `step.waitForEvent()` calls are fully type-safe.
 */

import type { VoiceProfilerInput } from "@/agents/voice-profiler";
import type { ReleaseStatus } from "@/lib/release-status";

interface PlanContextPayload {
  planId: string;
  limits: Record<string, unknown>;
}

interface EventActorContext {
  /** User tied to this event resource. */
  userId: string;
  /** Explicit actor id to support service-initiated actions. */
  actorId: string;
  /** Tenant/workspace id for scoping; currently equals userId. */
  tenantId: string;
  /** Event-scoped resource id to make fan-out tracing easy. */
  resourceId: string;
  /** Stable business idempotency key for non-duplication. */
  idempotencyKey: string;
  /** Correlation key for observability across logs, retries and UI traces. */
  traceId: string;
  /** Optional plan snapshot at event creation time. */
  planContext?: PlanContextPayload;
  /** Optional request/job trace from orchestration layer. */
  requestId?: string;
  /** Attempt count for retry-safe tracing. */
  attempt?: number;
}

// ─── artist.* ─────────────────────────────────────────────────────────────

export interface ArtistCreatedEvent {
  name: "artist/created";
  data: EventActorContext & {
    artistId: string;
    artistName: string;
    genre: string;
    existingBio: string;
    socialPosts: string[];
    interviewExcerpts?: string[];
    songTitles?: string[];
  };
}

export interface ArtistVoiceProfileUpdatedEvent {
  name: "artist/voice-profile.updated";
  data: EventActorContext & {
    artistId: string;
    confidenceScore: number;
  };
}

// ─── release.* ────────────────────────────────────────────────────────────

export interface ReleaseCreatedEvent {
  name: "release/created";
  data: EventActorContext & {
    releaseId: string;
    artistId: string;
    artistName?: string;
    title: string;
    type: "single" | "ep" | "album";
    releaseDate?: string;
    status: ReleaseStatus;
  };
}

export interface ReleasePublishedEvent {
  name: "release/published";
  data: EventActorContext & {
    releaseId: string;
    artistId: string;
    artistName: string;
    title: string;
    releaseDate?: string;
    status: "active";
  };
}

// ─── campaign.* ───────────────────────────────────────────────────────────

export interface CampaignApprovedEvent {
  name: "campaign/approved";
  data: EventActorContext & {
    campaignId: string;
    releaseId: string;
    artistId: string;
    title: string;
    releaseStatus: ReleaseStatus;
    genre?: string;
    releaseType: "single" | "ep" | "album";
    planContextJson?: Record<string, unknown>;
  };
}

// ─── analytics.* ──────────────────────────────────────────────────────────

export interface AnalyticsReportRequestedEvent {
  name: "analytics/report.requested";
  data: EventActorContext & {
    releaseId: string;
    artistId: string;
    title: string;
    artistName: string;
    genre: string;
    dateRange: { start: string; end: string };
    /** Email address to send the HTML report to (optional). */
    reportEmail?: string;
  };
}

// ─── pitch.* ──────────────────────────────────────────────────────────────

export interface PitchRequestedEvent {
  name: "pitch/requested";
  data: EventActorContext & {
    releaseId: string;
    artistId: string;
    releaseTitle: string;
    artistName: string;
    campaignId: string;
    genre: string;
    mood: string[];
    targetPlaylistCount?: number;
    spotifyTrackId?: string;
    spotifyArtistId?: string;
  };
}

// ─── user.* ───────────────────────────────────────────────────────────────

export interface UserSignedUpEvent {
  name: "user/signed-up";
  data: EventActorContext & {
    userName: string;
    userEmail: string;
  };
}

// ─── blog.* ───────────────────────────────────────────────────────────────

export interface BlogPostGenerateRequestedEvent {
  name: "blog/post.generate-requested";
  data: EventActorContext & {
    topic?: string;
  };
}

// ─── agent.* ──────────────────────────────────────────────────────────────

export interface AgentManualTriggerEvent {
  name: "agent/manual-trigger";
  data: EventActorContext & {
    agentName: "voice-profiler" | "campaign-strategist" | "content-writer" | "playlist-pitcher";
    payload: Record<string, unknown>;
  };
}

// ─── Union & schema map ────────────────────────────────────────────────────

export type ReleaseFlowEvent =
  | ArtistCreatedEvent
  | ArtistVoiceProfileUpdatedEvent
  | ReleaseCreatedEvent
  | ReleasePublishedEvent
  | CampaignApprovedEvent
  | PitchRequestedEvent
  | AnalyticsReportRequestedEvent
  | UserSignedUpEvent
  | BlogPostGenerateRequestedEvent
  | AgentManualTriggerEvent;

/** Passed to `new Inngest({ schemas })` for end-to-end type safety. */
export type EventSchemas = {
  [E in ReleaseFlowEvent as E["name"]]: { data: E["data"] };
};

// Re-export for convenience
export type { VoiceProfilerInput };
