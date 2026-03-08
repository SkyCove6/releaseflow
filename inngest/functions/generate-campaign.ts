import { inngest } from "@/inngest/client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { canTransitionReleaseStatus, normalizeReleaseStatus } from "@/lib/release-status";
import { runAgentWithResilience } from "@/lib/agents/resilient-runner";

/**
 * Triggered by `release/created`.
 * Runs the Campaign Strategist Agent (stub — wire LLM when ready).
 */
export const generateCampaign = inngest.createFunction(
  {
    id: "generate-campaign",
    name: "Generate Release Campaign",
    retries: 3,
    throttle: { limit: 10, period: "1m" },
  },
  { event: "release/created" },
  async ({ event, step, logger }) => {
    const {
      releaseId,
      artistId,
      userId,
      title,
      type,
      releaseDate,
      traceId,
      requestId,
      idempotencyKey,
      actorId,
    } = event.data;

    const releaseContext = await step.run("fetch-release-context", async () => {
      const supabase = supabaseAdmin;
      const { data, error } = await supabase
        .from("releases")
        .select("*, artists(id, name, genre, voice_profile)")
        .eq("id", releaseId)
        .single();

      if (error) throw new Error(`Release not found: ${error.message}`);
      return data;
    });

    const currentStatus = normalizeReleaseStatus(releaseContext.status);
    if (currentStatus === "completed") {
      logger.info("Release already completed, skipping campaign generation", {
        releaseId,
        status: currentStatus,
      });
      return { releaseId, skipped: true };
    }

    await step.run("set-release-planned", async () => {
      const supabase = supabaseAdmin;
      const nextStatus =
        currentStatus === "draft"
          ? "planned"
          : currentStatus;
      if (nextStatus !== currentStatus && canTransitionReleaseStatus(currentStatus, nextStatus)) {
        const { error } = await supabase
          .from("releases")
          .update({ status: nextStatus })
          .eq("id", releaseId);
        if (error) throw new Error(`Failed to set release to ${nextStatus}: ${error.message}`);
      }
    });

    await step.sleep("rate-limit-pause", "1s");

    const existingCampaign = await step.run("check-existing-campaign", async () => {
      const supabase = supabaseAdmin;
      const { data: campaign } = await supabase
        .from("campaigns")
        .select("id, status")
        .eq("release_id", releaseId)
        .maybeSingle();
      return campaign;
    });

    if (existingCampaign) {
      logger.info("Campaign already exists, skipping regeneration", {
        releaseId,
        campaignId: existingCampaign.id,
        status: existingCampaign.status,
      });
      return { releaseId, campaignId: existingCampaign.id, reused: true };
    }

    const campaign = await step.run("run-campaign-strategist", async () => {
      logger.info("Generating campaign strategy", { releaseId, actorId, userId });

      const run = await runAgentWithResilience(
        {
          userId,
          agentName: "campaign-strategist",
          traceId,
          idempotencyKey,
          requestId,
          releaseId,
          input: {
            releaseId,
            artistId,
            type,
            title,
            releaseDate: releaseDate ?? "",
          },
        },
        async () => {
          const strategy = {
            approach: "organic-first",
            focus_platforms:
              type === "album"
                ? ["instagram", "tiktok", "press", "youtube"]
                : ["instagram", "tiktok"],
            key_message: `New ${type} "${title}" — coming soon.`,
            generated_by: "stub",
          };

          const weeksOut = type === "album" ? 6 : type === "ep" ? 4 : 3;
          const parsedReleaseDate = releaseDate
            ? new Date(releaseDate)
            : new Date(Date.now() + weeksOut * 7 * 24 * 60 * 60 * 1000);

          const timeline = {
            pre_release_weeks: weeksOut,
            release_date: parsedReleaseDate.toISOString().split("T")[0],
            milestones: Array.from({ length: weeksOut }, (_, i) => ({
              week: -(weeksOut - i),
              task: `Week ${i + 1} milestone — TBD by campaign manager`,
            })).concat([{ week: 0, task: "Release day push" }]),
          };

          const kpi_targets = {
            spotify_streams_day1: type === "album" ? 20000 : 5000,
            instagram_reach: 15000,
            playlist_adds: 5,
          };

          return {
            value: { strategy, timeline, kpi_targets },
            output: { strategy, timeline, kpi_targets },
            tokensUsed: 0,
            costCents: 0,
          };
        }
      );

      if (!run.ok) {
        throw new Error(run.error);
      }

      return run.value;
    });

    const inserted = await step.run("persist-campaign", async () => {
      const supabase = supabaseAdmin;
      const { data, error } = await supabase
        .from("campaigns")
        .insert({
          release_id: releaseId,
          strategy: campaign.strategy,
          timeline: campaign.timeline,
          kpi_targets: campaign.kpi_targets,
          budget_cents: 0,
          status: "draft",
        })
        .select("id")
        .single();

      if (error) throw new Error(`Failed to create campaign: ${error.message}`);

      return data;
    });

    return { releaseId, campaignId: inserted.id };
  }
);
