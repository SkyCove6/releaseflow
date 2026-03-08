import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { buildIdempotencyKey, buildTraceId } from "@/inngest/client";
import { sendTestEvent } from "@/lib/testing/send-test-event";

const contentStatusSchema = z.enum(["draft", "approved", "scheduled", "published", "failed"]);
type ContentStatus = z.infer<typeof contentStatusSchema>;

const transitionMap: Record<ContentStatus, ContentStatus[]> = {
  draft: ["approved", "failed"],
  approved: ["scheduled", "published", "failed"],
  scheduled: ["published", "failed"],
  published: ["failed"],
  failed: ["draft"],
};

function canTransition(from: ContentStatus, to: ContentStatus) {
  if (from === to) return true;
  return transitionMap[from].includes(to);
}

function extractHashtags(body: string) {
  const matches = body.match(/#[a-zA-Z0-9_]+/g);
  return matches ?? [];
}

function extractCta(body: string) {
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /stream|listen|pre-save|save|follow|watch/i.test(line)) ?? "";
}

function buildStatusPatch(nextStatus: ContentStatus, scheduledAt?: string) {
  if (nextStatus === "scheduled") {
    return { status: nextStatus, scheduled_at: scheduledAt ?? new Date().toISOString(), published_at: null };
  }
  if (nextStatus === "published") {
    return { status: nextStatus, published_at: new Date().toISOString() };
  }
  return { status: nextStatus };
}

export const contentRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("content_items")
      .select(
        "id, campaign_id, platform, content_type, body, variants, status, scheduled_at, published_at, created_at, updated_at, campaigns!inner(id, release_id, releases!inner(id, title, artists!inner(id, name, user_id)))"
      )
      .eq("campaigns.releases.artists.user_id", ctx.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return (data ?? []).map((item) => ({
      ...item,
      hashtags: extractHashtags(String(item.body ?? "")),
      cta: extractCta(String(item.body ?? "")),
    }));
  }),

  update: protectedProcedure
    .input(
      z.object({
        contentId: z.string().uuid(),
        body: z.string().min(1),
        hashtags: z.array(z.string()).optional().default([]),
        cta: z.string().optional(),
        status: contentStatusSchema.optional(),
        scheduledAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data: row, error: fetchError } = await ctx.supabase
        .from("content_items")
        .select("id, status, variants, campaigns!inner(id, release_id, releases!inner(id, artists!inner(id, user_id)))")
        .eq("id", input.contentId)
        .single();
      if (fetchError || !row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Content item not found" });
      }

      const _c = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns;
      const campaign = Array.isArray(_c) ? _c[0] : _c;
      const _r = campaign && Array.isArray(campaign.releases) ? campaign.releases[0] : campaign?.releases;
      const release = Array.isArray(_r) ? _r[0] : _r;
      const _a = release && Array.isArray(release.artists) ? release.artists[0] : release?.artists;
      const artist = (Array.isArray(_a) ? _a[0] : _a) as { id: string; user_id: string } | undefined;
      if (!artist || artist.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your content item" });
      }

      const currentStatus = row.status as ContentStatus;
      const nextStatus = input.status ?? currentStatus;
      if (!canTransition(currentStatus, nextStatus)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid content status transition ${currentStatus} -> ${nextStatus}`,
        });
      }

      const variants = {
        ...(row.variants && typeof row.variants === "object" ? (row.variants as Record<string, unknown>) : {}),
        hashtags: input.hashtags,
        cta: input.cta ?? "",
      };

      const { error: updateError } = await ctx.supabase
        .from("content_items")
        .update({
          ...buildStatusPatch(nextStatus, input.scheduledAt),
          body: input.body,
          variants,
        })
        .eq("id", input.contentId);
      if (updateError) throw updateError;

      return { ok: true };
    }),

  approve: protectedProcedure
    .input(z.object({ contentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: row, error: fetchError } = await ctx.supabase
        .from("content_items")
        .select(
          "id, status, platform, content_type, body, campaigns!inner(id, release_id, releases!inner(id, title, artist_id, artists!inner(id, name, user_id)))"
        )
        .eq("id", input.contentId)
        .single();
      if (fetchError || !row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Content item not found" });
      }

      const _c = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns;
      const campaign = Array.isArray(_c) ? _c[0] : _c;
      const _r = campaign && Array.isArray(campaign.releases) ? campaign.releases[0] : campaign?.releases;
      const release = Array.isArray(_r) ? _r[0] : _r;
      const _a = release && Array.isArray(release.artists) ? release.artists[0] : release?.artists;
      const artist = (Array.isArray(_a) ? _a[0] : _a) as { id: string; user_id: string } | undefined;
      if (!campaign || !release || !artist || artist.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your content item" });
      }

      const currentStatus = row.status as ContentStatus;
      if (!canTransition(currentStatus, "approved")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot approve content from ${currentStatus}` });
      }

      const { error: updateError } = await ctx.supabase
        .from("content_items")
        .update(buildStatusPatch("approved"))
        .eq("id", input.contentId);
      if (updateError) throw updateError;

      let eventEmitError: string | null = null;
      try {
        await sendTestEvent("content.approved", {
          userId: ctx.user.id,
          actorId: ctx.user.id,
          tenantId: ctx.user.id,
          resourceId: input.contentId,
          idempotencyKey: buildIdempotencyKey("content", "approved", input.contentId, release.id),
          traceId: buildTraceId("content-approval"),
          requestId: buildIdempotencyKey("request", "content", "approve", input.contentId),
          contentId: input.contentId,
          campaignId: campaign.id,
          releaseId: release.id,
          artistId: release.artist_id,
          platform: row.platform,
          contentType: row.content_type,
        });
      } catch (eventError) {
        eventEmitError = eventError instanceof Error ? eventError.message : String(eventError);
      }

      return { ok: true, event_emit_failed: eventEmitError };
    }),

  reject: protectedProcedure
    .input(
      z.object({
        contentId: z.string().uuid(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data: row, error: fetchError } = await ctx.supabase
        .from("content_items")
        .select(
          "id, status, variants, platform, content_type, campaigns!inner(id, release_id, releases!inner(id, artist_id, artists!inner(id, user_id)))"
        )
        .eq("id", input.contentId)
        .single();
      if (fetchError || !row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Content item not found" });
      }

      const _c = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns;
      const campaign = Array.isArray(_c) ? _c[0] : _c;
      const _r = campaign && Array.isArray(campaign.releases) ? campaign.releases[0] : campaign?.releases;
      const release = Array.isArray(_r) ? _r[0] : _r;
      const _a = release && Array.isArray(release.artists) ? release.artists[0] : release?.artists;
      const artist = (Array.isArray(_a) ? _a[0] : _a) as { id: string; user_id: string } | undefined;
      if (!artist || artist.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your content item" });
      }

      const currentStatus = row.status as ContentStatus;
      if (!canTransition(currentStatus, "failed")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot reject content from ${currentStatus}` });
      }

      const variants = {
        ...(row.variants && typeof row.variants === "object" ? (row.variants as Record<string, unknown>) : {}),
        rejection_reason: input.reason ?? null,
      };

      const { error: updateError } = await ctx.supabase
        .from("content_items")
        .update({
          ...buildStatusPatch("failed"),
          variants,
        })
        .eq("id", input.contentId);
      if (updateError) throw updateError;

      let eventEmitError: string | null = null;
      try {
        await sendTestEvent("content.rejected", {
          userId: ctx.user.id,
          actorId: ctx.user.id,
          tenantId: ctx.user.id,
          resourceId: input.contentId,
          idempotencyKey: buildIdempotencyKey("content", "rejected", input.contentId, campaign.id),
          traceId: buildTraceId("content-reject"),
          requestId: buildIdempotencyKey("request", "content", "reject", input.contentId),
          contentId: input.contentId,
          campaignId: campaign!.id,
          releaseId: campaign!.release_id,
          artistId: (release as { artist_id: string } | undefined)?.artist_id ?? "",
          platform: row.platform,
          contentType: row.content_type,
          reason: input.reason ?? "",
        });
      } catch (eventError) {
        eventEmitError = eventError instanceof Error ? eventError.message : String(eventError);
      }

      return { ok: true, event_emit_failed: eventEmitError };
    }),
});
