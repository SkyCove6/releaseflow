import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PLANS, type PlanId } from "@/lib/stripe";

export interface PlanContext {
  planId: PlanId;
  limits: (typeof PLANS)[PlanId]["limits"];
}

export async function getPlanContext(): Promise<PlanContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { planId: "free", limits: PLANS.free.limits };
  }

  const { data } = await supabase
    .from("users")
    .select("plan_tier")
    .eq("id", user.id)
    .single();

  const planId = (data?.plan_tier ?? "free") as PlanId;
  return { planId, limits: PLANS[planId].limits };
}

// ── Release limit check ──────────────────────────────────────────────────────

export async function checkReleaseLimit(userId: string): Promise<{
  allowed: boolean;
  current: number;
  limit: number | null;
}> {
  const supabase = await createClient();

  const { limits } = await getPlanContext();

  if (limits.releasesPerMonth === null) {
    return { allowed: true, current: 0, limit: null };
  }

  // Count releases created by user's artists this calendar month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("releases")
    .select(
      `id, artists!inner(user_id)`,
      { count: "exact", head: true }
    )
    .eq("artists.user_id", userId)
    .gte("created_at", startOfMonth.toISOString());

  const current = count ?? 0;
  const limit = limits.releasesPerMonth;

  return {
    allowed: current < limit,
    current,
    limit,
  };
}

// ── Platform access check ────────────────────────────────────────────────────

export async function checkPlatformAccess(
  platform: string
): Promise<boolean> {
  const { limits } = await getPlanContext();
  return limits.platforms.includes(platform);
}

// ── Typed limit helper (for client-side via tRPC) ────────────────────────────

export function getLimitsForPlan(planId: PlanId) {
  return PLANS[planId].limits;
}
