import { inngest } from "@/inngest/client";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Detects stalled lifecycle pipelines and writes alerts for admin monitoring.
 */
export const pipelineStallAlert = inngest.createFunction(
  {
    id: "pipeline-stall-alert",
    name: "Pipeline Stall Alert",
    retries: 1,
  },
  { cron: "*/15 * * * *" },
  async ({ step, logger }) => {
    const stale = await step.run("find-stale-releases", async () => {
      const supabase = supabaseAdmin;
      const cutoffIso = new Date(Date.now() - 120 * 60_000).toISOString();

      const { data: releases, error } = await supabase
        .from("releases")
        .select("id, title, status, updated_at")
        .eq("status", "planned")
        .lt("updated_at", cutoffIso)
        .limit(100);

      if (error) throw new Error(`Failed to read stale releases: ${error.message}`);
      return releases ?? [];
    });

    if (!stale.length) {
      logger.info("No stalled releases");
      return { staleCount: 0 };
    }

    await step.run("create-alerts", async () => {
      const supabase = supabaseAdmin;
      const rows = stale.map((release) => ({
        agent_name: "pipeline-health-check",
        failure_count: 1,
        last_error: `Release ${release.id} (${release.title}) stalled in ${release.status}`,
        notified_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from("agent_alerts").insert(rows);
      if (error) throw new Error(`Failed to write pipeline alerts: ${error.message}`);
      return rows.length;
    });

    return { staleCount: stale.length };
  }
);
