import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { buildIdempotencyKey, buildTraceId } from "@/inngest/client";
import { sendTestEvent } from "@/lib/testing/send-test-event";

type Milestone = {
  id: string;
  date: string;
  platform: string;
  description: string;
  priority: "low" | "medium" | "high";
};

function normalizeDate(value?: string) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function extractMilestones(timeline: unknown): Milestone[] {
  if (Array.isArray(timeline)) {
    return timeline
      .map((item, index) => item as Record<string, unknown>)
      .map((item, index) => ({
        id: String(item.id ?? `m-${index + 1}`),
        date: normalizeDate(typeof item.date === "string" ? item.date : undefined),
        platform: String(item.platform ?? "instagram"),
        description: String(item.description ?? item.task ?? "Milestone"),
        priority:
          item.priority === "high" || item.priority === "low" || item.priority === "medium"
            ? item.priority
            : "medium",
      }));
  }

  if (timeline && typeof timeline === "object") {
    const data = timeline as Record<string, unknown>;
    if (Array.isArray(data.milestones)) {
      return extractMilestones(data.milestones);
    }
    if (Array.isArray(data.phases)) {
      return data.phases.flatMap((phase, phaseIndex) =>
        extractMilestones(
          (phase as Record<string, unknown>).milestones ?? [
            { id: `phase-${phaseIndex + 1}`, description: String((phase as Record<string, unknown>).name ?? "Phase"), platform: "instagram" },
          ]
        )
      );
    }
  }

  return [];
}

function toTimelineObject(original: unknown, milestones: Milestone[]) {
  if (original && typeof original === "object" && !Array.isArray(original)) {
    return { ...(original as Record<string, unknown>), milestones };
  }
  return { milestones };
}

export const campaignRouter = createTRPCRouter({
  byRelease: protectedProcedure
    .input(z.object({ releaseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: release, error: releaseError } = await ctx.supabase
        .from("releases")
        .select("id, title, type, status, artists!inner(id, name, user_id)")
        .eq("id", input.releaseId)
        .single();

      if (releaseError || !release) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Release not found" });
      }

      const artist = Array.isArray(release.artists) ? release.artists[0] : release.artists;
      if (!artist || artist.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your release" });
      }

      const { data: campaign, error: campaignError } = await ctx.supabase
        .from("campaigns")
        .select("id, release_id, status, strategy, timeline, kpi_targets, created_at, updated_at")
        .eq("release_id", input.releaseId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (campaignError) throw campaignError;

      return {
        release,
        campaign: campaign
          ? {
              ...campaign,
              milestones: extractMilestones(campaign.timeline),
            }
          : null,
      };
    }),

  updateMilestone: protectedProcedure
    .input(
      z.object({
        campaignId: z.string().uuid(),
        milestoneId: z.string().min(1),
        date: z.string().optional(),
        platform: z.string().min(1),
        description: z.string().min(1),
        priority: z.enum(["low", "medium", "high"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data: campaign, error } = await ctx.supabase
        .from("campaigns")
        .select("id, timeline, releases!inner(id, artists!inner(user_id))")
        .eq("id", input.campaignId)
        .single();
      if (error || !campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });

      const release = Array.isArray(campaign.releases) ? campaign.releases[0] : campaign.releases;
      const artist = release && Array.isArray(release.artists) ? release.artists[0] : release?.artists;
      if (!artist || artist.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your campaign" });
      }

      const milestones = extractMilestones(campaign.timeline);
      const next = milestones.map((item) =>
        item.id === input.milestoneId
          ? {
              ...item,
              date: normalizeDate(input.date),
              platform: input.platform,
              description: input.description,
              priority: input.priority,
            }
          : item
      );

      const { error: updateError } = await ctx.supabase
        .from("campaigns")
        .update({ timeline: toTimelineObject(campaign.timeline, next) })
        .eq("id", input.campaignId);
      if (updateError) throw updateError;

      return { ok: true };
    }),

  deleteMilestone: protectedProcedure
    .input(
      z.object({
        campaignId: z.string().uuid(),
        milestoneId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data: campaign, error } = await ctx.supabase
        .from("campaigns")
        .select("id, timeline, releases!inner(id, artists!inner(user_id))")
        .eq("id", input.campaignId)
        .single();
      if (error || !campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });

      const release = Array.isArray(campaign.releases) ? campaign.releases[0] : campaign.releases;
      const artist = release && Array.isArray(release.artists) ? release.artists[0] : release?.artists;
      if (!artist || artist.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your campaign" });
      }

      const milestones = extractMilestones(campaign.timeline);
      const next = milestones.filter((item) => item.id !== input.milestoneId);

      const { error: updateError } = await ctx.supabase
        .from("campaigns")
        .update({ timeline: toTimelineObject(campaign.timeline, next) })
        .eq("id", input.campaignId);
      if (updateError) throw updateError;

      return { ok: true };
    }),

  approve: protectedProcedure
    .input(z.object({ campaignId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: campaign, error } = await ctx.supabase
        .from("campaigns")
        .select(
          "id, release_id, status, releases!inner(id, title, type, status, artists!inner(id, name, genre, user_id))"
        )
        .eq("id", input.campaignId)
        .single();

      if (error || !campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }

      const release = Array.isArray(campaign.releases) ? campaign.releases[0] : campaign.releases;
      const artist = release && Array.isArray(release.artists) ? release.artists[0] : release?.artists;
      if (!release || !artist || artist.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your campaign" });
      }

      const { error: updateError } = await ctx.supabase
        .from("campaigns")
        .update({ status: "active" })
        .eq("id", input.campaignId);
      if (updateError) throw updateError;

      let eventEmitError: string | null = null;
      try {
        await sendTestEvent("campaign.approved", {
          userId: ctx.user.id,
          actorId: ctx.user.id,
          tenantId: ctx.user.id,
          resourceId: input.campaignId,
          idempotencyKey: buildIdempotencyKey("campaign", "approved", input.campaignId, release.id),
          traceId: buildTraceId("campaign-approval"),
          requestId: buildIdempotencyKey("request", "campaign", "approve", input.campaignId, release.id),
          campaignId: input.campaignId,
          releaseId: release.id,
          artistId: artist.id,
          title: release.title,
          releaseStatus: release.status,
          releaseType: release.type,
          genre: artist.genre ?? "",
        });
      } catch (eventError) {
        eventEmitError = eventError instanceof Error ? eventError.message : String(eventError);
      }

      return { ok: true, event_emit_failed: eventEmitError };
    }),
});

