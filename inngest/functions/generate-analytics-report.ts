import { inngest } from "@/inngest/client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  interpretAnalytics,
  type SpotifyAnalytics,
  type AppleAnalytics,
  type YouTubeAnalytics,
  type InstagramInsights,
  type TikTokAnalytics,
  type CampaignPlan,
  type AnalyticsReport,
} from "@/agents/analytics-interpreter";
import { sendWeeklyReportEmail } from "@/lib/resend";
import { runAgentWithResilience } from "@/lib/agents/resilient-runner";

/**
 * Triggered by `analytics/report.requested` (on-demand or by the weekly cron).
 *
 * Steps:
 *   1. fetch-analytics-data   — load snapshots + campaign plan from DB
 *   2. rate-limit-pause       — 1s breathing room
 *   3. run-analytics-agent    — call the Analytics Interpreter Agent
 *   4. send-report-email      — email the HTML report (if reportEmail provided)
 */
export const generateAnalyticsReport = inngest.createFunction(
  {
    id: "generate-analytics-report",
    name: "Generate Analytics Report",
    retries: 2,
    throttle: { limit: 10, period: "1m" },
  },
  { event: "analytics/report.requested" },
  async ({ event, step, logger }) => {
    const { releaseId, userId, title, artistName, genre, dateRange, reportEmail } =
      event.data;

    // ── Step 1: fetch analytics snapshots + campaign from DB ───────────────
    const { dataSources, previousReports, campaignPlan } = await step.run(
      "fetch-analytics-data",
      async () => {
        const supabase = supabaseAdmin;

        // Fetch all snapshots for this release in the date range
        const { data: snapshots } = await supabase
          .from("analytics_snapshots")
          .select("source, data, snapshot_date")
          .eq("release_id", releaseId)
          .gte("snapshot_date", dateRange.start)
          .lte("snapshot_date", dateRange.end)
          .order("snapshot_date", { ascending: false });

        // Group by source — take most recent per source
        const bySource: Record<string, Record<string, unknown>> = {};
        for (const snap of snapshots ?? []) {
          if (!bySource[snap.source]) {
            bySource[snap.source] = snap.data as Record<string, unknown>;
          }
        }

        const dataSources = {
          spotify:   (bySource["spotify"]   ?? null) as SpotifyAnalytics | null,
          apple:     (bySource["apple"]     ?? null) as AppleAnalytics | null,
          youtube:   (bySource["youtube"]   ?? null) as YouTubeAnalytics | null,
          instagram: (bySource["instagram"] ?? null) as InstagramInsights | null,
          tiktok:    (bySource["tiktok"]    ?? null) as TikTokAnalytics | null,
        };

        // Load the 3 most recent previous agent_runs for this release
        const { data: runs } = await supabase
          .from("agent_runs")
          .select("output")
          .eq("agent_name", "analytics-interpreter")
          .contains("input", { releaseId })
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(3);

        const previousReports: AnalyticsReport[] = (runs ?? [])
          .map((r) => {
            try {
              return (r.output as { report?: unknown }).report as AnalyticsReport | undefined;
            } catch {
              return undefined;
            }
          })
          .filter((r): r is AnalyticsReport => r !== undefined);

        // Load active campaign plan for this release
        const { data: campaign } = await supabase
          .from("campaigns")
          .select("strategy, timeline, kpi_targets")
          .eq("release_id", releaseId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const campaignPlan: CampaignPlan = campaign ?? {};

        return { dataSources, previousReports, campaignPlan };
      }
    );

    await step.sleep("rate-limit-pause", "1s");

    // ── Step 2: run the analytics interpreter agent ────────────────────────
    const agentResult = await step.run("run-analytics-agent", async () => {
      logger.info("Running analytics interpreter", { releaseId, dateRange });

      const run = await runAgentWithResilience(
        {
          userId,
          agentName: "analytics-interpreter",
          traceId: event.data.traceId,
          idempotencyKey: event.data.idempotencyKey,
          requestId: event.data.requestId,
          releaseId,
          input: {
            releaseId,
            artistId: event.data.artistId,
            dateRangeStart: dateRange.start,
            dateRangeEnd: dateRange.end,
          },
        },
        async () => {
          const result = await interpretAnalytics(
            {
              releaseId,
              releaseTitle: title,
              artistName,
              genre,
              dateRange,
              dataSources,
              previousReports,
              campaignPlan,
              userId,
            },
            { skipRunLogging: true }
          );

          if (!result.ok) throw new Error(`Analytics agent failed: ${result.error}`);

          return {
            value: {
              reportJson: result.report,
              htmlReport: result.htmlReport,
              tokensUsed: result.tokensUsed,
              costCents: result.costCents,
              durationMs: result.durationMs,
            },
            output: {
              highlights: result.report.highlights,
              recommendations: result.report.recommendations.length,
            },
            tokensUsed: result.tokensUsed,
            costCents: result.costCents,
          };
        }
      );

      if (!run.ok) {
        throw new Error(run.error);
      }

      return run.value;
    });

    // ── Step 3: email the report (optional) ───────────────────────────────
    if (reportEmail) {
      await step.run("send-report-email", async () => {
        logger.info("Sending analytics report email", { to: reportEmail, releaseId });
        await sendWeeklyReportEmail(
          reportEmail,
          title,
          agentResult.reportJson,
          agentResult.htmlReport
        );
      });
    }

    await step.run("mark-release-completed", async () => {
      const supabase = supabaseAdmin;
      const { data } = await supabase
        .from("releases")
        .select("status")
        .eq("id", releaseId)
        .single();

      if (data?.status === "active") {
        const { error } = await supabase
          .from("releases")
          .update({ status: "completed" })
          .eq("id", releaseId);
        if (error) {
          throw new Error(`Failed to mark release completed: ${error.message}`);
        }
      }

      return true;
    });

    return {
      releaseId,
      highlights: agentResult.reportJson.highlights,
      tokensUsed: agentResult.tokensUsed,
      costCents:  agentResult.costCents,
      emailSent:  !!reportEmail,
    };
  }
);
