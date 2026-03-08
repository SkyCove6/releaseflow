import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PricingTable } from "@/components/billing/pricing-table";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <>
      <Header title="Billing" />
      <main className="flex-1 p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Billing</h2>
          <p className="text-muted-foreground">
            Manage your subscription and payment details
          </p>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Your Plan</CardTitle>
            <CardDescription>
              Upgrade or manage your current subscription
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PricingTable showManage />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
