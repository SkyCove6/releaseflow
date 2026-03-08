// ─── Rubric types ────────────────────────────────────────────────────────────

export interface RubricDimension {
  name:        string;
  description: string;
  weight:      number;   // 0–1, all weights in a rubric must sum to 1
}

export interface AgentRubric {
  agentName:   string;
  description: string;
  dimensions:  RubricDimension[];
  /** Full system prompt sent to the judge LLM. */
  judgeSystemPrompt: string;
}

// ─── Eval run statistics ─────────────────────────────────────────────────────

export interface EvalRunStats {
  agentName:      string;
  period:         { start: string; end: string };
  totalRuns:      number;
  successRuns:    number;
  failedRuns:     number;
  successRate:    number;   // 0–1
  avgTokens:      number;
  avgCostCents:   number;
  totalCostCents: number;
  avgDurationMs:  number;
  p95DurationMs:  number;
}

// ─── Quality scoring ─────────────────────────────────────────────────────────

export interface EvalQualityScore {
  runId:           string;
  agentName:       string;
  dimensionScores: Record<string, number>;   // dimension.name → 1–10
  totalScore:      number;                   // weighted average, 1–10
  feedback:        string;
  createdAt:       string;
}

// ─── Full evaluation report ───────────────────────────────────────────────────

export interface EvalReport {
  stats:            EvalRunStats;
  qualityScores:    EvalQualityScore[];
  avgQualityScore:  number;    // 1–10 weighted average across sampled runs
  worstDimension:   string | null;
  bestDimension:    string | null;
  recommendations:  string[];
  sampleSize:       number;
  evaluatedAt:      string;
}

// ─── Optimization ─────────────────────────────────────────────────────────────

export interface OptimizationSuggestion {
  targetDimension:   string;
  currentScore:      number;
  suggestion:        string;
  rationale:         string;
  /** Concrete text to add / replace in the prompt. */
  promptPatch:       string;
  estimatedImpact:   "high" | "medium" | "low";
}

export interface OptimizationReport {
  agentName:    string;
  basedOnReport: EvalReport;
  suggestions:  OptimizationSuggestion[];
  generatedAt:  string;
}

// ─── A/B test ────────────────────────────────────────────────────────────────

export interface ABTestResult {
  agentName:     string;
  input:         string;
  oldPromptScore: number;
  newPromptScore: number;
  oldOutput:     string;
  newOutput:     string;
  winner:        "old" | "new" | "tie";
  feedback:      string;
  costCents:     number;
}

// ─── Historical data point (for Recharts) ────────────────────────────────────

export interface EvalDataPoint {
  week:          string;   // ISO week label, e.g. "2026-W10"
  agentName:     string;
  avgQuality:    number | null;
  avgCostCents:  number;
  successRate:   number;
  runCount:      number;
}
