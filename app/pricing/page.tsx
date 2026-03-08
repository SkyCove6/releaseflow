import type { Metadata } from "next";
import { PricingTable } from "@/components/billing/pricing-table";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/50 px-4 py-16">
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          Simple, transparent pricing
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Start free. Upgrade when you&apos;re ready.
        </p>
      </div>
      <div className="w-full max-w-5xl">
        <PricingTable />
      </div>
    </div>
  );
}
