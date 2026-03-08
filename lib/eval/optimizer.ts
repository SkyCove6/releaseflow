/**
 * PromptOptimizer — analyses EvalReports and generates specific prompt
 * modifications. Can also run A/B tests comparing two system prompts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAgentRubric } from "./rubrics";
import type { EvalReport, OptimizationReport, OptimizationSuggestion, ABTestResult } from "./types";

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

// ─── Optimization suggestion generation ──────────────────────────────────────

export async function generateOptimizationReport(
  report: EvalReport
): Promise<OptimizationReport> {
  const rubric = getAgentRubric(report.stats.agentName);

  const systemPrompt = `You are an expert in prompt engineering for AI agents.
You analyze quality evaluation reports and suggest specific, actionable prompt improvements.

Your suggestions must:
1. Target specific dimensions with the lowest scores.
2. Provide a concrete "prompt patch" — exact text to add, replace, or restructure in the system prompt.
3. Be ordered from highest to lowest estimated impact.
4. Be grounded in the actual score data, not generic advice.

Respond with ONLY a JSON array of optimization suggestions:
[
  {
    "targetDimension":  "string (dimension name)",
    "currentScore":     <number>,
    "suggestion":       "string (what to change)",
    "rationale":        "string (why this will help)",
    "promptPatch":      "string (exact text to add/replace in the prompt)",
    "estimatedImpact":  "high|medium|low"
  }
]`;

  const userMessage = `=== EVAL REPORT FOR: ${report.stats.agentName} ===
Period: ${report.stats.period.start} → ${report.stats.period.end}
Runs evaluated: ${report.sampleSize}
Average quality score: ${report.avgQualityScore}/10
Worst dimension: ${report.worstDimension ?? "N/A"}
Best dimension: ${report.bestDimension ?? "N/A"}

Dimension scores across all evaluated runs:
${report.qualityScores
  .flatMap((q) => Object.entries(q.dimensionScores).map(([dim, score]) => `  ${dim}: ${score}/10`))
  .slice(0, 20)
  .join("\n")}

Sample feedback from judge:
${report.qualityScores
  .slice(0, 3)
  .map((q) => `  - "${q.feedback}"`)
  .join("\n")}

${rubric ? `Rubric dimensions:\n${rubric.dimensions.map((d) => `  - ${d.name} (weight: ${d.weight}): ${d.description}`).join("\n")}` : ""}

Generate 3–5 specific optimization suggestions targeting the lowest-scoring dimensions.`;

  const response = await getAnthropicClient().messages.create({
    model:      "claude-sonnet-4-5",
    max_tokens: 2048,
    stream:     false,
    system:     systemPrompt,
    messages:   [{ role: "user", content: userMessage }],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("No text in optimizer response");
  }

  const raw = block.text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
  const suggestions = JSON.parse(raw) as OptimizationSuggestion[];

  return {
    agentName:      report.stats.agentName,
    basedOnReport:  report,
    suggestions,
    generatedAt:    new Date().toISOString(),
  };
}

// ─── A/B test runner ──────────────────────────────────────────────────────────

export interface ABTestOptions {
  agentName:    string;
  oldPrompt:    string;
  newPrompt:    string;
  /** The user message / input to run through both prompts. */
  userMessage:  string;
  /** Max tokens for each generation. Default: 1024. */
  maxTokens?:   number;
}

export async function runABTest(opts: ABTestOptions): Promise<ABTestResult> {
  const { agentName, oldPrompt, newPrompt, userMessage, maxTokens = 1024 } = opts;
  const client = getAnthropicClient();
  const rubric = getAgentRubric(agentName);

  // Run both generations in parallel
  const [oldRes, newRes] = await Promise.all([
    client.messages.create({
      model:      "claude-sonnet-4-5",
      max_tokens: maxTokens,
      stream:     false,
      system:     oldPrompt,
      messages:   [{ role: "user", content: userMessage }],
    }),
    client.messages.create({
      model:      "claude-sonnet-4-5",
      max_tokens: maxTokens,
      stream:     false,
      system:     newPrompt,
      messages:   [{ role: "user", content: userMessage }],
    }),
  ]);

  const oldOutput = oldRes.content[0]?.type === "text" ? oldRes.content[0].text : "";
  const newOutput = newRes.content[0]?.type === "text" ? newRes.content[0].text : "";

  const costCents = Math.round(
    ((oldRes.usage.input_tokens + newRes.usage.input_tokens) / 1_000_000) * 300 +
    ((oldRes.usage.output_tokens + newRes.usage.output_tokens) / 1_000_000) * 1500
  );

  // Judge both outputs
  const judgePrompt = rubric?.judgeSystemPrompt ?? `You are an expert evaluator. Score the following outputs on a 1-10 scale for quality and usefulness. Return JSON: { "score": <number>, "feedback": "string" }`;

  const judgeUser = (output: string, label: string) =>
    `=== ${label} ===\nInput:\n${userMessage}\n\nOutput:\n${output}\n\nScore this output.`;

  const [oldScore, newScore] = await Promise.all([
    client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      stream: false,
      system: judgePrompt,
      messages: [{ role: "user", content: judgeUser(oldOutput, "OUTPUT") }],
    }),
    client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      stream: false,
      system: judgePrompt,
      messages: [{ role: "user", content: judgeUser(newOutput, "OUTPUT") }],
    }),
  ]);

  function extractScore(res: Anthropic.Message): { score: number; feedback: string } {
    const text = res.content[0]?.type === "text" ? res.content[0].text : "{}";
    try {
      const raw = text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
      const parsed = JSON.parse(raw) as { score?: number; total_score?: number; feedback?: string };
      const score = parsed.score ?? parsed.total_score ?? 5;
      // Handle rubric-style responses (multiple dimensions)
      const dimensionScores = Object.values(parsed)
        .filter((v): v is number => typeof v === "number");
      const avgScore = dimensionScores.length > 0
        ? dimensionScores.reduce((a, b) => a + b, 0) / dimensionScores.length
        : score;
      return { score: avgScore, feedback: parsed.feedback ?? "" };
    } catch {
      return { score: 5, feedback: text.slice(0, 200) };
    }
  }

  const { score: oldScoreVal, feedback: oldFeedback } = extractScore(oldScore);
  const { score: newScoreVal, feedback: newFeedback } = extractScore(newScore);

  const TIED_THRESHOLD = 0.5;
  const winner =
    Math.abs(newScoreVal - oldScoreVal) < TIED_THRESHOLD
      ? "tie"
      : newScoreVal > oldScoreVal
      ? "new"
      : "old";

  return {
    agentName,
    input:          userMessage,
    oldPromptScore: Math.round(oldScoreVal * 10) / 10,
    newPromptScore: Math.round(newScoreVal * 10) / 10,
    oldOutput,
    newOutput,
    winner,
    feedback: `Old: ${oldFeedback} | New: ${newFeedback}`,
    costCents,
  };
}
