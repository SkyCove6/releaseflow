import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  getAudioFeatures,
  getBatchAudioFeatures,
  getPlaylist,
  searchPlaylists,
  scoreAudioFeatureMatch,
  averageAudioFeatures,
  type SpotifyAudioFeatures,
  type SpotifyTrackSimple,
} from "@/lib/spotify";

// =============================================================================
// Schemas
// =============================================================================

export const AudioFeaturesSchema = z.object({
  danceability:     z.number().min(0).max(1),
  energy:           z.number().min(0).max(1),
  valence:          z.number().min(0).max(1),
  tempo:            z.number().positive(),
  acousticness:     z.number().min(0).max(1).optional(),
  instrumentalness: z.number().min(0).max(1).optional(),
  speechiness:      z.number().min(0).max(1).optional(),
  loudness:         z.number().optional(),
  key:              z.number().int().optional(),
  mode:             z.number().int().min(0).max(1).optional(),
});

export const PlaylistPitcherInputSchema = z.object({
  release: z.object({
    title:          z.string().min(1),
    genre:          z.string().min(1),
    mood:           z.array(z.string()),
    spotifyTrackId: z.string().optional(),
    audioFeatures:  AudioFeaturesSchema.optional(),
  }),
  artist: z.object({
    name:            z.string().min(1),
    voiceProfile:    z.record(z.string(), z.unknown()).optional().default({}),
    spotifyArtistId: z.string().optional(),
  }),
  targetPlaylistCount: z.number().int().min(1).max(20).default(5),
  releaseId:           z.string().uuid(),
  userId:              z.string().uuid().optional(),
  oneSheetUrl:         z.string().url().optional(),
});

export type PlaylistPitcherInput = z.infer<typeof PlaylistPitcherInputSchema>;

// ─── Intermediate / output types ────────────────────────────────────────────

export interface PlaylistTarget {
  playlistId:       string;
  playlistName:     string;
  playlistUrl:      string;
  followerCount:    number;
  curatorName:      string;
  fitScore:         number;               // 0–100
  fitReason:        string;
  comparableTracks: Array<{ name: string; artist: string; spotifyUrl: string }>;
  avgAudioFeatures: Pick<SpotifyAudioFeatures, "energy" | "danceability" | "valence" | "tempo">;
}

export interface PitchResult {
  playlistId:    string;
  playlistName:  string;
  fitScore:      number;
  pitchSubject:  string;
  pitchBody:     string;
  curatorEmail:  string | null;
  submithubUrl:  string | null;
}

export interface FollowUp {
  pitchId:        string;
  followUpDate:   string;               // ISO date
  body:           string;
}

export interface PlaylistPitcherOutput {
  researched:         PlaylistTarget[];
  pitches:            PitchResult[];
  followUpSchedule:   FollowUp[];
}

export type PlaylistPitcherResult =
  | { ok: true;  output: PlaylistPitcherOutput; tokensUsed: number; costCents: number; durationMs: number }
  | { ok: false; error: string };

// =============================================================================
// Anthropic client (lazy)
// =============================================================================

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

// Sonnet: $3/$15 per M tokens (input/output)
function estimateCostCents(input: number, output: number): number {
  return Math.round((input / 1_000_000) * 300 + (output / 1_000_000) * 1500);
}

// =============================================================================
// Stage 1 — Research
// =============================================================================

/**
 * Build search queries from genre, mood, and comparable artist.
 * Multiple queries improve recall across playlist naming conventions.
 */
function buildSearchQueries(
  genre: string,
  mood: string[],
  artistName: string
): string[] {
  const queries: string[] = [
    genre,
    `${genre} ${mood[0] ?? ""}`.trim(),
    `${mood[0] ?? ""} ${mood[1] ?? ""}`.trim(),
    artistName,
  ];
  return [...new Set(queries.filter((q) => q.length > 2))];
}

interface ResearchContext {
  trackFeatures: SpotifyAudioFeatures | null;
  playlists: PlaylistTarget[];
}

async function runResearchStage(
  input: PlaylistPitcherInput,
  targetCount: number
): Promise<ResearchContext> {
  // ── 1a. Fetch audio features for the track ───────────────────────────────
  let trackFeatures: SpotifyAudioFeatures | null = null;
  if (input.release.spotifyTrackId) {
    try {
      trackFeatures = await getAudioFeatures(input.release.spotifyTrackId);
    } catch (e) {
      console.warn("[playlist-pitcher] Could not fetch audio features:", e);
    }
  }

  // Fall back to manually supplied features
  const effectiveFeatures = trackFeatures ?? (
    input.release.audioFeatures
      ? ({ ...input.release.audioFeatures, id: "manual" } as SpotifyAudioFeatures)
      : null
  );

  // ── 1b. Search for candidate playlists ───────────────────────────────────
  const queries = buildSearchQueries(
    input.release.genre,
    input.release.mood,
    input.artist.name
  );

  const playlistMap = new Map<string, (typeof candidatePlaylists)[number]>();
  const candidatePlaylists: Awaited<ReturnType<typeof searchPlaylists>> = [];

  for (const q of queries) {
    try {
      const results = await searchPlaylists(q, 15);
      for (const p of results) {
        if (!playlistMap.has(p.id)) {
          playlistMap.set(p.id, p);
          candidatePlaylists.push(p);
        }
      }
    } catch (e) {
      console.warn(`[playlist-pitcher] Search failed for "${q}":`, e);
    }
    if (candidatePlaylists.length >= targetCount * 4) break;
  }

  // ── 1c. Enrich top candidates with full playlist data + audio features ───
  const enriched: PlaylistTarget[] = [];

  const candidates = candidatePlaylists.slice(0, targetCount * 3);

  for (const candidate of candidates) {
    try {
      const full = await getPlaylist(candidate.id);

      // Extract recent tracks (last 50)
      const recentTracks = full.tracks.items
        .slice(-50)
        .map((i) => i.track)
        .filter((t): t is SpotifyTrackSimple => Boolean(t?.id));

      // Fetch audio features for a sample of tracks
      const sampleIds = recentTracks.slice(0, 30).map((t) => t.id);
      let playlistFeatures: SpotifyAudioFeatures[] = [];
      try {
        playlistFeatures = await getBatchAudioFeatures(sampleIds);
      } catch {
        // continue without audio feature scoring
      }

      const avgFeatures = averageAudioFeatures(playlistFeatures);

      // Compute fit score
      let fitScore = 50; // default when no audio data
      if (effectiveFeatures && playlistFeatures.length > 0) {
        fitScore = scoreAudioFeatureMatch(
          {
            energy:       effectiveFeatures.energy,
            danceability: effectiveFeatures.danceability,
            valence:      effectiveFeatures.valence,
            tempo:        effectiveFeatures.tempo,
          },
          avgFeatures
        );
      }

      // Find comparable tracks (high popularity, similar artists)
      const comparableTracks = recentTracks
        .filter((t) => t.popularity > 40)
        .slice(0, 5)
        .map((t) => ({
          name:       t.name,
          artist:     t.artists[0]?.name ?? "Unknown",
          spotifyUrl: t.external_urls.spotify,
        }));

      const fitReason = buildFitReason(
        fitScore,
        effectiveFeatures,
        avgFeatures,
        input.release.genre
      );

      enriched.push({
        playlistId:       full.id,
        playlistName:     full.name,
        playlistUrl:      full.external_urls.spotify,
        followerCount:    full.followers.total,
        curatorName:      full.owner.display_name,
        fitScore,
        fitReason,
        comparableTracks,
        avgAudioFeatures: avgFeatures,
      });
    } catch (e) {
      console.warn(`[playlist-pitcher] Skipping playlist ${candidate.id}:`, e);
    }

    if (enriched.length >= targetCount * 2) break;
  }

  // Sort by fit score descending, take top N
  const sorted = enriched.sort((a, b) => b.fitScore - a.fitScore);

  return { trackFeatures, playlists: sorted.slice(0, targetCount) };
}

function buildFitReason(
  score: number,
  track: SpotifyAudioFeatures | null,
  playlist: Pick<SpotifyAudioFeatures, "energy" | "danceability" | "valence" | "tempo">,
  genre: string
): string {
  if (!track) return `Genre match: ${genre}`;
  const parts: string[] = [];
  if (Math.abs(track.energy - playlist.energy) < 0.1)       parts.push("matching energy");
  if (Math.abs(track.danceability - playlist.danceability) < 0.1) parts.push("similar danceability");
  if (Math.abs(track.tempo - playlist.tempo) < 10)           parts.push(`BPM close to playlist avg (${Math.round(playlist.tempo)})`);
  if (Math.abs(track.valence - playlist.valence) < 0.15)     parts.push("matching mood/valence");
  return parts.length ? parts.join(", ") : `Score: ${score}/100`;
}

// =============================================================================
// Stage 2 — Pitch Generation
// =============================================================================

const PITCH_SYSTEM_PROMPT = `You are an expert music PR specialist who writes highly personalised playlist pitch emails.

RULES:
1. Every pitch must be under 150 words (curators are extremely busy).
2. Reference 2–3 tracks ALREADY on the playlist by name to prove you've listened.
3. Highlight audio feature alignment (BPM, energy, mood) concisely — one sentence.
4. Each pitch must have a UNIQUE angle — never use the same opening line or framing.
5. Write in the voice/tone indicated by the artist's voice profile.
6. Sound human, not AI-generated. Avoid words: "I hope this finds you", "excited to share", "reach out".
7. The pitch subject line should be specific, not generic.
8. Do not invent track names or artist data — use only what is provided.

Respond with a JSON array — one object per playlist — exactly matching:
[
  {
    "playlistId": "string",
    "pitchSubject": "string (under 60 chars)",
    "pitchBody": "string (under 150 words)",
    "curatorEmail": null,
    "submithubUrl": null
  }
]
No markdown, no commentary — raw JSON array only.`;

function buildPitchUserMessage(
  input: PlaylistPitcherInput,
  targets: PlaylistTarget[],
  trackFeatures: SpotifyAudioFeatures | null
): string {
  const featureSummary = trackFeatures
    ? `BPM: ${Math.round(trackFeatures.tempo)}, Energy: ${(trackFeatures.energy * 100).toFixed(0)}%, ` +
      `Danceability: ${(trackFeatures.danceability * 100).toFixed(0)}%, Valence: ${(trackFeatures.valence * 100).toFixed(0)}%`
    : input.release.audioFeatures
    ? `BPM: ${Math.round(input.release.audioFeatures.tempo)}, Energy: ${(input.release.audioFeatures.energy * 100).toFixed(0)}%, ` +
      `Danceability: ${(input.release.audioFeatures.danceability * 100).toFixed(0)}%`
    : "Audio features not available";

  const artistVoice = JSON.stringify(input.artist.voiceProfile ?? {}, null, 2);

  const spotifyLink = input.release.spotifyTrackId
    ? `https://open.spotify.com/track/${input.release.spotifyTrackId}`
    : "[Spotify link TBD]";

  const oneSheetLink = input.oneSheetUrl ?? "[One-sheet link TBD]";

  const playlistsBlock = targets
    .map(
      (p, i) => `
PLAYLIST ${i + 1}:
  ID: ${p.playlistId}
  Name: "${p.playlistName}"
  Curator: ${p.curatorName}
  Followers: ${p.followerCount.toLocaleString()}
  Fit Score: ${p.fitScore}/100
  Why it fits: ${p.fitReason}
  Comparable tracks on this playlist:
${p.comparableTracks.map((t) => `    - "${t.name}" by ${t.artist}`).join("\n")}
  Playlist avg: BPM ${Math.round(p.avgAudioFeatures.tempo)}, Energy ${(p.avgAudioFeatures.energy * 100).toFixed(0)}%, Danceability ${(p.avgAudioFeatures.danceability * 100).toFixed(0)}%`
    )
    .join("\n");

  return `=== TRACK ===
Title: "${input.release.title}"
Artist: ${input.artist.name}
Genre: ${input.release.genre}
Mood: ${input.release.mood.join(", ")}
Audio Features: ${featureSummary}
Spotify: ${spotifyLink}
One-Sheet: ${oneSheetLink}

=== ARTIST VOICE PROFILE ===
${artistVoice}

=== TARGET PLAYLISTS ===
${playlistsBlock}

Generate one personalised pitch per playlist. Return JSON array.`;
}

// =============================================================================
// Follow-up schedule generation
// =============================================================================

function buildFollowUpSchedule(
  pitches: Array<{ playlistId: string; playlistName: string; pitchBody: string }>,
  dbIds: string[]
): FollowUp[] {
  const followUpDays = 14; // follow up 2 weeks after initial send
  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + followUpDays);

  return pitches.map((pitch, i) => {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i); // stagger by 1 day each

    const followUpDate = date.toISOString().split("T")[0]!;

    return {
      pitchId:      dbIds[i] ?? "",
      followUpDate,
      body: `Hi,\n\nJust following up on my earlier pitch for "${pitch.playlistName}". ` +
            `The track has been performing well and I think it would be a great fit for your playlist.\n\n` +
            `Happy to provide any additional info — thanks for your time.\n`,
    };
  });
}

// =============================================================================
// Main agent function
// =============================================================================

export async function pitchPlaylists(
  rawInput: PlaylistPitcherInput,
  options: { skipRunLogging?: boolean } = {}
): Promise<PlaylistPitcherResult> {
  const input = PlaylistPitcherInputSchema.parse(rawInput);
  const startMs = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // ─────────────────────────────────────────────────────────────────────────
  // Stage 1: Research
  // ─────────────────────────────────────────────────────────────────────────
  let researchCtx: ResearchContext;
  try {
    researchCtx = await runResearchStage(input, input.targetPlaylistCount);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!options.skipRunLogging) await logAgentRun({ input, output: {}, tokens: 0, costCents: 0,
      durationMs: Date.now() - startMs, status: "failed", error, userId: input.userId });
    return { ok: false, error: `Research stage failed: ${error}` };
  }

  if (researchCtx.playlists.length === 0) {
    const error = "No suitable playlists found for this track";
    if (!options.skipRunLogging) await logAgentRun({ input, output: {}, tokens: 0, costCents: 0,
      durationMs: Date.now() - startMs, status: "failed", error, userId: input.userId });
    return { ok: false, error };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Stage 2: Pitch generation
  // ─────────────────────────────────────────────────────────────────────────
  const client = getAnthropicClient();
  let rawJson: string;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      stream: false,
      system: PITCH_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildPitchUserMessage(
            input,
            researchCtx.playlists,
            researchCtx.trackFeatures
          ),
        },
      ],
    });

    const block = response.content[0];
    if (!block || block.type !== "text") {
      throw new Error("Unexpected response shape from Anthropic API");
    }

    totalInputTokens  += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    rawJson = block.text.trim();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!options.skipRunLogging) await logAgentRun({ input, output: {}, tokens: totalInputTokens + totalOutputTokens,
      costCents: estimateCostCents(totalInputTokens, totalOutputTokens),
      durationMs: Date.now() - startMs, status: "failed", error, userId: input.userId });
    return { ok: false, error: `Pitch generation failed: ${error}` };
  }

  // ─── Parse pitch JSON ────────────────────────────────────────────────────
  const PitchArraySchema = z.array(
    z.object({
      playlistId:    z.string(),
      pitchSubject:  z.string(),
      pitchBody:     z.string(),
      curatorEmail:  z.string().email().nullable(),
      submithubUrl:  z.string().url().nullable().or(z.literal(null)),
    })
  );

  let parsedPitches: z.infer<typeof PitchArraySchema>;
  try {
    parsedPitches = PitchArraySchema.parse(JSON.parse(rawJson));
  } catch (err) {
    const error = `Failed to parse pitch JSON: ${err instanceof Error ? err.message : err}`;
    if (!options.skipRunLogging) await logAgentRun({ input, output: { rawJson }, tokens: totalInputTokens + totalOutputTokens,
      costCents: estimateCostCents(totalInputTokens, totalOutputTokens),
      durationMs: Date.now() - startMs, status: "failed", error, userId: input.userId });
    return { ok: false, error };
  }

  // ─── Merge research + pitches ─────────────────────────────────────────────
  const pitches: PitchResult[] = parsedPitches.map((p) => {
    const target = researchCtx.playlists.find((t) => t.playlistId === p.playlistId);
    return {
      playlistId:   p.playlistId,
      playlistName: target?.playlistName ?? p.playlistId,
      fitScore:     target?.fitScore ?? 0,
      pitchSubject: p.pitchSubject,
      pitchBody:    p.pitchBody,
      curatorEmail: p.curatorEmail,
      submithubUrl: p.submithubUrl,
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Persist to DB
  // ─────────────────────────────────────────────────────────────────────────
  const dbIds = await persistPitches(input, researchCtx.playlists, pitches);

  // ─── Build follow-up schedule ─────────────────────────────────────────────
  const followUpSchedule = buildFollowUpSchedule(
    pitches.map((p) => ({
      playlistId:   p.playlistId,
      playlistName: p.playlistName,
      pitchBody:    p.pitchBody,
    })),
    dbIds
  );

  // Persist follow-up dates back to DB rows
  await updateFollowUpDates(dbIds, followUpSchedule);

  const totalTokens = totalInputTokens + totalOutputTokens;
  const costCents   = estimateCostCents(totalInputTokens, totalOutputTokens);
  const durationMs  = Date.now() - startMs;

  const output: PlaylistPitcherOutput = {
    researched:       researchCtx.playlists,
    pitches,
    followUpSchedule,
  };

  if (!options.skipRunLogging) await logAgentRun({
    input,
    output,
    tokens: totalTokens,
    costCents,
    durationMs,
    status: "completed",
    error: null,
    userId: input.userId,
  });

  return { ok: true, output, tokensUsed: totalTokens, costCents, durationMs };
}

// =============================================================================
// DB helpers
// =============================================================================

async function persistPitches(
  input: PlaylistPitcherInput,
  targets: PlaylistTarget[],
  pitches: PitchResult[]
): Promise<string[]> {
  const supabase = supabaseAdmin;
  const ids: string[] = [];

  for (const pitch of pitches) {
    const target = targets.find((t) => t.playlistId === pitch.playlistId);

    const { data, error } = await supabase
      .from("playlist_pitches")
      .insert({
        release_id:           input.releaseId,
        playlist_name:        pitch.playlistName,
        playlist_url:         target?.playlistUrl ?? null,
        curator_email:        pitch.curatorEmail,
        pitch_body:           pitch.pitchBody,
        status:               "drafted",
        spotify_playlist_id:  pitch.playlistId,
        follower_count:       target?.followerCount ?? null,
        fit_score:            pitch.fitScore,
        pitch_subject:        pitch.pitchSubject,
        submithub_url:        pitch.submithubUrl,
        comparable_tracks:    target?.comparableTracks ?? [],
        audio_feature_notes:  target?.fitReason ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[playlist-pitcher] Failed to insert pitch:", error);
      ids.push("");
    } else {
      ids.push(data.id);
    }
  }

  return ids;
}

async function updateFollowUpDates(
  dbIds: string[],
  schedule: FollowUp[]
): Promise<void> {
  const supabase = supabaseAdmin;

  for (let i = 0; i < dbIds.length; i++) {
    const id = dbIds[i];
    const fu = schedule[i];
    if (!id || !fu) continue;

    await supabase
      .from("playlist_pitches")
      .update({
        follow_up_date: fu.followUpDate,
        follow_up_body: fu.body,
      })
      .eq("id", id);
  }
}

async function logAgentRun(params: {
  input: unknown;
  output: unknown;
  tokens: number;
  costCents: number;
  durationMs: number;
  status: "completed" | "failed";
  error: string | null;
  userId?: string;
}): Promise<void> {
  try {
    const supabase = supabaseAdmin;
    await supabase.from("agent_runs").insert({
      user_id:     params.userId ?? null,
      agent_name:  "playlist-pitcher",
      input:       params.input,
      output:      params.output,
      tokens_used: params.tokens,
      cost_cents:  params.costCents,
      duration_ms: params.durationMs,
      status:      params.status,
      error:       params.error,
    });
  } catch (err) {
    console.error("[playlist-pitcher] Failed to log agent run:", err);
  }
}
