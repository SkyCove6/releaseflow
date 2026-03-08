import { NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { stripe, type PlanId } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { sendPaymentFailedEmail } from "@/lib/resend";

// Stripe requires the raw body for signature verification.
export const dynamic = "force-dynamic";

async function planIdFromPriceId(priceId: string): Promise<PlanId | null> {
  const { STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_LABEL } =
    process.env;
  if (priceId === STRIPE_PRICE_STARTER) return "starter";
  if (priceId === STRIPE_PRICE_PRO) return "pro";
  if (priceId === STRIPE_PRICE_LABEL) return "label";
  return null;
}

export async function POST(request: Request) {
  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Webhook signature verification failed:", message);
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  const supabase = await createClient();

  try {
    switch (event.type) {
      // ── checkout.session.completed ─────────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.supabase_user_id;
        const planId = session.metadata?.plan_id as PlanId | undefined;

        if (!userId || !planId) break;

        await supabase
          .from("users")
          .update({ plan_tier: planId })
          .eq("id", userId);

        break;
      }

      // ── customer.subscription.updated ─────────────────────────────────
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id;
        if (!userId) break;

        const priceId = sub.items.data[0]?.price.id;
        if (!priceId) break;

        const planId = await planIdFromPriceId(priceId);
        if (!planId) break;

        const isActive = ["active", "trialing"].includes(sub.status);

        await supabase
          .from("users")
          .update({ plan_tier: isActive ? planId : "free" })
          .eq("id", userId);

        break;
      }

      // ── customer.subscription.deleted ─────────────────────────────────
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id;
        if (!userId) break;

        await supabase
          .from("users")
          .update({ plan_tier: "free" })
          .eq("id", userId);

        break;
      }

      // ── invoice.payment_failed ─────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id;

        if (!customerId) break;

        const { data: profile } = await supabase
          .from("users")
          .select("email, name")
          .eq("stripe_customer_id", customerId)
          .single();

        if (profile?.email) {
          await sendPaymentFailedEmail(
            profile.email,
            profile.name ?? "there"
          );
        }

        break;
      }

      default:
        // Silently ignore unhandled events
        break;
    }
  } catch (err) {
    console.error(`Error handling Stripe event ${event.type}:`, err);
    // Return 200 so Stripe doesn't retry — log and alert via your observability tool
  }

  return NextResponse.json({ received: true });
}
