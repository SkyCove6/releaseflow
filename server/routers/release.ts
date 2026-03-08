import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { buildIdempotencyKey, buildTraceId } from "@/inngest/client";
import { sendTestEvent } from "@/lib/testing/send-test-event";

const releaseTypeSchema = z.enum(["single", "ep", "album"]);

export const releaseRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        type: releaseTypeSchema.default("single"),
        releaseDate: z.string().optional(),
        genre: z.string().min(1),
        mood: z.array(z.string().min(1)).default([]),
        comparableArtists: z.array(z.string().min(1)).default([]),
        artworkDataUrl: z.string().optional(),
        artworkFilename: z.string().optional(),
        artistId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let resolvedArtistId = input.artistId ?? null;

      if (resolvedArtistId) {
        const { data: artist, error } = await ctx.supabase
          .from("artists")
          .select("id, user_id")
          .eq("id", resolvedArtistId)
          .single();
        if (error || !artist) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Artist not found" });
        }
        if (artist.user_id !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your artist" });
        }
      } else {
        const { data: artist, error } = await ctx.supabase
          .from("artists")
          .select("id")
          .eq("user_id", ctx.user.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error || !artist?.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Create an artist first before creating a release",
          });
        }
        resolvedArtistId = artist.id as string;
      }

      const metadata = {
        genre: input.genre,
        mood: input.mood,
        comparable_artists: input.comparableArtists,
        artwork: {
          data_url: input.artworkDataUrl ?? null,
          filename: input.artworkFilename ?? null,
        },
      };

      const { data, error } = await ctx.supabase
        .from("releases")
        .insert({
          artist_id: resolvedArtistId,
          title: input.title,
          type: input.type,
          release_date: input.releaseDate || null,
          status: "draft",
          metadata,
        })
        .select("id, artist_id, title, type, release_date, status, metadata, created_at")
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error?.message ?? "Failed to create release",
        });
      }

      let eventEmitError: string | null = null;
      try {
        await sendTestEvent("release.created", {
          userId: ctx.user.id,
          actorId: ctx.user.id,
          tenantId: ctx.user.id,
          resourceId: data.id,
          idempotencyKey: buildIdempotencyKey("release", "created", data.id, ctx.user.id),
          traceId: buildTraceId("release-create"),
          requestId: buildIdempotencyKey("request", "release", "created", data.id, ctx.user.id),
          releaseId: data.id,
          artistId: data.artist_id,
          title: data.title,
          type: data.type,
          releaseDate: data.release_date ?? undefined,
          status: "draft",
        });
      } catch (eventError) {
        eventEmitError = eventError instanceof Error ? eventError.message : String(eventError);
      }

      return {
        ...data,
        event_emit_failed: eventEmitError,
      };
    }),
});

