import { inngest, buildIdempotencyKey, buildTraceId } from "@/inngest/client";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Triggered by `release/published`.
 * Fans out an analytics report request and tracks release post-publish activity.
 */
export const onReleasePublished = inngest.createFunction(
  { id: "on-release-published", name: "On Release Published", retries: 2 },
  { event: "release/published" },
  async ({ event, step, logger }) => {
    const { releaseId, title, artistName, releaseDate } = event.data;

    await step.run("log-release", async () => {
      logger.info("Release published", { releaseId, title, artistName, traceId: event.data.traceId });
    });

    const resolvedContext = await step.run("resolve-release-context", async () => {
      const supabase = supabaseAdmin;
      const { data, error } = await supabase
        .from("releases")
        .select("id, artist_id, artists!inner(id, user_id, genre)")
        .eq("id", releaseId)
        .single();

      if (error || !data) {
        throw new Error(`Release context missing for ${releaseId}: ${error?.message ?? "not found"}`);
      }

      const artistsRaw = data.artists as
        | { id: string; user_id: string; genre?: string }
        | Array<{ id: string; user_id: string; genre?: string }>
        | null;
      const artists = Array.isArray(artistsRaw) ? (artistsRaw[0] ?? null) : artistsRaw;
      if (!artists?.user_id) {
        throw new Error(`Could not resolve owner for release ${releaseId}`);
      }

      return {
        artistId: data.artist_id as string,
        userId: artists.user_id,
        genre: artists.genre ?? "",
      };
    });

    const start = releaseDate
      ? new Date(releaseDate)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = new Date();

    await step.run("emit-analytics-request", async () => {
      await inngest.send({
        name: "analytics/report.requested",
        data: {
          releaseId,
          artistId: resolvedContext.artistId,
          userId: resolvedContext.userId,
          actorId: resolvedContext.userId,
          tenantId: resolvedContext.userId,
          resourceId: releaseId,
          idempotencyKey: buildIdempotencyKey(
            "analytics",
            "requested",
            releaseId,
            resolvedContext.userId
          ),
          traceId: buildTraceId("release-published"),
          requestId: buildIdempotencyKey("request", "analytics-after-publish", releaseId),
          title,
          artistName,
          genre: resolvedContext.genre,
          dateRange: {
            start: start.toISOString().slice(0, 10),
            end: end.toISOString().slice(0, 10),
          },
        },
      });
    });

    return { releaseId, processed: true };
  }
);
