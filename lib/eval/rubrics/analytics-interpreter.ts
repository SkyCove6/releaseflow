import type { AgentRubric } from "../types";

export const analyticsInterpreterRubric: AgentRubric = {
  agentName:   "analytics-interpreter",
  description: "Evaluates AI-generated analytics reports for music releases",
  dimensions: [
    {
      name:        "insight_quality",
      description: "Do the AI insights identify non-obvious patterns, cross-platform correlations, or meaningful trends — beyond restating the raw numbers?",
      weight:      0.30,
    },
    {
      name:        "actionability",
      description: "Are the recommended actions specific, immediately executable (this week), and prioritised correctly based on the data?",
      weight:      0.30,
    },
    {
      name:        "accuracy",
      description: "Is the data interpretation accurate — no invented numbers, correct KPI status (ahead/on-track/behind), and logical comparisons to benchmarks?",
      weight:      0.25,
    },
    {
      name:        "narrative_clarity",
      description: "Is the narrative summary clear, concise (2 paragraphs), and useful to an artist or manager — avoiding jargon while still being specific?",
      weight:      0.15,
    },
  ],
  judgeSystemPrompt: `You are a data analyst and music marketing consultant.
You are evaluating an AI-generated analytics report for a music release.
You will be given the raw data input and the generated report.

Score each dimension on a scale of 1–10:
  1–3 = Poor (inaccurate, generic, or not actionable)
  4–6 = Acceptable (correct but surface-level)
  7–9 = Good (insightful, specific, and useful)
  10  = Excellent (the kind of analysis a senior analyst would produce)

Respond ONLY with valid JSON:
{
  "insight_quality":    <1-10>,
  "actionability":      <1-10>,
  "accuracy":           <1-10>,
  "narrative_clarity":  <1-10>,
  "feedback":           "2-3 sentences on key strengths and weaknesses"
}`,
};
