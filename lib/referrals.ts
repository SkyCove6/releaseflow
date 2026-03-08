/**
 * Referral system helpers.
 *
 * Credit model: when a referred user first pays (Stripe webhook), we mark the
 * conversion as "credited" and set credit_months += 1 on the referrer's user row.
 * The credit is applied during the next billing cycle by creating a Stripe credit balance.
 */

import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

// ─── Code generation ──────────────────────────────────────────────────────────

function generateCode(userId: string): string {
  // 8-char alphanumeric derived from userId + timestamp, URL-safe
  const base = userId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}-${rand}`;
}

// ─── Get or create referral code ─────────────────────────────────────────────

export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const supabase = await createClient();

  // Try to get existing
  const { data: existing } = await supabase
    .from("referral_codes")
    .select("code")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.code) return existing.code;

  // Create a new unique code
  let code = generateCode(userId);
  let attempts = 0;

  while (attempts < 5) {
    const { error } = await supabase
      .from("referral_codes")
      .insert({ user_id: userId, code });

    if (!error) return code;
    if (error.code !== "23505") throw new Error(`Failed to create referral code: ${error.message}`);

    // Collision — try a different suffix
    code = generateCode(userId + attempts);
    attempts++;
  }

  throw new Error("Failed to generate unique referral code after 5 attempts");
}

// ─── Apply referral code (called during signup) ───────────────────────────────

export async function applyReferralCode(
  refereeId: string,
  code: string
): Promise<{ ok: boolean; referrerId?: string; error?: string }> {
  const supabase = await createClient();

  // Look up the code
  const { data: ref } = await supabase
    .from("referral_codes")
    .select("user_id")
    .eq("code", code.toUpperCase().trim())
    .maybeSingle();

  if (!ref) return { ok: false, error: "Invalid referral code" };
  if (ref.user_id === refereeId) return { ok: false, error: "Cannot refer yourself" };

  // Insert conversion (will fail silently if referee already has one)
  const { error } = await supabase.from("referral_conversions").insert({
    referrer_id: ref.user_id,
    referee_id: refereeId,
    referral_code: code.toUpperCase().trim(),
    status: "pending",
  });

  if (error && error.code !== "23505") {
    return { ok: false, error: error.message };
  }

  // Increment used_count.
  if (!error) {
    const { error: rpcError } = await supabase.rpc("increment_referral_count", {
      p_code: code.toUpperCase().trim(),
    });

    if (rpcError) {
      const errMessage = rpcError.message;
      if (rpcError.code === "42883") {
        return {
          ok: false,
          error: "Referral contract missing: increment_referral_count RPC is not installed",
        };
      }

      return {
        ok: false,
        error: `Referral counter failed: ${errMessage}`,
      };
    }
  }

  return { ok: true, referrerId: ref.user_id };
}

// ─── Credit referrer (called from Stripe webhook on first payment) ────────────

export async function creditReferrer(refereeId: string): Promise<void> {
  const supabase = await createClient();

  // Find pending conversion
  const { data: conversion } = await supabase
    .from("referral_conversions")
    .select("id, referrer_id")
    .eq("referee_id", refereeId)
    .eq("status", "pending")
    .maybeSingle();

  if (!conversion) return;

  // Mark as credited
  await supabase
    .from("referral_conversions")
    .update({ status: "credited", credited_at: new Date().toISOString() })
    .eq("id", conversion.id);

  // Apply Stripe credit to the referrer (1-month credit = $0 charge for next cycle)
  // We use Stripe's customer balance credits for this.
  try {
    const { data: referrer } = await supabase
      .from("users")
      .select("stripe_customer_id, plan_tier")
      .eq("id", conversion.referrer_id)
      .maybeSingle();

    if (referrer?.stripe_customer_id) {
      // Credit amount — match the referrer's current plan price
      const planCreditCents: Record<string, number> = {
        starter: 2900,
        pro: 7900,
        label: 19900,
      };
      const creditAmount = planCreditCents[referrer.plan_tier as string] ?? 2900;

      await getStripe().customers.createBalanceTransaction(
        referrer.stripe_customer_id as string,
        {
          amount: -creditAmount, // negative = credit
          currency: "usd",
          description: "Referral credit: 1 free month",
        }
      );
    }
  } catch (err) {
    console.warn("[referrals] Failed to apply Stripe credit:", err);
  }
}

// ─── Get referral stats for a user ────────────────────────────────────────────

export async function getReferralStats(userId: string) {
  const supabase = await createClient();

  const [codeResult, conversionsResult] = await Promise.all([
    supabase
      .from("referral_codes")
      .select("code, used_count")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("referral_conversions")
      .select("status, created_at, credited_at")
      .eq("referrer_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  const code = codeResult.data?.code ?? null;
  const usedCount = codeResult.data?.used_count ?? 0;
  const conversions = conversionsResult.data ?? [];
  const credited = conversions.filter((c) => c.status === "credited").length;
  const pending = conversions.filter((c) => c.status === "pending").length;

  return { code, usedCount, credited, pending, conversions };
}
