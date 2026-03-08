import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";

export const analyticsRouter = createTRPCRouter({
  overview: protectedProcedure.query(async ({ ctx }) => {
    const [artists, releases] = await Promise.all([
      ctx.supabase.from("artists").select("id", { count: "exact", head: true }),
      ctx.supabase.from("releases").select("id", { count: "exact", head: true }),
    ]);

    return {
      totalArtists: artists.count ?? 0,
      totalReleases: releases.count ?? 0,
    };
  }),

  releasesByStatus: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("releases")
      .select("status");
    if (error) throw error;

    const counts = data.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    return counts;
  }),

  recentActivity: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("releases")
        .select("id, title, status, created_at, artists(name)")
        .order("created_at", { ascending: false })
        .limit(input.limit);
      if (error) throw error;
      return data;
    }),
});
