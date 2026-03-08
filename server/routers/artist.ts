import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { buildIdempotencyKey, buildTraceId } from "@/inngest/client";
import { sendTestEvent } from "@/lib/testing/send-test-event";

function extractSpotifyId(value?: string) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/spotify\.com\/artist\/([a-zA-Z0-9]+)/);
  return match?.[1] ?? trimmed;
}

export const artistRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        genre: z.string().min(1),
        spotifyUrl: z.string().url().optional(),
        instagramUrl: z.string().url().optional(),
        pastCaptions: z.array(z.string().min(1)).default([]),
        artistBio: z.string().min(1),
        interviewExcerpts: z.array(z.string().min(1)).optional().default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const spotifyId = extractSpotifyId(input.spotifyUrl);

      const { data, error } = await ctx.supabase
        .from("artists")
        .insert({
          user_id: ctx.user.id,
          name: input.name.trim(),
          genre: input.genre.trim(),
          bio: input.artistBio.trim(),
          spotify_id: spotifyId,
          voice_profile: {
            onboarding: {
              past_captions: input.pastCaptions,
              interview_excerpts: input.interviewExcerpts,
            },
            social_links: {
              spotify_url: input.spotifyUrl ?? null,
              instagram_url: input.instagramUrl ?? null,
            },
          },
        })
        .select("id, name, genre, bio, user_id, created_at")
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error?.message ?? "Failed to create artist",
        });
      }

      let eventEmitError: string | null = null;
      try {
        await sendTestEvent("artist.created", {
          userId: ctx.user.id,
          actorId: ctx.user.id,
          tenantId: ctx.user.id,
          resourceId: data.id,
          idempotencyKey: buildIdempotencyKey("artist", "created", data.id, ctx.user.id),
          traceId: buildTraceId("artist-onboarding"),
          requestId: buildIdempotencyKey("request", "artist", "created", data.id, ctx.user.id),
          artistId: data.id,
          artistName: data.name,
          genre: data.genre ?? input.genre,
          existingBio: data.bio ?? input.artistBio,
          socialPosts: input.pastCaptions,
          interviewExcerpts: input.interviewExcerpts,
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

