"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLANS, type PlanId } from "@/lib/stripe";
import { usePlan } from "@/hooks/use-plan";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const PLAN_ORDER: PlanId[] = ["free", "starter", "pro", "label"];

function formatPrice(cents: number) {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(0)}`;
}

interface PricingTableProps {
  /** If true, show a "Manage billing" button for current plan instead of checkout */
  showManage?: boolean;
}

export function PricingTable({ showManage = false }: PricingTableProps) {
  const { planId: currentPlanId, isLoading } = usePlan();
  const router = useRouter();
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);

  async function handleUpgrade(planId: PlanId) {
    if (planId === "free") return;
    setLoadingPlan(planId);

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const { url, error } = (await res.json()) as {
        url?: string;
        error?: string;
      };
      if (error || !url) throw new Error(error ?? "No checkout URL");
      router.push(url);
    } catch (err) {
      console.error("Checkout error:", err);
    } finally {
      setLoadingPlan(null);
    }
  }

  async function handleManageBilling() {
    setLoadingPlan("free"); // reuse loading state
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const { url, error } = (await res.json()) as {
        url?: string;
        error?: string;
      };
      if (error || !url) throw new Error(error ?? "No portal URL");
      router.push(url);
    } finally {
      setLoadingPlan(null);
    }
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {PLAN_ORDER.map((planId) => {
        const plan = PLANS[planId];
        const isCurrent = planId === currentPlanId;
        const isPopular = planId === "pro";
        const isDowngrade =
          PLAN_ORDER.indexOf(planId) < PLAN_ORDER.indexOf(currentPlanId);
        const isLoaded = !isLoading;

        return (
          <Card
            key={planId}
            className={cn(
              "relative flex flex-col",
              isPopular && "border-primary shadow-md",
              isCurrent && "bg-muted/40"
            )}
          >
            {isPopular && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                Most popular
              </Badge>
            )}

            <CardHeader>
              <CardTitle className="text-base">{plan.name}</CardTitle>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold">
                  {formatPrice(plan.priceCents)}
                </span>
                {plan.priceCents > 0 && (
                  <span className="text-sm text-muted-foreground">/mo</span>
                )}
              </div>
              <CardDescription>
                {planId === "free" && "Get started for free."}
                {planId === "starter" && "For indie artists releasing regularly."}
                {planId === "pro" && "For serious artists on all platforms."}
                {planId === "label" && "For labels managing multiple artists."}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex-1">
              <ul className="space-y-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>

            <CardFooter>
              {isCurrent ? (
                showManage && planId !== "free" ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleManageBilling}
                    disabled={loadingPlan !== null}
                  >
                    {loadingPlan !== null ? "Loading…" : "Manage billing"}
                  </Button>
                ) : (
                  <Button variant="outline" className="w-full" disabled>
                    Current plan
                  </Button>
                )
              ) : planId === "free" ? (
                <Button variant="outline" className="w-full" disabled>
                  {isDowngrade ? "Contact support to downgrade" : "Free forever"}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  variant={isPopular ? "default" : "outline"}
                  onClick={() => handleUpgrade(planId)}
                  disabled={!isLoaded || loadingPlan !== null || isDowngrade}
                >
                  {loadingPlan === planId
                    ? "Redirecting…"
                    : isDowngrade
                    ? "Downgrade"
                    : "Upgrade"}
                </Button>
              )}
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
