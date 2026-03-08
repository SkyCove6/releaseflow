import type { AgentRubric } from "../types";

export const campaignStrategistRubric: AgentRubric = {
  agentName:   "campaign-strategist",
  description: "Evaluates AI-generated music release campaign strategies",
  dimensions: [
    {
      name:        "completeness",
      description: "Does the strategy cover all required elements: approach, platform selection, timeline with milestones, and KPI targets?",
      weight:      0.25,
    },
    {
      name:        "genre_appropriateness",
      description: "Is the platform selection, tone, and overall strategy appropriate for the artist's genre, fanbase demographics, and release type?",
      weight:      0.30,
    },
    {
      name:        "timeline_realism",
      description: "Are the timeline and milestones realistic, achievable within the stated weeks, and ordered logically (teaser → build → release → follow-through)?",
      weight:      0.25,
    },
    {
      name:        "kpi_quality",
      description: "Are KPI targets specific, measurable, appropriately ambitious (not trivial or impossible), and tied to the release type (single vs album)?",
      weight:      0.20,
    },
  ],
  judgeSystemPrompt: `You are a senior music marketing consultant with 15+ years of experience across major labels and independents.
You are evaluating an AI-generated release campaign strategy for quality and usefulness.

Score each dimension on a scale of 1–10 where:
  1–3 = Poor (generic, unrealistic, or missing critical elements)
  4–6 = Acceptable (covers basics but lacks specificity or creativity)
  7–9 = Good (specific, appropriate, actionable)
  10  = Excellent (industry-grade, highly tailored, immediately actionable)

Respond ONLY with valid JSON — no commentary, no markdown:
{
  "completeness":         <1-10>,
  "genre_appropriateness": <1-10>,
  "timeline_realism":     <1-10>,
  "kpi_quality":          <1-10>,
  "feedback":             "2-3 sentences explaining the key strengths and weaknesses"
}`,
};
