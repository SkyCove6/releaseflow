import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildIdempotencyKey, buildTraceId } from "@/inngest/client";
import { emitLifecycleEvent } from "@/server/utils/events";
import { applyReferralCode } from "@/lib/referrals";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const referralCode = searchParams.get("ref");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  if (referralCode) {
    applyReferralCode(user.id, referralCode).catch((err) => {
      console.warn("[auth/callback] referral apply failed", {
        userId: user.id,
        referralCode,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  try {
    const { data: userRow } = await supabase
      .from("users")
      .select("created_at")
      .eq("id", user.id)
      .single();

    const createdAt = userRow?.created_at;
    const isFirstSignUp = Boolean(
      createdAt && Date.now() - new Date(createdAt).getTime() < 5 * 60 * 1000
    );

    if (isFirstSignUp) {
      const planContext = { planId: "free", limits: {} };

      emitLifecycleEvent("user/signed-up", {
        userId: user.id,
        actorId: user.id,
        tenantId: user.id,
        resourceId: user.id,
        idempotencyKey: buildIdempotencyKey("user", "signed_up", user.id),
        traceId: buildTraceId("auth-callback"),
        requestId: buildIdempotencyKey("request", "user-signup", user.id),
        planContext,
        userName: user.user_metadata?.name ?? user.email ?? "Unknown",
        userEmail: user.email ?? "",
      }).catch((err) => {
        console.warn("[auth/callback] failed to emit user/signed-up", {
          error: err instanceof Error ? err.message : String(err),
          userId: user.id,
        });
      });
    }
  } catch {
    // Non-blocking: event emission/fallback errors should not interrupt authentication.
  }

  return NextResponse.redirect(`${origin}${next}`);
}
