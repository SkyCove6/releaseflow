import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { PLANS, type PlanId } from "@/lib/stripe";
import { checkReleaseLimit, getPlanContext, type PlanContext } from "@/lib/plan-limits";
import { buildIdempotencyKey, buildTraceId } from "@/inngest/client";
import { emitLifecycleEvent } from "@/server/utils/events";
import { buildReleasePlan, type ReleasePlan } from "@/agents/release-agent";
import {
  type ReleaseStatus,
  normalizeReleaseStatus,
} from "@/lib/release-status";

async function resolvePlanContext(): Promise<PlanContext> {
  return getPlanContext();
}

type ReleaseRow = {
  id: string;
  title: string;
  type: "single" | "ep" | "album";
  release_date?: string | null;
  status: ReleaseStatus | "scheduled" | "published";
  metadata: Record<string, unknown> | null;
  artist_id: string;
  artists: {
    id: string;
    name: string;
    genre: string;
    user_id: string;
  } | null;
};

function appendPlanToMetadata(
  existing: Record<string, unknown> | null,
  plan: ReleasePlan,
  planId: string
) {
  const currentMetadata = existing ?? {};
  const planHistory = Array.isArray((currentMetadata as { plan_history?: unknown }).plan_history)
    ? (currentMetadata as { plan_history: Array<Record<string, unknown>> }).plan_history
    : [];
  const nextVersion = planHistory.length + 1;
  const nextEntry = {
    id: planId,
    version: nextVersion,
    status: "draft",
    ...plan,
  };
  return {
    ...currentMetadata,
    plan_history: [...planHistory, nextEntry],
    active_plan_id: planId,
    active_plan_version: nextVersion,
  };
}

export const planRouter = createTRPCRouter({
  current: protectedProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from("users")
      .select("plan_tier, stripe_customer_id")
      .eq("id", ctx.user.id)
      .single();

    const planId = (data?.plan_tier ?? "free") as PlanId;
    const plan = PLANS[planId];

    return {
      planId,
      name: plan.name,
      priceCents: plan.priceCents,
      limits: plan.limits,
      features: plan.features,
      hasStripeCustomer: Boolean(data?.stripe_customer_id),
    };
  }),

  releaseUsage: protectedProcedure.query(async ({ ctx }) => {
    return checkReleaseLimit(ctx.user.id);
  }),

  generatePlan: protectedProcedure
    .input(z.object({ releaseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: release, error } = await ctx.supabase
        .from("releases")
        .select(
          "id, title, type, release_date, status, metadata, artist_id, artists!inner(id, name, genre, user_id)"
        )
        .eq("id", input.releaseId)
        .single<ReleaseRow>();

      if (error) throw error;
      if (!release || !release.artists) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Release not found" });
      }
      if (release.artists.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your release" });
      }

      const releaseStatus = normalizeReleaseStatus(release.status);

      if (releaseStatus === "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot build plan from ${releaseStatus} release`,
        });
      }

      const plan = await buildReleasePlan({
        releaseId: release.id,
        releaseTitle: release.title,
        releaseType: release.type,
        releaseDate: release.release_date ?? undefined,
        artistName: release.artists.name,
        genre: release.artists.genre,
      });

      const planId = `${release.id}:plan:${plan.immutableVersion}`;
      const nextMetadata = appendPlanToMetadata(release.metadata, plan, planId);

      const nextStatus: ReleaseStatus = releaseStatus === "draft" ? "planned" : releaseStatus;
      const updatePayload: Record<string, unknown> = {
        metadata: nextMetadata,
      };
      if (nextStatus !== releaseStatus) updatePayload.status = nextStatus;

      const { data: updatedRelease, error: updateError } = await ctx.supabase
        .from("releases")
        .update(updatePayload)
        .eq("id", release.id)
        .select("*")
        .single();
      if (updateError) throw updateError;

      const planContext = await resolvePlanContext();
      return {
        releaseId: release.id,
        plan,
        planId,
        activePlanVersion: nextMetadata.active_plan_version,
        releaseStatus: nextStatus,
        planContext,
        release: updatedRelease,
      };
    }),

  getActivePlan: protectedProcedure
    .input(z.object({ releaseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: release } = await ctx.supabase
        .from("releases")
        .select("id, metadata, artists!inner(id, user_id)")
        .eq("id", input.releaseId)
        .single<{
          metadata: Record<string, unknown> | null;
          artists: { id: string; user_id: string };
        }>();

      if (!release || release.artists.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your release" });
      }

      const history =
        (release.metadata as { plan_history?: unknown })?.plan_history ?? [];
      if (!Array.isArray(history) || !history.length) {
        return null;
      }

      return history[history.length - 1];
    }),

  approveCampaign: protectedProcedure
    .input(z.object({ campaignId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: campaign, error } = await ctx.supabase
        .from("campaigns")
        .select(
          "id, release_id, releases!inner(id, title, type, status, artists!inner(id, name, genre, user_id) )"
        )
        .eq("id", input.campaignId)
        .single();

      if (error) throw error;
      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }

      const releaseRaw = campaign.releases as
        | {
            id: string;
            title: string;
            type: "single" | "ep" | "album";
            status: ReleaseStatus | "scheduled" | "published";
            artists:
              | { id: string; name: string; genre: string; user_id: string }
              | Array<{ id: string; name: string; genre: string; user_id: string }>;
          }
        | Array<{
            id: string;
            title: string;
            type: "single" | "ep" | "album";
            status: ReleaseStatus | "scheduled" | "published";
            artists:
              | { id: string; name: string; genre: string; user_id: string }
              | Array<{ id: string; name: string; genre: string; user_id: string }>;
          }>
        | null;
      const release = Array.isArray(releaseRaw) ? (releaseRaw[0] ?? null) : releaseRaw;
      const artistRaw = release?.artists;
      const artist = Array.isArray(artistRaw) ? (artistRaw[0] ?? null) : artistRaw;

      if (!release || !artist || artist.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your campaign" });
      }

      const releaseStatus = normalizeReleaseStatus(release.status);
      if (releaseStatus !== "planned") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Campaign approval is only allowed for planned releases`,
        });
      }

      const { error: updateError } = await ctx.supabase
        .from("campaigns")
        .update({ status: "active" })
        .eq("id", input.campaignId);
      if (updateError) throw updateError;

      const planContext = await resolvePlanContext();

      const basePayload = {
        userId: ctx.user.id,
        actorId: ctx.user.id,
        tenantId: ctx.user.id,
        resourceId: input.campaignId,
        idempotencyKey: buildIdempotencyKey("campaign", "approved", input.campaignId, release.id),
        traceId: buildTraceId("campaign"),
        requestId: buildIdempotencyKey("request", "campaign-approve", input.campaignId, release.id),
        planContext: {
          planId: planContext.planId,
          limits: { ...planContext.limits },
        },
      };

      const approvedResult = await emitLifecycleEvent("campaign/approved", {
        ...basePayload,
        campaignId: input.campaignId,
        releaseId: release.id,
        artistId: artist.id,
        title: release.title,
        releaseStatus,
        genre: artist.genre,
        releaseType: release.type,
        planContextJson: {
          releaseStatus,
          campaignId: input.campaignId,
        },
      });

      const pitchRequested = await emitLifecycleEvent("pitch/requested", {
        ...basePayload,
        campaignId: input.campaignId,
        releaseId: release.id,
        artistId: artist.id,
        releaseTitle: release.title,
        artistName: artist.name,
        genre: artist.genre ?? "",
        mood: ["organic", "editorial", "playlist"],
        targetPlaylistCount: 5,
      });

      const errors = [approvedResult, pitchRequested]
        .filter((item) => !item.ok)
        .map((item) => item.error)
        .filter((item): item is string => Boolean(item));

      return {
        ok: true,
        event_emit_failed: errors.length ? errors.join(" | ") : null,
      };
    }),

  requestPitches: protectedProcedure
    .input(z.object({ campaignId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: campaign, error } = await ctx.supabase
        .from("campaigns")
        .select("id, releases!inner(id, title, artists!inner(id, name, genre, user_id))")
        .eq("id", input.campaignId)
        .single();

      if (error) throw error;
      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }

      const releaseRaw = campaign.releases as
        | {
            id: string;
            title: string;
            artists:
              | { id: string; name: string; genre: string; user_id: string }
              | Array<{ id: string; name: string; genre: string; user_id: string }>;
          }
        | Array<{
            id: string;
            title: string;
            artists:
              | { id: string; name: string; genre: string; user_id: string }
              | Array<{ id: string; name: string; genre: string; user_id: string }>;
          }>
        | null;
      const release = Array.isArray(releaseRaw) ? (releaseRaw[0] ?? null) : releaseRaw;
      const artistRaw = release?.artists;
      const artist = Array.isArray(artistRaw) ? (artistRaw[0] ?? null) : artistRaw;

      if (!release || !artist || artist.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your campaign" });
      }

      const basePayload = {
        userId: ctx.user.id,
        actorId: ctx.user.id,
        tenantId: ctx.user.id,
        resourceId: input.campaignId,
        idempotencyKey: buildIdempotencyKey("campaign", "pitch-request", input.campaignId, release.id),
        traceId: buildTraceId("pitch"),
        requestId: buildIdempotencyKey("request", "campaign-pitch", input.campaignId, release.id),
      };

      const emitResult = await emitLifecycleEvent("pitch/requested", {
        ...basePayload,
        releaseId: release.id,
        artistId: artist.id,
        campaignId: input.campaignId,
        releaseTitle: release.title,
        artistName: artist.name,
        genre: artist.genre,
        mood: ["curated", "organic"],
      });

      return {
        ok: true,
        event_emit_failed: emitResult.ok ? null : emitResult.error,
      };
    }),

  requestAnalytics: protectedProcedure
    .input(z.object({ releaseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: release, error } = await ctx.supabase
        .from("releases")
        .select("id, title, status, artists!inner(id, name, genre, user_id)")
        .eq("id", input.releaseId)
        .single<{
          id: string;
          title: string;
          status: ReleaseStatus | "scheduled" | "published";
          artists: { id: string; name: string; genre: string; user_id: string };
        }>();

      if (error) throw error;
      const artistRaw = release?.artists;
      const artist = Array.isArray(artistRaw) ? (artistRaw[0] ?? null) : artistRaw;

      if (!release || !artist || artist.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your release" });
      }

      const releaseStatus = normalizeReleaseStatus(release.status);
      if (releaseStatus !== "active" && releaseStatus !== "completed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid release state" });
      }

      const start = new Date();
      const end = new Date();
      start.setDate(start.getDate() - 7);

      const emitResult = await emitLifecycleEvent("analytics/report.requested", {
        userId: ctx.user.id,
        actorId: ctx.user.id,
        tenantId: ctx.user.id,
        resourceId: input.releaseId,
        idempotencyKey: buildIdempotencyKey("analytics", "requested", input.releaseId, ctx.user.id),
        traceId: buildTraceId("analytics"),
        requestId: buildIdempotencyKey("request", "analytics", input.releaseId, ctx.user.id),
        releaseId: release.id,
        artistId: artist.id,
        title: release.title,
        artistName: artist.name,
        genre: artist.genre,
        dateRange: {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
        },
      });

      return {
        ok: true,
        event_emit_failed: emitResult.ok ? null : emitResult.error,
      };
    }),
});
