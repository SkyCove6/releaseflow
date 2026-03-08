import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/trpc";
import { handleSupportMessage } from "@/features/support-bot/support-engine";

const MessageSchema = z.object({
  role:    z.enum(["user", "assistant"]),
  content: z.string().min(1).max(2000),
});

export const supportRouter = createTRPCRouter({
  /** Send a chat message and get a bot response */
  chat: protectedProcedure
    .input(z.object({
      messages: z.array(MessageSchema).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const userEmail = ctx.user.email ?? "";
      return handleSupportMessage(input.messages, ctx.user.id, userEmail);
    }),

  /** Unauthenticated chat for the public help page */
  chatPublic: publicProcedure
    .input(z.object({
      messages:  z.array(MessageSchema).min(1).max(20),
      userEmail: z.string().email().optional(),
    }))
    .mutation(async ({ input }) => {
      return handleSupportMessage(input.messages, null, input.userEmail ?? "anonymous");
    }),

  /** List recent tickets for the current user */
  myTickets: protectedProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from("support_tickets")
      .select("id, subject, status, created_at, bot_resolved")
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: false })
      .limit(10);
    return data ?? [];
  }),
});
