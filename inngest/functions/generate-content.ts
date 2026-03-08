import { inngest } from "@/inngest/client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { runAgentWithResilience } from "@/lib/agents/resilient-runner";

const CONTENT_MATRIX: Array<{
  platform: "instagram" | "tiktok" | "twitter" | "email" | "press";
  content_type: "post" | "reel" | "thread" | "newsletter" | "press_release";
  label: string;
}> = [
  { platform: "instagram", content_type: "post", label: "Announcement post" },
  { platform: "instagram", content_type: "reel", label: "Teaser reel caption" },
  { platform: "tiktok", content_type: "reel", label: "TikTok hook" },
  { platform: "twitter", content_type: "thread", label: "Release thread" },
  { platform: "email", content_type: "newsletter", label: "Fan newsletter" },
  { platform: "press", content_type: "press_release", label: "Press release" },
];

/**
 * Triggered by `campaign/approved`.
 * Runs the Content Writer Agent (stub — wire LLM when ready).
 *
 * Steps:
 *   1. fetch-campaign-context — load campaign + release + artist + voice profile
 *   2. generate-content-{platform} — content generation per surface
 *   3. persist-content-items — bulk insert
 */
export const generateContent = inngest.createFunction(
  {
    id: "generate-content",
    name: "Generate Campaign Content",
    retries: 2,
    throttle: { limit: 3, period: "1m" },
  },
  { event: "campaign/approved" },
  async ({ event, step, logger }) => {
    const {
      campaignId,
      releaseId,
      artistId,
      userId,
      traceId,
      requestId,
      idempotencyKey,
    } = event.data;

    const context = await step.run("fetch-campaign-context", async () => {
      const supabase = supabaseAdmin;
      const { data, error } = await supabase
        .from("campaigns")
        .select(
          `*, releases(
            id, title, type, release_date, status,
            artists(id, name, genre, voice_profile)
          )`
        )
        .eq("id", campaignId)
        .single();

      if (error) throw new Error(`Campaign not found: ${error.message}`);
      return data;
    });

    const release = context.releases as {
      id: string;
      title: string;
      type: string;
      status: string;
    } | null;
    const artist = Array.isArray((context.releases as { artists?: unknown } | null)?.artists)
      ? ((context.releases as { artists?: unknown }).artists as { name?: string }[])[0]
      : (context.releases as { artists?: unknown } | null)?.artists as { name?: string } | null;

    if (!release || !artist) {
      throw new Error("Campaign context missing release or artist");
    }

    if (release.status === "draft") {
      logger.info("Campaign not approved, skipping content generation", { campaignId, status: release.status });
      return { campaignId, skipped: true, reason: "campaign-not-approved" };
    }

    const existingCount = await step.run("check-existing-content", async () => {
      const supabase = supabaseAdmin;
      const { count, error } = await supabase
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId);
      if (error) throw new Error(`Failed to check existing content: ${error.message}`);
      return count ?? 0;
    });

    if (existingCount > 0) {
      logger.info("Content already exists for campaign, skipping generation", { campaignId });
      return { campaignId, skipped: true };
    }

    const generatedItems: Array<{
      platform: string;
      content_type: string;
      body: string;
    }> = [];

    for (const item of CONTENT_MATRIX) {
      await step.sleep(`rate-limit-${item.platform}-${item.content_type}`, "2s");

      const generated = await step.run(
        `generate-content-${item.platform}-${item.content_type}`,
        async () => {
          logger.info(`Generating ${item.label}`, { campaignId, platform: item.platform });
          const releaseTitle = release?.title ?? "Untitled";
          const artistName = artist?.name ?? "the artist";

          const run = await runAgentWithResilience(
            {
              userId,
              agentName: "content-writer",
              traceId,
              idempotencyKey: `${idempotencyKey}:${item.platform}:${item.content_type}`,
              requestId,
              releaseId,
              campaignId,
              input: {
                campaignId,
                releaseId,
                artistId,
                platform: item.platform,
                contentType: item.content_type,
              },
            },
            async () => {
              const stubBody = `[${item.label}] ${releaseTitle} by ${artistName} — generated placeholder. Replace with LLM output.`;
              return {
                value: { platform: item.platform, content_type: item.content_type, body: stubBody },
                output: {
                  platform: item.platform,
                  contentType: item.content_type,
                  bodyPreview: stubBody.slice(0, 140),
                },
                tokensUsed: 0,
                costCents: 0,
              };
            }
          );

          if (!run.ok) {
            throw new Error(run.error);
          }

          return run.value;
        }
      );

      generatedItems.push(generated);
    }

    const insertedIds = await step.run("persist-content-items", async () => {
      const supabase = supabaseAdmin;

      const rows = generatedItems.map((g) => ({
        campaign_id: campaignId,
        platform: g.platform,
        content_type: g.content_type,
        body: g.body,
        status: "draft" as const,
      }));

      const { data, error } = await supabase
        .from("content_items")
        .insert(rows)
        .select("id");

      if (error) throw new Error(`Failed to insert content items: ${error.message}`);

      return data.map((r: { id: string }) => r.id);
    });

    return { campaignId, contentItemIds: insertedIds };
  }
);
