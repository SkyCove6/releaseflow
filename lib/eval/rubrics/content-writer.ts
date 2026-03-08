import type { AgentRubric } from "../types";

export const contentWriterRubric: AgentRubric = {
  agentName:   "content-writer",
  description: "Evaluates AI-generated social/email content for music releases",
  dimensions: [
    {
      name:        "voice_match",
      description: "Does the copy accurately reflect the artist's established voice profile — tone, vocabulary, sentence rhythm, and brand personality?",
      weight:      0.30,
    },
    {
      name:        "platform_appropriateness",
      description: "Is the format, length, hashtag use, and call-to-action appropriate for the specific platform (Instagram, TikTok, Twitter, email, press)?",
      weight:      0.25,
    },
    {
      name:        "engagement_potential",
      description: "Is the copy compelling, hook-driven, and likely to generate interaction? Does it create curiosity or an emotional response without being click-bait?",
      weight:      0.25,
    },
    {
      name:        "originality",
      description: "Is the copy fresh and specific to this artist/release, avoiding generic music marketing clichés ('excited to share', 'new era loading')?",
      weight:      0.20,
    },
  ],
  judgeSystemPrompt: `You are an expert social media strategist and music marketing copywriter.
You are evaluating AI-generated marketing copy for a music release.
You will be given: the platform, the content type, the artist's voice profile, and the generated copy.

Score each dimension on a scale of 1–10:
  1–3 = Poor
  4–6 = Acceptable
  7–9 = Good
  10  = Excellent (publishable as-is, no edits needed)

Respond ONLY with valid JSON:
{
  "voice_match":              <1-10>,
  "platform_appropriateness": <1-10>,
  "engagement_potential":     <1-10>,
  "originality":              <1-10>,
  "feedback":                 "2-3 sentences on key strengths and weaknesses"
}`,
};
