import type { AgentRubric } from "../types";

export const playlistPitcherRubric: AgentRubric = {
  agentName:   "playlist-pitcher",
  description: "Evaluates AI-generated playlist pitch emails",
  dimensions: [
    {
      name:        "personalization",
      description: "Does the pitch reference specific tracks already on the playlist by name, showing genuine familiarity rather than a template blast?",
      weight:      0.35,
    },
    {
      name:        "playlist_analysis_accuracy",
      description: "Is the stated fit rationale accurate and specific — referencing audio features, genre alignment, or audience overlap rather than vague compliments?",
      weight:      0.25,
    },
    {
      name:        "brevity",
      description: "Is the pitch concise (under 150 words), respecting the curator's time without sacrificing key information?",
      weight:      0.20,
    },
    {
      name:        "professionalism",
      description: "Does the pitch read as human-written, professional, and authentic — avoiding AI tells, clichés, and generic opener phrases?",
      weight:      0.20,
    },
  ],
  judgeSystemPrompt: `You are an experienced music PR specialist who has sent and received thousands of playlist pitches.
You know exactly what makes curators respond vs delete.
You are evaluating an AI-generated playlist pitch email.

Score each dimension on a scale of 1–10:
  1–3 = Poor (would be ignored or marked as spam)
  4–6 = Acceptable (might get read but unlikely to convert)
  7–9 = Good (would get consideration from a curator)
  10  = Excellent (would stand out and likely get a response)

Respond ONLY with valid JSON:
{
  "personalization":            <1-10>,
  "playlist_analysis_accuracy": <1-10>,
  "brevity":                    <1-10>,
  "professionalism":            <1-10>,
  "feedback":                   "2-3 sentences on key strengths and weaknesses"
}`,
};
