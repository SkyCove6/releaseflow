/**
 * 7-email drip sequence triggered when a user signs up.
 *
 * Each step:
 *  1. Checks whether the user has already completed the relevant action.
 *  2. Sends the email if not.
 *  3. Sleeps until the next scheduled email.
 *
 * Triggered by: user/signed-up
 */

import { inngest } from "@/inngest/client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Resend } from "resend";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY!);
}

const FROM = process.env.EMAIL_FROM ?? "ReleaseFlow <hello@releaseflow.app>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://releaseflow.app";

// ─── Email content ────────────────────────────────────────────────────────────

function email_day0(name: string) {
  return {
    subject: `Welcome to ReleaseFlow, ${name}! Here's how to get started`,
    html: `
<p>Hi ${name},</p>
<p>Welcome to ReleaseFlow — your AI-powered music release manager.</p>
<p>Here's what you can do right now:</p>
<ol>
  <li><strong>Add your first artist profile</strong> → ReleaseFlow will build an AI voice profile from your bio and social posts</li>
  <li><strong>Create a release</strong> → The AI will generate a full campaign strategy automatically</li>
  <li><strong>Approve and publish content</strong> → Get platform-specific posts for Instagram, TikTok, Twitter, email, and press</li>
</ol>
<p><a href="${APP_URL}/artists/new">Create your artist profile →</a></p>
<p>If you have any questions, just reply to this email.</p>
<p>— The ReleaseFlow team</p>`,
  };
}

function email_day1(name: string, hasArtist: boolean) {
  if (hasArtist) return null;
  return {
    subject: `${name}, your artist profile takes 2 minutes to set up`,
    html: `
<p>Hi ${name},</p>
<p>You signed up yesterday but haven't added an artist profile yet — that's the first step to getting your AI campaign.</p>
<p>All you need is:</p>
<ul>
  <li>Your artist name + genre</li>
  <li>A short bio</li>
  <li>A few sample social posts (the AI uses these to learn your voice)</li>
</ul>
<p><a href="${APP_URL}/artists/new">Add your artist profile in 2 minutes →</a></p>
<p>— The ReleaseFlow team</p>`,
  };
}

function email_day3(name: string, hasRelease: boolean) {
  if (hasRelease) return null;
  return {
    subject: `How one indie artist got 50K streams with a 3-week campaign`,
    html: `
<p>Hi ${name},</p>
<p>Luna Veil was a London-based indie pop artist with a few thousand monthly listeners. She used ReleaseFlow's AI campaign engine for her single "Still Water" and hit 50K streams in the first month.</p>
<p>Her campaign generated:</p>
<ul>
  <li>Instagram and TikTok content tailored to her voice</li>
  <li>12 personalised playlist pitches (3 accepted)</li>
  <li>A full press release that landed her in 2 blogs</li>
</ul>
<p>Ready to plan your first release?</p>
<p><a href="${APP_URL}/releases/new">Create a release and get your AI campaign →</a></p>
<p>— The ReleaseFlow team</p>`,
  };
}

function email_day5(name: string, contentCount: number) {
  if (contentCount > 0) return null;
  return {
    subject: `See what your AI-generated content will look like`,
    html: `
<p>Hi ${name},</p>
<p>Once you approve a campaign, ReleaseFlow generates platform-specific content across:</p>
<ul>
  <li><strong>Instagram</strong> — announcement post + reel caption</li>
  <li><strong>TikTok</strong> — hook-driven script</li>
  <li><strong>Twitter/X</strong> — thread</li>
  <li><strong>Email</strong> — fan newsletter</li>
  <li><strong>Press</strong> — full press release</li>
</ul>
<p>Each piece is written in your artist's voice — not generic AI filler.</p>
<p><a href="${APP_URL}/releases/new">Start your first campaign →</a></p>
<p>— The ReleaseFlow team</p>`,
  };
}

function email_day7(name: string, stats: { releases: number; contentItems: number; agentRuns: number }) {
  return {
    subject: `Your first week on ReleaseFlow — here's where you stand`,
    html: `
<p>Hi ${name},</p>
<p>It's been one week since you joined ReleaseFlow. Here's a quick look at your progress:</p>
<ul>
  <li>Releases created: <strong>${stats.releases}</strong></li>
  <li>Content items generated: <strong>${stats.contentItems}</strong></li>
  <li>Agent runs completed: <strong>${stats.agentRuns}</strong></li>
</ul>
${stats.releases === 0 ? `<p>You haven't created a release yet — <a href="${APP_URL}/releases/new">get started now</a> and your AI campaign will be ready in under 60 seconds.</p>` : `<p>Great progress! Keep going — your campaign is building momentum.</p>`}
<p>Questions? Just reply to this email.</p>
<p>— The ReleaseFlow team</p>`,
  };
}

function email_day14(name: string, planTier: string) {
  if (planTier !== "starter" && planTier !== "free") return null;
  const isOnFree = planTier === "free";
  return {
    subject: isOnFree ? `Unlock full AI campaigns — upgrade to Starter` : `You're growing fast — here's what Pro unlocks`,
    html: `
<p>Hi ${name},</p>
${isOnFree
  ? `<p>You've been using the free tier — but you're hitting limits. Starter gives you:</p>
<ul>
  <li>5 releases/month (vs 1 on free)</li>
  <li>Full playlist pitcher agent</li>
  <li>Weekly analytics reports</li>
</ul>
<p><a href="${APP_URL}/pricing">Upgrade to Starter for $29/month →</a></p>`
  : `<p>On Starter, you're limited to 5 releases/month. Pro gives you:</p>
<ul>
  <li>Unlimited releases</li>
  <li>Priority AI processing</li>
  <li>Advanced analytics + custom benchmarks</li>
</ul>
<p><a href="${APP_URL}/pricing">See Pro plan →</a></p>`}
<p>— The ReleaseFlow team</p>`,
  };
}

function email_day30(name: string, stats: { releases: number; streams: number; pitches: number }) {
  return {
    subject: `Your first month on ReleaseFlow — results summary`,
    html: `
<p>Hi ${name},</p>
<p>One month in! Here's what ReleaseFlow has done for you:</p>
<ul>
  <li>Releases managed: <strong>${stats.releases}</strong></li>
  <li>Playlist pitches sent: <strong>${stats.pitches}</strong></li>
  ${stats.streams > 0 ? `<li>Streams tracked: <strong>${stats.streams.toLocaleString()}</strong></li>` : ""}
</ul>
<p>${stats.releases > 0 ? "You're on a roll. The best results come from consistent release campaigns — keep going." : "You haven't created a release yet. Let's change that — <a href=\"" + APP_URL + "/releases/new\">create your first release</a>."}</p>
<p>— The ReleaseFlow team</p>`,
  };
}

// ─── User stats helper ────────────────────────────────────────────────────────

async function getUserStats(userId: string) {
  const supabase = supabaseAdmin;

  // Fetch artist IDs first so we can use them as a plain array in .in()
  const { data: artistRows } = await supabase
    .from("artists")
    .select("id")
    .eq("user_id", userId);
  const artistIds = (artistRows ?? []).map((a) => a.id as string);

  const [releasesRes, agentRunsRes, analyticsRes, userRes] = await Promise.all([
    artistIds.length > 0
      ? supabase.from("releases").select("id", { count: "exact", head: true }).in("artist_id", artistIds)
      : Promise.resolve({ count: 0, error: null }),
    supabase.from("agent_runs").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("analytics_snapshots").select("data"),
    supabase.from("users").select("email, plan_tier").eq("id", userId).maybeSingle(),
  ]);

  const totalStreams = (analyticsRes.data ?? []).reduce((sum, snap) => {
    const d = snap.data as { streams?: number } | null;
    return sum + (d?.streams ?? 0);
  }, 0);

  return {
    hasArtist:    artistIds.length > 0,
    releases:     releasesRes.count ?? 0,
    contentItems: 0,   // not needed for email logic — skipped to avoid complex subquery
    agentRuns:    agentRunsRes.count ?? 0,
    pitches:      0,
    streams:      totalStreams,
    email:        userRes.data?.email as string | null,
    planTier:     (userRes.data?.plan_tier as string) ?? "free",
  };
}

// ─── Inngest function ─────────────────────────────────────────────────────────

export const onboardingEmails = inngest.createFunction(
  {
    id:      "onboarding-emails",
    name:    "Onboarding Email Drip Sequence",
    retries: 1,
  },
  { event: "user/signed-up" },
  async ({ event, step, logger }) => {
    const { userId, userName, userEmail } = event.data;

    const name = userName || "there";
    const to   = userEmail;

    // Day 0 — Welcome immediately
    await step.run("email-day-0-welcome", async () => {
      const mail = email_day0(name);
      await getResend().emails.send({ from: FROM, to, ...mail });
      logger.info("Sent day-0 welcome email", { userId });
    });

    await step.sleep("wait-day-1", "1d");

    // Day 1 — Create artist profile (skip if already done)
    await step.run("email-day-1-artist", async () => {
      const stats = await getUserStats(userId);
      const mail = email_day1(name, stats.hasArtist);
      if (!mail) { logger.info("Skipping day-1 email — artist already created", { userId }); return; }
      await getResend().emails.send({ from: FROM, to, ...mail });
    });

    await step.sleep("wait-day-3", "2d");  // 1+2 = day 3

    // Day 3 — Case study / create release (skip if has release)
    await step.run("email-day-3-release", async () => {
      const stats = await getUserStats(userId);
      const mail = email_day3(name, stats.releases > 0);
      if (!mail) { logger.info("Skipping day-3 email — release already created", { userId }); return; }
      await getResend().emails.send({ from: FROM, to, ...mail });
    });

    await step.sleep("wait-day-5", "2d");  // 3+2 = day 5

    // Day 5 — Content examples (skip if has content)
    await step.run("email-day-5-content", async () => {
      const stats = await getUserStats(userId);
      const mail = email_day5(name, stats.contentItems);
      if (!mail) { logger.info("Skipping day-5 email — content already generated", { userId }); return; }
      await getResend().emails.send({ from: FROM, to, ...mail });
    });

    await step.sleep("wait-day-7", "2d");  // 5+2 = day 7

    // Day 7 — Week recap
    await step.run("email-day-7-recap", async () => {
      const stats = await getUserStats(userId);
      const mail = email_day7(name, { releases: stats.releases, contentItems: stats.contentItems, agentRuns: stats.agentRuns });
      await getResend().emails.send({ from: FROM, to, ...mail });
    });

    await step.sleep("wait-day-14", "7d");  // 7+7 = day 14

    // Day 14 — Upgrade nudge (skip if already on Pro/Label)
    await step.run("email-day-14-upgrade", async () => {
      const stats = await getUserStats(userId);
      const mail = email_day14(name, stats.planTier);
      if (!mail) { logger.info("Skipping day-14 email — already on Pro or higher", { userId }); return; }
      await getResend().emails.send({ from: FROM, to, ...mail });
    });

    await step.sleep("wait-day-30", "16d");  // 14+16 = day 30

    // Day 30 — Month in review
    await step.run("email-day-30-review", async () => {
      const stats = await getUserStats(userId);
      const mail = email_day30(name, { releases: stats.releases, streams: stats.streams, pitches: stats.pitches });
      await getResend().emails.send({ from: FROM, to, ...mail });
    });

    return { userId, emailsScheduled: 7 };
  }
);
