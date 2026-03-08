import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import {
  buildVoiceProfile,
  VoiceProfilerInputSchema,
} from "@/agents/voice-profiler";
import {
  pitchPlaylists,
  PlaylistPitcherInputSchema,
} from "@/agents/playlist-pitcher";
import {
  interpretAnalytics,
  AnalyticsInterpreterInputSchema,
} from "@/agents/analytics-interpreter";

export const agentsRouter = createTRPCRouter({
  buildVoiceProfile: protectedProcedure
    .input(
      VoiceProfilerInputSchema.extend({
        artistId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { artistId, ...profilerInput } = input;

      const result = await buildVoiceProfile(profilerInput, {
        userId: ctx.user.id,
        artistId,
      });

      if (!result.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error,
        });
      }

      return result;
    }),

  pitchPlaylists: protectedProcedure
    .input(PlaylistPitcherInputSchema.omit({ userId: true }))
    .mutation(async ({ ctx, input }) => {
      const result = await pitchPlaylists({ ...input, userId: ctx.user.id });

      if (!result.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error,
        });
      }

      return result;
    }),

  interpretAnalytics: protectedProcedure
    .input(AnalyticsInterpreterInputSchema.omit({ userId: true }))
    .mutation(async ({ ctx, input }) => {
      const result = await interpretAnalytics({ ...input, userId: ctx.user.id });

      if (!result.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error,
        });
      }

      return result;
    }),

  /** Returns the 20 most recent agent runs for the current user */
  recentRuns: protectedProcedure
    .input(
      z.object({
        agentName: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from("agent_runs")
        .select("*")
        .eq("user_id", ctx.user.id)
        .order("created_at", { ascending: false })
        .limit(input.limit);

      if (input.agentName) {
        query = query.eq("agent_name", input.agentName);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    }),
});
