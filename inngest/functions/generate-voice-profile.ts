import { inngest } from "@/inngest/client";
import { buildVoiceProfile } from "@/agents/voice-profiler";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildIdempotencyKey, buildTraceId } from "@/inngest/client";
import { runAgentWithResilience } from "@/lib/agents/resilient-runner";

/**
 * Triggered by `artist/created`.
 * Runs the Voice Profile Builder Agent and persists the result.
 *
 * Steps (each independently retried by Inngest on failure):
 *   1. fetch-artist-data  — pull latest DB state for the artist
 *   2. run-voice-profiler — call Anthropic, parse, validate
 *   3. persist-profile    — write back to artists.voice_profile
 */
export const generateVoiceProfile = inngest.createFunction(
  {
    id: "generate-voice-profile",
    name: "Generate Artist Voice Profile",
    retries: 3,
    throttle: {
      // Max 5 Anthropic calls per minute across all runs
      limit: 5,
      period: "1m",
    },
  },
  { event: "artist/created" },
  async ({ event, step, logger }) => {
    const { artistId, userId } = event.data;

    // ── Step 1: fetch current artist data from DB ──────────────────────────
    await step.run("fetch-artist-data", async () => {
      const supabase = supabaseAdmin;
      const { data, error } = await supabase
        .from("artists")
        .select("id, name, genre, bio, voice_profile")
        .eq("id", artistId)
        .single();

      if (error) throw new Error(`Artist not found: ${error.message}`);
      return data;
    });

    // Rate-limit: small pause before hitting the LLM
    await step.sleep("rate-limit-pause", "2s");

    // ── Step 2: run the voice profiler agent ───────────────────────────────
    const profilerResult = await step.run("run-voice-profiler", async () => {
      logger.info("Starting voice profiler", { artistId, userId });

      const execution = await runAgentWithResilience(
        {
          userId,
          agentName: "voice-profiler",
          traceId: event.data.traceId,
          idempotencyKey: event.data.idempotencyKey,
          requestId: event.data.requestId,
          input: {
            artistId,
            artistName: event.data.artistName,
            genre: event.data.genre,
          },
        },
        async () => {
          const result = await buildVoiceProfile(
            {
              artistName: event.data.artistName,
              genre: event.data.genre,
              existingBio: event.data.existingBio,
              socialPosts: event.data.socialPosts,
              interviewExcerpts: event.data.interviewExcerpts ?? [],
              songTitles: event.data.songTitles ?? [],
            },
            {
              userId,
              artistId,
              dryRun: true,
            }
          );

          if (!result.ok) {
            throw new Error(`Voice profiler failed: ${result.error}`);
          }

          return {
            value: result,
            output: {
              confidenceScore: result.profile.confidenceScore,
              pillars: result.profile.tonalQualities.length,
            },
            tokensUsed: result.tokensUsed,
            costCents: result.costCents,
          };
        }
      );

      if (!execution.ok) {
        throw new Error(execution.error);
      }

      logger.info("Voice profiler completed", {
        artistId,
        tokensUsed: execution.tokensUsed,
        costCents: execution.costCents,
        confidenceScore: execution.value.profile.confidenceScore,
      });

      return execution.value;
    });

    // ── Step 3: persist profile to DB and log the agent run ────────────────
    await step.run("persist-profile", async () => {
      const supabase = supabaseAdmin;

      const profileUpdate = await supabase
        .from("artists")
        .update({ voice_profile: profilerResult.profile })
        .eq("id", artistId);

      if (profileUpdate.error) {
        throw new Error(`Failed to persist profile: ${profileUpdate.error.message}`);
      }
    });

    // ── Step 4: emit downstream event ─────────────────────────────────────
    await step.run("emit-updated-event", async () => {
      await inngest.send({
        name: "artist/voice-profile.updated",
        data: {
          userId,
          actorId: userId,
          tenantId: userId,
          resourceId: artistId,
          idempotencyKey: buildIdempotencyKey("artist", "voice-profile", artistId),
          traceId: buildTraceId("voice-profile"),
          requestId: buildIdempotencyKey("request", "artist-voice-profile", artistId),
          artistId,
          confidenceScore: profilerResult.profile.confidenceScore,
        },
      });
    });

    return {
      artistId,
      confidenceScore: profilerResult.profile.confidenceScore,
      tokensUsed: profilerResult.tokensUsed,
      costCents: profilerResult.costCents,
    };
  }
);
