/**
 * Admin metrics tRPC router.
 * All procedures are admin-only (env var ADMIN_USER_IDS check).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { getStripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

function assertAdmin(userId: string) {
  const adminIds = (process.env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim());
  if (!adminIds.includes(userId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return startOfDay(d);
}

function parseIsoDate(input?: string | null) {
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const adminRouter = createTRPCRouter({

  /** High-level business metrics snapshot */
  metrics: protectedProcedure.query(async ({ ctx }) => {
    assertAdmin(ctx.user.id);
    const supabase = supabaseAdmin;

    const thirtyDaysAgo = daysAgo(30).toISOString();
    const sevenDaysAgo  = daysAgo(7).toISOString();

    const [
      totalUsersRes,
      newUsersRes,
      agentRunsRes,
      agentRunsWeekRes,
      campaignsRes,
      contentRes,
      failedRunsRes,
    ] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("users").select("id", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo),
      supabase.from("agent_runs").select("id, cost_cents, status", { count: "exact" })
        .gte("created_at", thirtyDaysAgo),
      supabase.from("agent_runs").select("id", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo),
      supabase.from("campaigns").select("id", { count: "exact", head: true }),
      supabase.from("content_items").select("id", { count: "exact", head: true }),
      supabase.from("agent_runs").select("id", { count: "exact", head: true })
        .eq("status", "failed")
        .gte("created_at", sevenDaysAgo),
    ]);

    const runs = agentRunsRes.data ?? [];
    const totalCostCents = runs.reduce((s, r) => s + ((r.cost_cents as number) ?? 0), 0);
    const successRate = runs.length > 0
      ? Math.round((runs.filter((r) => r.status === "completed").length / runs.length) * 100)
      : 100;

    // Pull MRR from Stripe subscriptions (active only)
    let mrrCents = 0;
    try {
      const stripe = getStripe();
      const subs = await stripe.subscriptions.list({ status: "active", limit: 100, expand: ["data.plan"] });
      mrrCents = subs.data.reduce((sum, sub) => {
        const amount = sub.items.data[0]?.price.unit_amount ?? 0;
        const interval = sub.items.data[0]?.price.recurring?.interval;
        return sum + (interval === "year" ? Math.round(amount / 12) : amount);
      }, 0);
    } catch {
      // Stripe may not be configured in dev
    }

    return {
      totalUsers:        totalUsersRes.count ?? 0,
      newUsersThisWeek:  newUsersRes.count ?? 0,
      agentRunsThisMonth: agentRunsRes.count ?? 0,
      agentRunsThisWeek: agentRunsWeekRes.count ?? 0,
      costCentsThisMonth: totalCostCents,
      successRate,
      activeCampaigns:   campaignsRes.count ?? 0,
      totalContent:      contentRes.count ?? 0,
      failedRunsThisWeek: failedRunsRes.count ?? 0,
      mrrCents,
    };
  }),

  /** Daily signups over last N days for the chart */
  signupTimeline: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);
      const supabase = supabaseAdmin;

      const { data } = await supabase
        .from("users")
        .select("created_at")
        .gte("created_at", daysAgo(input.days).toISOString())
        .order("created_at", { ascending: true });

      // Bucket by date
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        const d = (row.created_at as string).slice(0, 10);
        counts[d] = (counts[d] ?? 0) + 1;
      }
      return Object.entries(counts).map(([date, count]) => ({ date, count }));
    }),

  /** Daily agent-run cost (cents) per agent over last N days */
  agentCostTimeline: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);
      const supabase = supabaseAdmin;

      const { data } = await supabase
        .from("agent_runs")
        .select("agent_name, cost_cents, created_at")
        .gte("created_at", daysAgo(input.days).toISOString())
        .order("created_at", { ascending: true });

      // Accumulate cost per date per agent
      const map: Record<string, Record<string, number>> = {};
      for (const row of data ?? []) {
        const d = (row.created_at as string).slice(0, 10);
        if (!map[d]) map[d] = {};
        map[d]![row.agent_name as string] = (map[d]![row.agent_name as string] ?? 0) +
          ((row.cost_cents as number) ?? 0);
      }
      return Object.entries(map).map(([date, agents]) => ({ date, ...agents }));
    }),

  /** Agent success-rate per agent over last N days */
  agentSuccessRates: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);
      const supabase = supabaseAdmin;

      const { data } = await supabase
        .from("agent_runs")
        .select("agent_name, status")
        .gte("created_at", daysAgo(input.days).toISOString());

      const totals: Record<string, { total: number; success: number }> = {};
      for (const row of data ?? []) {
        const key = row.agent_name as string;
        if (!totals[key]) totals[key] = { total: 0, success: 0 };
        totals[key]!.total += 1;
        if (row.status === "completed") totals[key]!.success += 1;
      }
      return Object.entries(totals).map(([agent, { total, success }]) => ({
        agent,
        successRate: total > 0 ? Math.round((success / total) * 100) : 100,
        total,
      }));
    }),

  /** Plan distribution */
  planDistribution: protectedProcedure.query(async ({ ctx }) => {
    assertAdmin(ctx.user.id);
    const supabase = supabaseAdmin;

    const { data } = await supabase.from("users").select("plan_tier");
    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const t = (row.plan_tier as string) ?? "free";
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return Object.entries(counts).map(([plan, count]) => ({ plan, count }));
  }),

  /** Recent error log from agent_runs */
  errorLog: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);
      const supabase = supabaseAdmin;

      const { data } = await supabase
        .from("agent_runs")
        .select("id, agent_name, error, created_at, user_id")
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(input.limit);
      return data ?? [];
    }),

  /** Releases that appear to be stalled in workflow stages */
  staleReleases: protectedProcedure
    .input(
      z.object({
        minutesThreshold: z.number().min(30).max(1440).default(120),
        limit: z.number().min(1).max(100).default(25),
      })
    )
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);
      const supabase = supabaseAdmin;

      const cutoff = new Date(Date.now() - input.minutesThreshold * 60_000).toISOString();

      const { data: releases, error } = await supabase
        .from("releases")
        .select("id, title, status, updated_at, artist_id")
        .in("status", ["planned", "active"])
        .lt("updated_at", cutoff)
        .order("updated_at", { ascending: false })
        .limit(input.limit);

      if (error) throw error;

      const releaseIds = (releases ?? []).map((r) => r.id);
      if (!releaseIds.length) return [];

      const { data: campaignRows, error: campaignError } = await supabase
        .from("campaigns")
        .select("id, release_id")
        .in("release_id", releaseIds);
      if (campaignError) throw campaignError;

      const campaignRowsSafe = campaignRows ?? [];
      const campaignIds = campaignRowsSafe.map((row) => row.id) as string[];
      let contentRows: { campaign_id: string }[] = [];
      const pitchRows: { release_id: string }[] = [];
      if (campaignIds.length > 0) {
        const { data: content, error: contentError } = await supabase
          .from("content_items")
          .select("campaign_id")
          .in("campaign_id", campaignIds);
        if (contentError) throw contentError;
        contentRows = content as { campaign_id: string }[];

        const { data: pitches, error: pitchError } = await supabase
          .from("playlist_pitches")
          .select("release_id")
          .in("release_id", releaseIds);
        if (pitchError) throw pitchError;
        pitchRows.push(...((pitches ?? []) as { release_id: string }[]));
      }

      const campaignByRelease = new Map<string, boolean>();
      for (const row of campaignRowsSafe) {
        campaignByRelease.set(row.release_id as string, true);
      }

      const contentByCampaign = new Map<string, boolean>();
      for (const row of contentRows) {
        contentByCampaign.set(row.campaign_id as string, true);
      }

      const pitchesByRelease = new Map<string, number>();
      for (const row of pitchRows) {
        const current = pitchesByRelease.get(row.release_id as string) ?? 0;
        pitchesByRelease.set(row.release_id as string, current + 1);
      }

      return (releases ?? []).map((release) => {
        const hasCampaign = campaignByRelease.get(release.id as string) === true;
        const campaignForRelease = campaignRowsSafe.find((r) => r.release_id === release.id);
        const hasContent = hasCampaign
          ? Boolean(campaignForRelease?.id && contentByCampaign.get(campaignForRelease.id as string))
          : false;
        const pitchCount = pitchesByRelease.get(release.id as string) ?? 0;
        const minutesSinceUpdate = Math.max(
          0,
          Math.floor((Date.now() - new Date(release.updated_at as string).getTime()) / 60000)
        );
        return {
          ...release,
          hasCampaign,
          hasContent,
          pitchCount,
          minutesSinceUpdate,
          staleReason:
            release.status === "planned" && !hasCampaign
              ? "Campaign not generated"
              : release.status === "planned" && !hasContent
                ? "Campaign exists but content not generated"
                : "No activity detected since last transition",
        };
      });
    }),

  /** Filterable run feed for /admin/agents */
  agentRunsDashboard: protectedProcedure
    .input(
      z.object({
        agentName: z.string().optional(),
        status: z.enum(["running", "completed", "failed"]).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().min(1).max(500).default(200),
      })
    )
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);
      const supabase = supabaseAdmin;

      let query = supabase
        .from("agent_runs")
        .select("id, user_id, agent_name, status, duration_ms, cost_cents, tokens_used, error, created_at, input, output")
        .order("created_at", { ascending: false })
        .limit(input.limit);

      if (input.agentName) query = query.eq("agent_name", input.agentName);
      if (input.status) query = query.eq("status", input.status);

      const dateFrom = parseIsoDate(input.dateFrom);
      const dateTo = parseIsoDate(input.dateTo);
      if (dateFrom) query = query.gte("created_at", dateFrom);
      if (dateTo) query = query.lte("created_at", dateTo);

      const { data, error } = await query;
      if (error) throw error;

      const rows = data ?? [];
      const failed = rows.filter((row) => row.status === "failed").length;
      const avgLatency =
        rows.length > 0
          ? Math.round(
              rows.reduce((sum, row) => sum + Number(row.duration_ms ?? 0), 0) / rows.length
            )
          : 0;
      const avgCost =
        rows.length > 0
          ? Math.round(
              rows.reduce((sum, row) => sum + Number(row.cost_cents ?? 0), 0) / rows.length
            )
          : 0;

      const runsByUserMap = new Map<string, number>();
      for (const row of rows) {
        const userId = (row.user_id as string | null) ?? "anonymous";
        runsByUserMap.set(userId, (runsByUserMap.get(userId) ?? 0) + 1);
      }

      const runsPerUser = Array.from(runsByUserMap.entries())
        .map(([userId, count]) => ({ userId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      return {
        runs: rows,
        metrics: {
          totalRuns: rows.length,
          failedRuns: failed,
          failureRate: rows.length ? Number(((failed / rows.length) * 100).toFixed(2)) : 0,
          averageLatencyMs: avgLatency,
          averageCostCents: avgCost,
        },
        runsPerUser,
      };
    }),

  /** Event debugger log feed */
  recentEventLogs: protectedProcedure
    .input(
      z.object({
        eventName: z.string().optional(),
        status: z.enum(["sent", "failed"]).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().min(1).max(300).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);
      const supabase = supabaseAdmin;

      let query = supabase
        .from("event_logs")
        .select("id, event_name, event_id, trace_id, idempotency_key, status, error, payload, created_at, user_id")
        .order("created_at", { ascending: false })
        .limit(input.limit);

      if (input.eventName) query = query.eq("event_name", input.eventName);
      if (input.status) query = query.eq("status", input.status);

      const dateFrom = parseIsoDate(input.dateFrom);
      const dateTo = parseIsoDate(input.dateTo);
      if (dateFrom) query = query.gte("created_at", dateFrom);
      if (dateTo) query = query.lte("created_at", dateTo);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    }),

  /** Workflow runs correlated by trace id or release id */
  workflowRuns: protectedProcedure
    .input(
      z.object({
        traceId: z.string().optional(),
        releaseId: z.string().optional(),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);
      const supabase = supabaseAdmin;

      const { data, error } = await supabase
        .from("agent_runs")
        .select("id, user_id, agent_name, status, duration_ms, cost_cents, tokens_used, error, created_at, input, output")
        .order("created_at", { ascending: false })
        .limit(400);

      if (error) throw error;
      const rows = data ?? [];

      const filtered = rows.filter((row) => {
        const inputJson = (row.input ?? {}) as Record<string, unknown>;
        const traceMatches = input.traceId
          ? (inputJson.trace_id === input.traceId || inputJson.traceId === input.traceId)
          : true;
        const releaseMatches = input.releaseId
          ? (inputJson.release_id === input.releaseId || inputJson.releaseId === input.releaseId)
          : true;
        return traceMatches && releaseMatches;
      });

      return filtered.slice(0, input.limit);
    }),

  /** User cohort retention — week-0 signups and what % still active N weeks later */
  cohortRetention: protectedProcedure.query(async ({ ctx }) => {
    assertAdmin(ctx.user.id);
    const supabase = supabaseAdmin;

    // Get signups from last 8 weeks, grouped by ISO week
    const { data: users } = await supabase
      .from("users")
      .select("id, created_at")
      .gte("created_at", daysAgo(56).toISOString());

    // Get agent_runs to determine "active" (ran at least 1 agent)
    const { data: runs } = await supabase
      .from("agent_runs")
      .select("user_id, created_at")
      .gte("created_at", daysAgo(56).toISOString());

    const runsByUser = new Map<string, Date[]>();
    for (const r of runs ?? []) {
      const uid = r.user_id as string;
      if (!runsByUser.has(uid)) runsByUser.set(uid, []);
      runsByUser.get(uid)!.push(new Date(r.created_at as string));
    }

    // Group users by sign-up week (YYYY-WW)
    const cohorts: Record<string, { users: Array<{ id: string; signedUpAt: Date }>; week: string }> = {};
    for (const u of users ?? []) {
      const d = new Date(u.created_at as string);
      const wk = `${d.getFullYear()}-W${String(Math.ceil(d.getDate() / 7)).padStart(2, "0")}`;
      if (!cohorts[wk]) cohorts[wk] = { users: [], week: wk };
      cohorts[wk]!.users.push({ id: u.id as string, signedUpAt: d });
    }

    return Object.entries(cohorts).map(([week, { users: cohortUsers }]) => {
      const signups = cohortUsers.length;
      // Week 1 = active within 7 days of signup; Week 4 = within 28 days
      const week1 = cohortUsers.filter((u) => {
        const runs_ = runsByUser.get(u.id) ?? [];
        return runs_.some((r) => r.getTime() - u.signedUpAt.getTime() < 7 * 86400000);
      }).length;
      const week4 = cohortUsers.filter((u) => {
        const runs_ = runsByUser.get(u.id) ?? [];
        return runs_.some((r) => {
          const diff = r.getTime() - u.signedUpAt.getTime();
          return diff >= 0 && diff < 28 * 86400000;
        });
      }).length;
      return {
        week,
        signups,
        week1Rate: signups > 0 ? Math.round((week1 / signups) * 100) : 0,
        week4Rate: signups > 0 ? Math.round((week4 / signups) * 100) : 0,
      };
    });
  }),
});
