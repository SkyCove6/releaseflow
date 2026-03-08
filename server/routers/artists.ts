import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { buildIdempotencyKey, buildTraceId } from "@/inngest/client";
import { emitLifecycleEvent } from "@/server/utils/events";

export const artistsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("artists")
      .select("id, name, genre, bio, user_id, created_at")
      .eq("user_id", ctx.user.id)
      .order("name");
    if (error) throw error;
    return data ?? [];
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("artists")
        .select("id, name, genre, bio, voice_profile, created_at, user_id")
        .eq("id", input.id)
        .single();
      if (error) throw error;
      if (!data) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Artist not found" });
      }
      if (data.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your artist" });
      }
      return data;
    }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1), bio: z.string().optional(), genre: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user?.id) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
      }

      const { data, error } = await ctx.supabase
        .from("artists")
        .insert({
          ...input,
          user_id: ctx.user.id,
        })
        .select("id, name, genre, bio, user_id")
        .single();
      if (error) throw error;

      const emitResult = await emitLifecycleEvent("artist/created", {
        userId: ctx.user.id,
        actorId: ctx.user.id,
        tenantId: ctx.user.id,
        resourceId: data.id,
        idempotencyKey: buildIdempotencyKey("artist", "created", data.id, ctx.user.id),
        traceId: buildTraceId("artist"),
        requestId: buildIdempotencyKey("request", "artist-create", data.id, ctx.user.id),
        artistId: data.id,
        artistName: data.name,
        genre: data.genre ?? "",
        existingBio: input.bio ?? "",
        socialPosts: [],
      });

      return {
        ...data,
        event_emit_failed: emitResult.ok ? null : emitResult.error,
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        bio: z.string().optional(),
        genre: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;

      const { data: existing, error: ownerError } = await ctx.supabase
        .from("artists")
        .select("id, user_id")
        .eq("id", id)
        .single();
      if (ownerError) throw ownerError;
      if (!existing || existing.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your artist" });
      }

      const { data, error } = await ctx.supabase
        .from("artists")
        .update(rest)
        .eq("id", id)
        .select("id, name, genre, bio, user_id")
        .single();
      if (error) throw error;
      return data;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: existing, error: ownerError } = await ctx.supabase
        .from("artists")
        .select("id, user_id")
        .eq("id", input.id)
        .single();
      if (ownerError) throw ownerError;
      if (!existing || existing.user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your artist" });
      }

      const { error } = await ctx.supabase
        .from("artists")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
      return { success: true };
    }),
});
