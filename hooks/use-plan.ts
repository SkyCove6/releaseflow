"use client";

import { trpc } from "@/lib/trpc/client";
import { PLANS, type PlanId } from "@/lib/stripe";

export interface UsePlanReturn {
  planId: PlanId;
  name: string;
  priceCents: number;
  limits: (typeof PLANS)[PlanId]["limits"];
  features: string[];
  hasStripeCustomer: boolean;
  /** Monthly release usage — undefined while loading */
  releaseUsage:
    | { current: number; limit: number | null; allowed: boolean }
    | undefined;
  /** True while either query is loading */
  isLoading: boolean;
  /** True if the user can create a release right now */
  canCreateRelease: boolean;
  /** True if the given platform is available on the current plan */
  canUsePlatform: (platform: string) => boolean;
}

export function usePlan(): UsePlanReturn {
  const { data: plan, isLoading: planLoading } = trpc.plan.current.useQuery();
  const { data: releaseUsage, isLoading: usageLoading } =
    trpc.plan.releaseUsage.useQuery();

  const isLoading = planLoading || usageLoading;

  // Optimistic defaults while loading
  const planId: PlanId = plan?.planId ?? "free";
  const limits = plan?.limits ?? PLANS.free.limits;

  const canCreateRelease =
    limits.releasesPerMonth === null
      ? true
      : (releaseUsage?.current ?? 0) < (limits.releasesPerMonth ?? 0);

  const canUsePlatform = (platform: string) =>
    limits.platforms.includes(platform);

  return {
    planId,
    name: plan?.name ?? PLANS.free.name,
    priceCents: plan?.priceCents ?? 0,
    limits,
    features: plan?.features ?? PLANS.free.features,
    hasStripeCustomer: plan?.hasStripeCustomer ?? false,
    releaseUsage,
    isLoading,
    canCreateRelease,
    canUsePlatform,
  };
}
