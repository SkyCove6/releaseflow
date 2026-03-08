import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { checkReleaseLimit } from "@/lib/plan-limits";
import { emitLifecycleEvent } from "@/server/utils/events";
import { buildIdempotencyKey, buildTraceId } from "@/inngest/client";
import {
  type ReleaseStatus,
  RELEASE_STATUS_LABELS,
  type ReleaseStatusInput,
  canTransitionReleaseStatus,
  normalizeReleaseStatus,
  releaseStatusInputSchema,
} from "@/lib/release-status";
import type { Context } from "@/server/trpc";

type ReleaseRowStatus = string;

const releaseTypeSchema = z.enum(["single", "ep", "album"]);
const releaseStatusInputSchemaWithCanonical =
  releaseStatusInputSchema
    .transform((value) => normalizeReleaseStatus(value as ReleaseStatusInput))
    .pipe(z.custom<ReleaseStatus>());

const releaseWithOwnershipSelect =
  "*, artists(id, name, user_id), " +
  "campaigns(id, status, content_items(id, platform, content_type, status, created_at, updated_at), " +
  "created_at), playlist_pitches(id, status, release_id)";

function formatLabel(status: ReleaseStatus) {
  return RELEASE_STATUS_LABELS[status] ?? status;
}

async function assertArtistOwnership(
  supabase: Context["supabase"],
  artistId: string,
  userId: string
) {
  const { data: artist, error } = await supabase
    .from("artists")
    .select("id, user_id")
    .eq("id", artistId)
    .single();

  if (error || !artist) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Artist not found" });
  }

  if (artist.user_id !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not your artist" });
  }
}

function buildReleaseEventBase(
  userId: string,
  releaseId: string,
  actorId?: string,
  extras: Partial<Record<string, unknown>> = {}
) {
  return {
    userId,
    actorId: actorId ?? userId,
    tenantId: userId,
    resourceId: releaseId,
    idempotencyKey: buildIdempotencyKey("release", releaseId),
    traceId: buildTraceId("release"),
    ...extras,
  };
}

export const releasesRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z
        .object({
          artistId: z.string().uuid().optional(),
          status: releaseStatusInputSchemaWithCanonical.optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from("releases")
        .select(releaseWithOwnershipSelect)
        .eq("artists.user_id", ctx.user.id)
        .order("release_date", { ascending: false });

      if (input?.artistId) query = query.eq("artist_id", input.artistId);
      if (input?.status) query = query.eq("status", input.status);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("releases")
        .select(releaseWithOwnershipSelect)
        .eq("id", input.id)
        .single();
      if (error) {
        throw error;
      }
      if (!data) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Release not found" });
      }

      const artists = (data as { artists?: { user_id?: string } }).artists;
      if (!artists || artists.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your release" });
      }

      return data;
    }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        artistId: z.string().uuid(),
        releaseDate: z.string().optional(),
        type: releaseTypeSchema.default("single"),
        status: releaseStatusInputSchemaWithCanonical.default("draft"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.id) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
      }

      await assertArtistOwnership(ctx.supabase, input.artistId, ctx.user.id);
      const normalizedStatus = input.status as ReleaseStatus;

      const { allowed, current, limit } = await checkReleaseLimit(ctx.user.id);
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Release limit reached: ${current}/${limit} this month. Upgrade your plan to create more.`,
        });
      }

      const { data, error } = await ctx.supabase
        .from("releases")
        .insert({
          title: input.title,
          artist_id: input.artistId,
          release_date: input.releaseDate,
          status: normalizedStatus,
          type: input.type,
        })
        .select(releaseWithOwnershipSelect)
        .single();
      if (error) throw error;
      const releaseRow = data as unknown as {
        id: string;
        title: string;
        release_date?: string | null;
        artists?: { name?: string } | Array<{ name?: string }> | null;
      };
      const releaseArtist = Array.isArray(releaseRow.artists)
        ? (releaseRow.artists[0] ?? null)
        : releaseRow.artists;

      const emitResult = await emitLifecycleEvent("release/created", {
        ...buildReleaseEventBase(ctx.user.id, releaseRow.id, ctx.user.id, {
          idempotencyKey: buildIdempotencyKey("release", "created", releaseRow.id, ctx.user.id),
        }),
        releaseId: releaseRow.id,
        artistId: input.artistId,
        artistName: releaseArtist?.name ?? "Unknown artist",
        title: input.title,
        type: input.type,
        releaseDate: input.releaseDate,
        status: normalizedStatus,
        requestId: buildIdempotencyKey("request", "release-created", releaseRow.id, ctx.user.id),
      });

      return {
        ...releaseRow,
        statusLabel: formatLabel(normalizedStatus),
        event_emit_failed: emitResult.ok ? null : emitResult.error,
      };
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: releaseStatusInputSchemaWithCanonical,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const nextStatus = input.status as ReleaseStatus;

      const { data: current, error: fetchError } = await ctx.supabase
        .from("releases")
        .select("id, status, title, type, artist_id, artists(id, name, user_id)")
        .eq("id", input.id)
        .single();
      if (fetchError) throw fetchError;

      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Release not found" });
      }

      if ((current as { artists?: { user_id?: string } }).artists?.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your release" });
      }
      const currentRow = current as unknown as {
        id: string;
        status: ReleaseRowStatus;
        title: string;
        type: "single" | "ep" | "album";
        artist_id: string;
        artists?: { name?: string; user_id?: string } | Array<{ name?: string; user_id?: string }> | null;
      };
      const currentArtist = Array.isArray(currentRow.artists)
        ? (currentRow.artists[0] ?? null)
        : currentRow.artists;

      const currentStatus = normalizeReleaseStatus(
        currentRow.status ?? "draft"
      );

      if (!canTransitionReleaseStatus(currentStatus, nextStatus)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Illegal release transition ${formatLabel(currentStatus)} -> ${formatLabel(nextStatus)}`,
        });
      }

      const { data, error } = await ctx.supabase
        .from("releases")
        .update({ status: nextStatus })
        .eq("id", input.id)
        .select(releaseWithOwnershipSelect)
        .single();
      if (error) throw error;
      if (!data) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Release not found" });
      }
      const updatedRow = data as unknown as {
        id: string;
        title: string;
        release_date?: string | null;
      };

      let eventEmitFailed: string | null = null;
      if (nextStatus === "active") {
        const emitResult = await emitLifecycleEvent("release/published", {
          ...buildReleaseEventBase(ctx.user.id, updatedRow.id, ctx.user.id, {
            idempotencyKey: buildIdempotencyKey("release", "published", updatedRow.id, ctx.user.id),
            requestId: buildIdempotencyKey("request", "release-publish", updatedRow.id, ctx.user.id),
          }),
          releaseId: updatedRow.id,
          artistId: currentRow.artist_id,
          artistName: currentArtist?.name ?? "Unknown artist",
          status: "active",
          title: updatedRow.title,
          releaseDate: updatedRow.release_date ?? undefined,
        });
        eventEmitFailed = emitResult.ok ? null : (emitResult.error ?? null);
      }

      return {
        ...updatedRow,
        statusLabel: formatLabel(nextStatus),
        event_emit_failed: eventEmitFailed,
      };
    }),
});
