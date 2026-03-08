import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import {
  getOrCreateReferralCode,
  applyReferralCode,
  getReferralStats,
} from "@/lib/referrals";

export const referralsRouter = createTRPCRouter({

  /** Get (or create) the authenticated user's referral code + stats. */
  myStats: protectedProcedure.query(async ({ ctx }) => {
    const code  = await getOrCreateReferralCode(ctx.user.id);
    const stats = await getReferralStats(ctx.user.id);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://releaseflow.app";
    return {
      ...stats,
      code,
      shareUrl: `${appUrl}/signup?ref=${code}`,
    };
  }),

  /** Apply a referral code to the current user's account (used after signup). */
  applyCode: protectedProcedure
    .input(z.object({ code: z.string().min(3).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const result = await applyReferralCode(ctx.user.id, input.code);
      if (!result.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "Invalid code" });
      }
      return { ok: true };
    }),
});
