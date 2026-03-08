import { inngest } from "@/inngest/client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { pitchPlaylists } from "@/agents/playlist-pitcher";
import { runAgentWithResilience } from "@/lib/agents/resilient-runner";

/**
 * Triggered by `pitch/requested`.
 * Runs the Playlist Pitch Agent (Stage 1: Spotify research, Stage 2: Claude Sonnet pitch generation).
 *
 * Steps:
 *   1. fetch-release-context — load release + artist data from DB
 *   2. run-playlist-pitcher — full two-stage agent (research + pitch generation)
 */
export const generatePitches = inngest.createFunction(
  {
    id: "generate-pitches",
    name: "Generate Playlist Pitches",
    retries: 2,
    throttle: { limit: 5, period: "1m" },
  },
  { event: "pitch/requested" },
  async ({ event, step, logger }) => {
    const {
      releaseId,
      artistId,
      campaignId,
      userId,
      releaseTitle,
      genre,
      mood,
      artistName,
      spotifyTrackId,
      spotifyArtistId,
      targetPlaylistCount,
      traceId,
      requestId,
      idempotencyKey,
    } = event.data;

    // ── Step 1: fetch artist voice profile from DB ─────────────────────────
    const artistContext = await step.run("fetch-release-context", async () => {
      const supabase = supabaseAdmin;
      const { data, error } = await supabase
        .from("artists")
        .select("id, name, genre, voice_profile")
        .eq("id", artistId)
        .single();

      if (error) throw new Error(`Artist not found: ${error.message}`);
      return data;
    });

    const existing = await step.run("check-existing-pitches", async () => {
      const supabase = supabaseAdmin;
      const { count, error } = await supabase
        .from("playlist_pitches")
        .select("id", { count: "exact", head: true })
        .eq("release_id", releaseId);
      if (error) throw new Error(`Failed to inspect existing pitches: ${error.message}`);
      return count ?? 0;
    });

    if (existing > 0) {
      logger.info("Pitches already exist, skipping generation", { releaseId });
      return { releaseId, artistId, skipped: true };
    }

    // ── Step 2: run the full pitch agent ───────────────────────────────────
    const result = await step.run("run-playlist-pitcher", async () => {
      logger.info("Running playlist pitch agent", { releaseId, artistId, targetPlaylistCount });
      const resolvedTargetPlaylistCount = targetPlaylistCount ?? 5;

      const run = await runAgentWithResilience(
        {
          userId,
          agentName: "playlist-pitcher",
          traceId,
          idempotencyKey,
          requestId,
          releaseId,
          campaignId,
          input: {
            releaseId,
            artistId,
            campaignId: campaignId ?? "",
            targetPlaylistCount: resolvedTargetPlaylistCount,
          },
        },
        async () => {
          const pitcherResult = await pitchPlaylists(
            {
              release: {
                title: releaseTitle,
                genre,
                mood,
                spotifyTrackId,
              },
              artist: {
                name: artistName,
                voiceProfile: (artistContext.voice_profile as Record<string, unknown>) ?? {},
                spotifyArtistId,
              },
              targetPlaylistCount: resolvedTargetPlaylistCount,
              releaseId,
              userId,
            },
            { skipRunLogging: true }
          );

          if (!pitcherResult.ok) {
            throw new Error(`Playlist pitcher failed: ${pitcherResult.error}`);
          }

          return {
            value: {
              pitchCount: pitcherResult.output.pitches.length,
              tokensUsed: pitcherResult.tokensUsed,
              costCents: pitcherResult.costCents,
              durationMs: pitcherResult.durationMs,
              pitches: pitcherResult.output.pitches,
            },
            output: {
              pitchCount: pitcherResult.output.pitches.length,
            },
            tokensUsed: pitcherResult.tokensUsed,
            costCents: pitcherResult.costCents,
          };
        }
      );

      if (!run.ok) {
        throw new Error(run.error);
      }

      return run.value;
    });

    await step.run("persist-playlist-pitches", async () => {
      const supabase = supabaseAdmin;
      const rows = (result.pitches ?? []).map((pitch) => ({
        release_id: releaseId,
        playlist_name: pitch.playlistId,
        playlist_url: null,
        curator_email: pitch.curatorEmail,
        pitch_body: pitch.pitchBody,
        status: "drafted",
        spotify_playlist_id: pitch.playlistId,
        follower_count: null,
        fit_score: null,
        pitch_subject: pitch.pitchSubject,
      }));

      if (rows.length === 0) return { inserted: 0 };

      const { error } = await supabase
        .from("playlist_pitches")
        .insert(rows);
      if (error) throw new Error(`Failed to persist playlist pitches: ${error.message}`);

      return { inserted: rows.length };
    });

    logger.info("Playlist pitches generated", { releaseId, ...result });

    return { releaseId, artistId, ...result, persisted: true };
  }
);
