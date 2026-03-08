import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";

// ─── Input / Output schemas ────────────────────────────────────────────────

export const VoiceProfilerInputSchema = z.object({
  artistName: z.string().min(1),
  genre: z.string().min(1),
  existingBio: z.string(),
  socialPosts: z.array(z.string()),
  interviewExcerpts: z.array(z.string()).optional().default([]),
  songTitles: z.array(z.string()).optional().default([]),
});
export type VoiceProfilerInput = z.infer<typeof VoiceProfilerInputSchema>;

export const VoiceProfileSchema = z.object({
  tonalQualities: z.array(z.string()),
  vocabularyPatterns: z.object({
    frequentWords: z.array(z.string()),
    avoidedWords: z.array(z.string()),
    slangUsage: z.enum(["heavy", "moderate", "minimal", "none"]),
    profanityLevel: z.enum(["none", "mild", "moderate", "heavy"]),
  }),
  sentenceStyle: z.object({
    avgLength: z.enum(["short", "medium", "long"]),
    structure: z.enum(["fragmented", "conversational", "polished", "poetic"]),
    usesQuestions: z.boolean(),
    usesExclamations: z.boolean(),
  }),
  emojiUsage: z.object({
    frequency: z.enum(["never", "rare", "moderate", "heavy"]),
    preferred: z.array(z.string()),
  }),
  platformVariations: z.object({
    instagram: z.object({ tone: z.string(), hashtagStyle: z.string() }),
    tiktok: z.object({ tone: z.string(), hookStyle: z.string() }),
    twitter: z.object({ tone: z.string(), threadStyle: z.string() }),
  }),
  topicAffinities: z.array(z.string()),
  topicAvoidances: z.array(z.string()),
  samplePhrases: z.array(z.string()),
  brandSafetyNotes: z.array(z.string()),
  confidenceScore: z.number().min(0).max(1),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

// ─── Result types ──────────────────────────────────────────────────────────

export type VoiceProfilerSuccess = {
  ok: true;
  profile: VoiceProfile;
  tokensUsed: number;
  costCents: number;
  durationMs: number;
  attempts: number;
};

export type VoiceProfilerError = {
  ok: false;
  error: string;
  attempts: number;
};

export type VoiceProfilerResult = VoiceProfilerSuccess | VoiceProfilerError;

// ─── Anthropic client (lazy) ───────────────────────────────────────────────

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

// ─── Cost estimation (claude-opus-4-5: $15/$75 per M tokens) ──────────────

function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * 1500;  // $15/M → cents
  const outputCost = (outputTokens / 1_000_000) * 7500; // $75/M → cents
  return Math.round(inputCost + outputCost);
}

// ─── Prompt assembly ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert music industry brand strategist and copywriter specialising in artist voice analysis.

Your task is to analyse the provided content and extract a precise, actionable voice profile for the artist.

RULES:
- Base every observation on evidence in the content. Do not invent traits.
- Be specific: prefer "uses lowercase intentionally" over "casual tone".
- confidenceScore should reflect how much raw content you had to work with:
  - 0.9–1.0: rich multi-source data (bio + posts + interviews + song titles)
  - 0.6–0.8: moderate data (bio + some posts or titles)
  - 0.3–0.5: sparse data (bio only or very few posts)
  - 0.0–0.2: insufficient data to make reliable inferences

Respond with ONLY valid JSON that matches this exact schema — no markdown fences, no commentary:

{
  "tonalQualities": ["string"],
  "vocabularyPatterns": {
    "frequentWords": ["string"],
    "avoidedWords": ["string"],
    "slangUsage": "heavy|moderate|minimal|none",
    "profanityLevel": "none|mild|moderate|heavy"
  },
  "sentenceStyle": {
    "avgLength": "short|medium|long",
    "structure": "fragmented|conversational|polished|poetic",
    "usesQuestions": boolean,
    "usesExclamations": boolean
  },
  "emojiUsage": {
    "frequency": "never|rare|moderate|heavy",
    "preferred": ["string"]
  },
  "platformVariations": {
    "instagram": { "tone": "string", "hashtagStyle": "string" },
    "tiktok": { "tone": "string", "hookStyle": "string" },
    "twitter": { "tone": "string", "threadStyle": "string" }
  },
  "topicAffinities": ["string"],
  "topicAvoidances": ["string"],
  "samplePhrases": ["string"],
  "brandSafetyNotes": ["string"],
  "confidenceScore": number
}`;

function buildUserMessage(input: VoiceProfilerInput): string {
  const sections: string[] = [
    `=== ARTIST ===\nName: ${input.artistName}\nGenre: ${input.genre}`,
    `=== BIOGRAPHY ===\n${input.existingBio || "(none provided)"}`,
  ];

  if (input.songTitles.length > 0) {
    sections.push(`=== SONG / RELEASE TITLES ===\n${input.songTitles.join("\n")}`);
  }

  if (input.socialPosts.length > 0) {
    sections.push(
      `=== SOCIAL POSTS (${input.socialPosts.length} samples) ===\n` +
        input.socialPosts
          .slice(0, 30) // cap at 30 to stay within context
          .map((p, i) => `[${i + 1}] ${p}`)
          .join("\n\n")
    );
  }

  if (input.interviewExcerpts.length > 0) {
    sections.push(
      `=== INTERVIEW EXCERPTS ===\n` +
        input.interviewExcerpts
          .slice(0, 10)
          .map((e, i) => `[${i + 1}] ${e}`)
          .join("\n\n")
    );
  }

  return sections.join("\n\n");
}

// ─── Retry with exponential backoff ───────────────────────────────────────

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<{ result: T; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      return { result, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        console.warn(
          `[voice-profiler] attempt ${attempt} failed — retrying in ${delay}ms:`,
          err instanceof Error ? err.message : err
        );
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

// ─── Core agent function ───────────────────────────────────────────────────

export async function buildVoiceProfile(
  input: VoiceProfilerInput,
  options: {
    userId?: string;
    artistId?: string;
    /** Skip writing to DB — useful for tests */
    dryRun?: boolean;
  } = {}
): Promise<VoiceProfilerResult> {
  const validated = VoiceProfilerInputSchema.parse(input);
  const client = getAnthropicClient();
  const startMs = Date.now();

  let tokensUsed = 0;
  let costCents = 0;
  let attempts = 0;

  let rawJson: string;
  let profile: VoiceProfile;

  // ── Call Anthropic with retry ────────────────────────────────────────────
  try {
    type LLMResult = { text: string; inputTokens: number; outputTokens: number };

    const { result, attempts: a } = await withRetry<LLMResult>(async () => {
      // stream: false ensures we always get a Message (not a Stream)
      const response = await client.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 2048,
        stream: false,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(validated) }],
      });

      const block = response.content[0];
      if (!block || block.type !== "text") {
        throw new Error("Unexpected response shape from Anthropic API");
      }

      return {
        text: block.text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    });

    attempts = a;
    tokensUsed = result.inputTokens + result.outputTokens;
    costCents = estimateCostCents(result.inputTokens, result.outputTokens);
    rawJson = result.text.trim();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!options.dryRun) {
      await logAgentRun({
        userId: options.userId,
        input: validated,
        output: {},
        tokensUsed: 0,
        costCents: 0,
        durationMs: Date.now() - startMs,
        status: "failed",
        error,
      });
    }
    return { ok: false, error, attempts: 3 };
  }

  // ── Parse & validate JSON ────────────────────────────────────────────────
  try {
    const parsed: unknown = JSON.parse(rawJson);
    profile = VoiceProfileSchema.parse(parsed);
  } catch (err) {
    const error = `Voice profile validation failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
    if (!options.dryRun) {
      await logAgentRun({
        userId: options.userId,
        input: validated,
        output: { rawJson },
        tokensUsed,
        costCents,
        durationMs: Date.now() - startMs,
        status: "failed",
        error,
      });
    }
    return { ok: false, error, attempts };
  }

  const durationMs = Date.now() - startMs;

  // ── Persist profile & log ────────────────────────────────────────────────
  if (!options.dryRun) {
    await Promise.all([
      options.artistId ? persistVoiceProfile(options.artistId, profile) : null,
      logAgentRun({
        userId: options.userId,
        input: validated,
        output: profile,
        tokensUsed,
        costCents,
        durationMs,
        status: "completed",
        error: null,
      }),
    ]);
  }

  return { ok: true, profile, tokensUsed, costCents, durationMs, attempts };
}

// ─── DB helpers ───────────────────────────────────────────────────────────

async function persistVoiceProfile(
  artistId: string,
  profile: VoiceProfile
): Promise<void> {
  const supabase = supabaseAdmin;
  const { error } = await supabase
    .from("artists")
    .update({ voice_profile: profile })
    .eq("id", artistId);
  if (error) console.error("[voice-profiler] failed to persist profile:", error);
}

async function logAgentRun(params: {
  userId?: string;
  input: unknown;
  output: unknown;
  tokensUsed: number;
  costCents: number;
  durationMs: number;
  status: "completed" | "failed";
  error: string | null;
}): Promise<void> {
  try {
    const supabase = supabaseAdmin;
    await supabase.from("agent_runs").insert({
      user_id: params.userId ?? null,
      agent_name: "voice-profiler",
      input: params.input,
      output: params.output,
      tokens_used: params.tokensUsed,
      cost_cents: params.costCents,
      duration_ms: params.durationMs,
      status: params.status,
      error: params.error,
    });
  } catch (err) {
    console.error("[voice-profiler] failed to log agent run:", err);
  }
}
