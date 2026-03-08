export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe, PLANS, type PlanId } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  planId: z.enum(["starter", "pro", "label"]),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const { planId } = parsed.data;
  const plan = PLANS[planId as PlanId];

  if (!plan.stripePriceId) {
    return NextResponse.json(
      { error: "Stripe price not configured for this plan" },
      { status: 500 }
    );
  }

  // Fetch or create Stripe customer
  const { data: profile } = await supabase
    .from("users")
    .select("stripe_customer_id, email, name")
    .eq("id", user.id)
    .single();

  let customerId = profile?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile?.email ?? user.email,
      name: profile?.name ?? undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;

    await supabase
      .from("users")
      .update({ stripe_customer_id: customerId })
      .eq("id", user.id);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${appUrl}/settings/billing?success=1`,
    cancel_url: `${appUrl}/pricing?cancelled=1`,
    metadata: {
      supabase_user_id: user.id,
      plan_id: planId,
    },
    subscription_data: {
      metadata: { supabase_user_id: user.id, plan_id: planId },
    },
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: session.url });
}
