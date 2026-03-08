import { inngest } from "@/inngest/client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildIdempotencyKey, buildTraceId } from "@/inngest/client";

/**
 * Runs every Monday at 09:00 UTC.
 * Queries all releases that have at least one analytics snapshot in the past 7 days,
 * then fires `analytics/report.requested` for each one so `generate-analytics-report`
 * handles the actual work (fan-out pattern).
 */
export const weeklyAnalyticsTrigger = inngest.createFunction(
  {
    id: "weekly-analytics-trigger",
    name: "Weekly Analytics Report Trigger",
    retries: 1,
  },
  { cron: "0 9 * * 1" },   // every Monday at 09:00 UTC
  async ({ step, logger }) => {
    // ── Step 1: find all releases with recent snapshots ────────────────────
    const releases = await step.run("find-active-releases", async () => {
      const supabase = supabaseAdmin;

      // Look for snapshots in the past 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const startDate = sevenDaysAgo.toISOString().split("T")[0]!;
      const endDate   = new Date().toISOString().split("T")[0]!;

      const { data, error } = await supabase
        .from("analytics_snapshots")
        .select(`
          release_id,
          releases (
            id, title,
            artists ( id, name, genre )
          )
        `)
        .gte("snapshot_date", startDate)
        .limit(200);

      if (error) throw new Error(`Failed to fetch releases: ${error.message}`);

      // Deduplicate by release_id and enrich with user_id
      const seen = new Set<string>();
      const unique: Array<{
        releaseId:    string;
        title: string;
        artistId:     string;
        artistName:   string;
        genre:        string;
        startDate:    string;
        endDate:      string;
      }> = [];

      for (const row of data ?? []) {
        if (seen.has(row.release_id)) continue;
        seen.add(row.release_id);

        type ReleaseRow = {
          id: string;
          title: string;
          artists: { id: string; name: string; genre: string } | null;
        } | null;
        const release = (row.releases as unknown) as ReleaseRow;

        // Supabase returns nested one-to-many as arrays — handle both shapes
        const artist = Array.isArray(release?.artists)
          ? (release.artists as Array<{ id: string; name: string; genre: string }>)[0] ?? null
          : release?.artists ?? null;

        if (!release || !artist) continue;

        unique.push({
          releaseId:    release.id,
          title: release.title,
          artistId:     artist.id,
          artistName:   artist.name,
          genre:        artist.genre,
          startDate,
          endDate,
        });
      }

      return unique;
    });

    if (!releases.length) {
      logger.info("No releases with recent analytics snapshots — skipping");
      return { firedCount: 0 };
    }

    // ── Step 2: resolve user_ids for each artist ───────────────────────────
    const enriched = await step.run("resolve-user-ids", async () => {
      const supabase = supabaseAdmin;
      const artistIds = [...new Set(releases.map((r) => r.artistId))];

      const { data: artists } = await supabase
        .from("artists")
        .select("id, user_id")
        .in("id", artistIds);

      const userMap = new Map<string, string>(
        (artists ?? []).map((a) => [a.id, a.user_id as string])
      );

      return releases.map((r) => ({
        ...r,
        userId: userMap.get(r.artistId) ?? "",
      }));
    });

    // ── Step 3: fire one analytics/report.requested event per release ──────
    const firedCount = await step.run("fire-report-events", async () => {
      let count = 0;
      for (const r of enriched) {
        if (!r.userId) continue;

        // Resolve the user's email for the report
        const supabase = supabaseAdmin;
        const { data: user } = await supabase
          .from("users")
          .select("email")
          .eq("id", r.userId)
          .maybeSingle();

        await inngest.send({
          name: "analytics/report.requested",
          data: {
            releaseId:    r.releaseId,
            artistId:     r.artistId,
            userId:       r.userId,
            actorId:      r.userId,
            tenantId:     r.userId,
            resourceId:   r.releaseId,
            idempotencyKey: buildIdempotencyKey("analytics", "weekly", r.releaseId, r.userId),
            traceId:      buildTraceId("analytics-weekly"),
            requestId:    buildIdempotencyKey("request", "analytics-weekly", r.releaseId, r.userId),
            title:        r.title,
            artistName:   r.artistName,
            genre:        r.genre,
            dateRange:    { start: r.startDate, end: r.endDate },
            reportEmail:  user?.email ?? undefined,
          },
        });

        count++;
      }
      return count;
    });

    logger.info(`Weekly analytics trigger fired ${firedCount} report events`);
    return { firedCount };
  }
);
