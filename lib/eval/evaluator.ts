/**
 * EvalEngine — pulls agent_runs from the DB, scores a sample with Claude-as-judge,
 * and returns a structured EvalReport.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getAgentRubric } from "./rubrics";
import type {
  EvalReport,
  EvalRunStats,
  EvalQualityScore,
} from "./types";

// ─── Anthropic lazy init ──────────────────────────────────────────────────────

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

// ─── DB row shape ─────────────────────────────────────────────────────────────

interface AgentRunRow {
  id:          string;
  agent_name:  string;
  input:       Record<string, unknown>;
  output:      Record<string, unknown>;
  tokens_used: number | null;
  cost_cents:  number | null;
  duration_ms: number | null;
  status:      string;
  error:       string | null;
  created_at:  string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function computeStats(
  agentName: string,
  start: string,
  end: string,
  rows: AgentRunRow[]
): EvalRunStats {
  const success = rows.filter((r) => r.status === "completed");
  const durations = success.map((r) => r.duration_ms ?? 0).sort((a, b) => a - b);

  return {
    agentName,
    period:         { start, end },
    totalRuns:      rows.length,
    successRuns:    success.length,
    failedRuns:     rows.filter((r) => r.status === "failed").length,
    successRate:    rows.length > 0 ? success.length / rows.length : 0,
    avgTokens:      success.length ? success.reduce((s, r) => s + (r.tokens_used ?? 0), 0) / success.length : 0,
    avgCostCents:   success.length ? success.reduce((s, r) => s + (r.cost_cents ?? 0), 0) / success.length : 0,
    totalCostCents: rows.reduce((s, r) => s + (r.cost_cents ?? 0), 0),
    avgDurationMs:  success.length ? success.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / success.length : 0,
    p95DurationMs:  percentile(durations, 95),
  };
}

// ─── Claude-as-judge ─────────────────────────────────────────────────────────

async function judgeRun(
  run: AgentRunRow,
  rubric: ReturnType<typeof getAgentRubric>
): Promise<EvalQualityScore | null> {
  if (!rubric) return null;

  const userMessage = `=== AGENT INPUT ===
${JSON.stringify(run.input, null, 2)}

=== AGENT OUTPUT ===
${JSON.stringify(run.output, null, 2)}

Score the output above on each dimension of the rubric. Return JSON only.`;

  try {
    const response = await getAnthropicClient().messages.create({
      model:      "claude-sonnet-4-5",
      max_tokens: 512,
      stream:     false,
      system:     rubric.judgeSystemPrompt,
      messages:   [{ role: "user", content: userMessage }],
    });

    const block = response.content[0];
    if (!block || block.type !== "text") return null;

    const raw = block.text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(raw) as Record<string, number | string>;

    const feedback = typeof parsed["feedback"] === "string" ? parsed["feedback"] : "";
    delete parsed["feedback"];

    const dimensionScores: Record<string, number> = {};
    let totalScore = 0;

    for (const dim of rubric.dimensions) {
      const raw = parsed[dim.name];
      const score = typeof raw === "number" ? Math.min(10, Math.max(1, raw)) : 5;
      dimensionScores[dim.name] = score;
      totalScore += score * dim.weight;
    }

    return {
      runId:           run.id,
      agentName:       run.agent_name,
      dimensionScores,
      totalScore:      Math.round(totalScore * 10) / 10,
      feedback,
      createdAt:       new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`[evaluator] Judge failed for run ${run.id}:`, err);
    return null;
  }
}

// ─── Persist eval results ────────────────────────────────────────────────────

async function persistEvalResults(scores: EvalQualityScore[]): Promise<void> {
  if (!scores.length) return;
  try {
    const supabase = await createClient();
    await supabase.from("eval_results").insert(
      scores.map((s) => ({
        agent_run_id:     s.runId,
        agent_name:       s.agentName,
        dimension_scores: s.dimensionScores,
        total_score:      s.totalScore,
        feedback:         s.feedback,
      }))
    );
  } catch (err) {
    console.warn("[evaluator] Failed to persist eval results:", err);
  }
}

// ─── Main evaluation function ────────────────────────────────────────────────

export interface EvalOptions {
  start:      string;    // ISO date
  end:        string;    // ISO date
  sampleSize: number;    // max runs to quality-score (LLM calls)
  persist?:   boolean;   // save scores to eval_results table (default: true)
}

export async function runEval(
  agentName: string,
  options: EvalOptions
): Promise<EvalReport> {
  const { start, end, sampleSize, persist = true } = options;
  const supabase = await createClient();

  // ── 1. Pull all runs in date range ────────────────────────────────────────
  const { data: rows, error } = await supabase
    .from("agent_runs")
    .select("id, agent_name, input, output, tokens_used, cost_cents, duration_ms, status, error, created_at")
    .eq("agent_name", agentName)
    .gte("created_at", start)
    .lte("created_at", end + "T23:59:59Z")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch agent runs: ${error.message}`);
  const runs = (rows ?? []) as AgentRunRow[];

  const stats = computeStats(agentName, start, end, runs);

  // ── 2. Sample successful runs for quality scoring ─────────────────────────
  const rubric = getAgentRubric(agentName);
  const qualityScores: EvalQualityScore[] = [];

  if (rubric) {
    const successRuns = runs
      .filter((r) => r.status === "completed")
      .slice(0, sampleSize);

    for (const run of successRuns) {
      const score = await judgeRun(run, rubric);
      if (score) qualityScores.push(score);
    }

    if (persist) await persistEvalResults(qualityScores);
  }

  // ── 3. Aggregate quality scores ───────────────────────────────────────────
  const avgQualityScore = qualityScores.length
    ? qualityScores.reduce((s, q) => s + q.totalScore, 0) / qualityScores.length
    : 0;

  // Find worst and best dimensions across all scored runs
  const dimTotals: Record<string, { sum: number; count: number }> = {};
  for (const qs of qualityScores) {
    for (const [dim, score] of Object.entries(qs.dimensionScores)) {
      if (!dimTotals[dim]) dimTotals[dim] = { sum: 0, count: 0 };
      dimTotals[dim]!.sum += score;
      dimTotals[dim]!.count += 1;
    }
  }

  const dimAvgs = Object.entries(dimTotals).map(([dim, { sum, count }]) => ({
    dim,
    avg: sum / count,
  }));

  const worstDimension = dimAvgs.length
    ? dimAvgs.reduce((a, b) => (a.avg < b.avg ? a : b)).dim
    : null;
  const bestDimension = dimAvgs.length
    ? dimAvgs.reduce((a, b) => (a.avg > b.avg ? a : b)).dim
    : null;

  // ── 4. Generate human-readable recommendations ────────────────────────────
  const recommendations = buildRecommendations(stats, avgQualityScore, worstDimension, agentName);

  return {
    stats,
    qualityScores,
    avgQualityScore: Math.round(avgQualityScore * 10) / 10,
    worstDimension,
    bestDimension,
    recommendations,
    sampleSize: qualityScores.length,
    evaluatedAt: new Date().toISOString(),
  };
}

function buildRecommendations(
  stats: EvalRunStats,
  avgQuality: number,
  worstDim: string | null,
  agentName: string
): string[] {
  const recs: string[] = [];

  if (stats.successRate < 0.95) {
    recs.push(
      `Success rate is ${(stats.successRate * 100).toFixed(1)}% — investigate recent failures in agent_runs for ${agentName}.`
    );
  }

  if (stats.avgDurationMs > 30_000) {
    recs.push(
      `Average run time is ${(stats.avgDurationMs / 1000).toFixed(1)}s — consider reducing max_tokens or simplifying the prompt.`
    );
  }

  if (stats.avgCostCents > 50) {
    recs.push(
      `Average cost is $${(stats.avgCostCents / 100).toFixed(2)}/run — consider switching to Haiku for low-stakes tasks.`
    );
  }

  if (avgQuality > 0 && avgQuality < 6) {
    recs.push(
      `Average quality score is ${avgQuality.toFixed(1)}/10 — significant prompt improvement needed, especially for ${worstDim ?? "all dimensions"}.`
    );
  } else if (avgQuality >= 6 && avgQuality < 7.5 && worstDim) {
    recs.push(
      `Quality is acceptable (${avgQuality.toFixed(1)}/10) but "${worstDim}" scores consistently low — add more explicit guidance for this dimension.`
    );
  }

  if (!recs.length) {
    recs.push(`${agentName} is performing well. Continue monitoring weekly.`);
  }

  return recs;
}
