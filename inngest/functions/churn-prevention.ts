/**
 * Daily churn-prevention workflow.
 *
 * Identifies at-risk users, scores their churn risk 0–100,
 * and triggers an appropriate email intervention:
 *   30-50  → helpful tip email
 *   50-70  → personal check-in email
 *   70+    → 20% discount offer for next 3 months
 *
 * Triggered by: cron  0 10 * * *  (10:00 UTC daily)
 */

import { inngest } from "@/inngest/client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Resend } from "resend";

const FROM    = process.env.EMAIL_FROM ?? "ReleaseFlow <hello@releaseflow.app>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://releaseflow.app";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY!);
}

// ─── Risk scoring ─────────────────────────────────────────────────────────────

interface UserActivity {
  userId: string;
  email: string;
  name: string;
  planTier: string;
  daysSinceSignup: number;
  daysSinceLastAgentRun: number | null;
  agentRunsLast30Days: number;
  releasesTotal: number;
  contentApprovedLast30Days: number;
  contentGeneratedLast30Days: number;
}

interface RiskResult {
  score: number;
  factors: string[];
  tier: "low" | "medium" | "high" | "none";
}

function scoreChurnRisk(u: UserActivity): RiskResult {
  // Only analyse users who have been around for at least 7 days
  if (u.daysSinceSignup < 7) return { score: 0, factors: [], tier: "none" };

  const factors: string[] = [];
  let score = 0;

  // No activity at all in 7+ days
  if (u.daysSinceLastAgentRun === null || u.daysSinceLastAgentRun >= 7) {
    score += 30;
    factors.push("No agent activity in 7+ days");
  }

  // Very low run volume
  if (u.agentRunsLast30Days === 0) {
    score += 25;
    factors.push("Zero agent runs in 30 days");
  } else if (u.agentRunsLast30Days <= 2) {
    score += 10;
    factors.push("Fewer than 3 agent runs in 30 days");
  }

  // Never created a release
  if (u.releasesTotal === 0 && u.daysSinceSignup >= 14) {
    score += 20;
    factors.push("No releases created after 14+ days");
  }

  // Low content approval rate
  if (u.contentGeneratedLast30Days > 0) {
    const approvalRate = u.contentApprovedLast30Days / u.contentGeneratedLast30Days;
    if (approvalRate < 0.2) {
      score += 15;
      factors.push("Low content approval rate (<20%)");
    }
  }

  // Free tier with no upgrade after 21 days
  if (u.planTier === "free" && u.daysSinceSignup >= 21) {
    score += 10;
    factors.push("Still on free tier after 21 days");
  }

  const tier: RiskResult["tier"] =
    score >= 70 ? "high" :
    score >= 50 ? "medium" :
    score >= 30 ? "low" :
    "none";

  return { score: Math.min(score, 100), factors, tier };
}

// ─── Email content ────────────────────────────────────────────────────────────

function tipEmail(name: string) {
  return {
    subject: `Quick tip: get more from ReleaseFlow`,
    html: `
<p>Hi ${name},</p>
<p>Here's a quick tip to help you get more out of ReleaseFlow:</p>
<p><strong>Did you know?</strong> Once you approve a campaign, the AI generates ready-to-post content for Instagram, TikTok, Twitter, email, and press — all in your artist's voice.</p>
<p>If you haven't created a release yet, it only takes 2 minutes:</p>
<p><a href="${APP_URL}/releases/new">Create your first release →</a></p>
<p>Questions? Just reply to this email.</p>
<p>— The ReleaseFlow team</p>`,
  };
}

function checkInEmail(name: string) {
  return {
    subject: `Checking in — how's your ReleaseFlow experience?`,
    html: `
<p>Hi ${name},</p>
<p>I noticed you haven't been active on ReleaseFlow lately and wanted to check in personally.</p>
<p>Is there anything blocking you, or something we could do better? I read every reply and we genuinely improve based on your feedback.</p>
<p>If you'd like a quick walkthrough of the platform, just reply and I'll set one up.</p>
<p>— Mattias, founder of ReleaseFlow</p>`,
  };
}

function discountEmail(name: string, couponCode: string) {
  return {
    subject: `We'd love to keep you — here's 20% off your next 3 months`,
    html: `
<p>Hi ${name},</p>
<p>We noticed you haven't been using ReleaseFlow much recently. We'd love to earn your trust back.</p>
<p>As a thank-you for giving us a chance, here's a <strong>20% discount on your next 3 months</strong>:</p>
<p style="font-size:1.5rem;font-weight:bold;letter-spacing:0.1em;padding:16px;background:#f4f4f5;border-radius:8px;text-align:center">${couponCode}</p>
<p>Apply it at checkout or in your billing settings:</p>
<p><a href="${APP_URL}/settings/billing">Apply discount →</a></p>
<p>If there's something specific that hasn't been working for you, please reply — I want to fix it.</p>
<p>— Mattias, founder of ReleaseFlow</p>`,
  };
}

// ─── Inngest function ─────────────────────────────────────────────────────────

export const churnPrevention = inngest.createFunction(
  {
    id:      "churn-prevention",
    name:    "Daily Churn Prevention",
    retries: 1,
  },
  { cron: "0 10 * * *" },
  async ({ step, logger }) => {
    // Step 1: Identify at-risk users
    const atRiskUsers = await step.run("identify-at-risk-users", async () => {
      const supabase = supabaseAdmin;
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

      // Get all users on a paid plan or free plan who signed up >7 days ago
      const { data: users } = await supabase
        .from("users")
        .select("id, email, name, plan_tier, created_at")
        .lte("created_at", new Date(now.getTime() - 7 * 86400000).toISOString());

      if (!users?.length) return [];

      const userIds = users.map((u) => u.id as string);

      // Fetch activity signals in parallel
      const [agentRunsRes, releasesRes, contentRes] = await Promise.all([
        supabase.from("agent_runs")
          .select("user_id, created_at")
          .in("user_id", userIds)
          .gte("created_at", thirtyDaysAgo),
        supabase.from("releases")
          .select("id, artist_id")
          .in("artist_id",
            (await supabase.from("artists").select("id").in("user_id", userIds)).data?.map((a) => a.id as string) ?? []
          ),
        supabase.from("content_items")
          .select("id, status, created_at, campaign_id")
          .gte("created_at", thirtyDaysAgo),
      ]);

      const runsByUser = new Map<string, Date[]>();
      for (const r of agentRunsRes.data ?? []) {
        const uid = r.user_id as string;
        if (!runsByUser.has(uid)) runsByUser.set(uid, []);
        runsByUser.get(uid)!.push(new Date(r.created_at as string));
      }

      const releasesByUser = new Map<string, number>();
      // We need to correlate releases → artists → user_id
      // (simplified: count by checking artist ownership via earlier query)
      const { data: artists } = await supabase.from("artists").select("id, user_id").in("user_id", userIds);
      const artistToUser = new Map((artists ?? []).map((a) => [a.id as string, a.user_id as string]));
      for (const rel of releasesRes.data ?? []) {
        const uid = artistToUser.get(rel.artist_id as string);
        if (uid) releasesByUser.set(uid, (releasesByUser.get(uid) ?? 0) + 1);
      }

      const now_ = now.getTime();

      return users.map((u) => {
        const uid = u.id as string;
        const runs = runsByUser.get(uid) ?? [];
        const lastRun = runs.length > 0 ? Math.max(...runs.map((r) => r.getTime())) : null;

        const activity: UserActivity = {
          userId: uid,
          email: u.email as string,
          name: (u.name as string) ?? "there",
          planTier: (u.plan_tier as string) ?? "free",
          daysSinceSignup: Math.floor((now_ - new Date(u.created_at as string).getTime()) / 86400000),
          daysSinceLastAgentRun: lastRun !== null ? Math.floor((now_ - lastRun) / 86400000) : null,
          agentRunsLast30Days: runs.length,
          releasesTotal: releasesByUser.get(uid) ?? 0,
          contentApprovedLast30Days: (contentRes.data ?? []).filter((c) => c.status === "approved").length,
          contentGeneratedLast30Days: (contentRes.data ?? []).length,
        };

        return { activity, risk: scoreChurnRisk(activity) };
      }).filter((u) => u.risk.tier !== "none");
    });

    if (atRiskUsers.length === 0) {
      logger.info("No at-risk users found today");
      return { interventions: 0 };
    }

    logger.info(`Found ${atRiskUsers.length} at-risk users`);

    // Step 2: Send interventions
    const results = await step.run("send-interventions", async () => {
      const supabase = supabaseAdmin;
      const resend   = getResend();
      const sent: string[] = [];

      for (const { activity, risk } of atRiskUsers) {
        // Avoid re-sending to the same user within 7 days
        const { data: recent } = await supabase
          .from("churn_interventions")
          .select("id")
          .eq("user_id", activity.userId)
          .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
          .limit(1);

        if (recent && recent.length > 0) continue;

        let mail: { subject: string; html: string };
        let actionTaken: string;
        let couponCode = "";

        if (risk.tier === "high") {
          // Generate a simple coupon code (real impl would call Stripe API)
          couponCode = `RF20-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
          mail = discountEmail(activity.name, couponCode);
          actionTaken = "discount_offer";
        } else if (risk.tier === "medium") {
          mail = checkInEmail(activity.name);
          actionTaken = "checkin_email";
        } else {
          mail = tipEmail(activity.name);
          actionTaken = "tip_email";
        }

        try {
          await resend.emails.send({ from: FROM, to: activity.email, ...mail });
          await supabase.from("churn_interventions").insert({
            user_id:     activity.userId,
            risk_score:  risk.score,
            risk_factors: risk.factors,
            tier:         risk.tier,
            action_taken: actionTaken,
            email_sent_at: new Date().toISOString(),
            outcome:      "pending",
          });
          sent.push(activity.userId);
        } catch (err) {
          logger.error("Failed to send churn email", { userId: activity.userId, err });
        }
      }

      return sent;
    });

    return { interventions: results.length, userIds: results };
  }
);
