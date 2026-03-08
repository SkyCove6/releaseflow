import Stripe from "stripe";

// Lazy singleton — avoids instantiation at build time when env vars are absent.
let _stripe: Stripe | undefined;
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
      typescript: true,
    });
  }
  return _stripe;
}

/** @deprecated Use getStripe() instead */
export const stripe = {
  get customers() { return getStripe().customers; },
  get checkout() { return getStripe().checkout; },
  get billingPortal() { return getStripe().billingPortal; },
  get webhooks() { return getStripe().webhooks; },
  get subscriptions() { return getStripe().subscriptions; },
};

// ─── Plan definitions ──────────────────────────────────────────────────────

export type PlanId = "free" | "starter" | "pro" | "label";

export interface PlanLimits {
  releasesPerMonth: number | null; // null = unlimited
  platforms: string[];
  agentRunsPerMonth: number | null;
}

export const PLANS: Record<
  PlanId,
  {
    name: string;
    priceCents: number;
    stripePriceId: string | null;
    limits: PlanLimits;
    features: string[];
  }
> = {
  free: {
    name: "Free",
    priceCents: 0,
    stripePriceId: null,
    limits: {
      releasesPerMonth: 1,
      platforms: ["instagram"],
      agentRunsPerMonth: 5,
    },
    features: [
      "1 release / month",
      "1 platform (Instagram)",
      "5 AI agent runs / month",
    ],
  },
  starter: {
    name: "Starter",
    priceCents: 2900,
    stripePriceId: process.env.STRIPE_PRICE_STARTER ?? null,
    limits: {
      releasesPerMonth: 2,
      platforms: ["instagram"],
      agentRunsPerMonth: 30,
    },
    features: [
      "2 releases / month",
      "1 platform (Instagram)",
      "30 AI agent runs / month",
      "Campaign management",
    ],
  },
  pro: {
    name: "Pro",
    priceCents: 7900,
    stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
    limits: {
      releasesPerMonth: 10,
      platforms: ["instagram", "tiktok", "twitter", "youtube", "email", "press"],
      agentRunsPerMonth: 200,
    },
    features: [
      "10 releases / month",
      "All 6 platforms",
      "200 AI agent runs / month",
      "Analytics snapshots",
      "Playlist pitching",
    ],
  },
  label: {
    name: "Label",
    priceCents: 19900,
    stripePriceId: process.env.STRIPE_PRICE_LABEL ?? null,
    limits: {
      releasesPerMonth: null,
      platforms: ["instagram", "tiktok", "twitter", "youtube", "email", "press"],
      agentRunsPerMonth: null,
    },
    features: [
      "Unlimited releases",
      "All 6 platforms",
      "Unlimited AI agent runs",
      "Analytics snapshots",
      "Playlist pitching",
      "Priority support",
    ],
  },
};
