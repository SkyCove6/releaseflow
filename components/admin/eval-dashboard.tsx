"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, TrendingUp, DollarSign, CheckCircle2, Zap } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// ─── Agent colour palette ─────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  "campaign-strategist":   "#6366f1",
  "content-writer":        "#f59e0b",
  "playlist-pitcher":      "#10b981",
  "analytics-interpreter": "#ef4444",
};

// ─── Date range helpers ───────────────────────────────────────────────────────

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0]!;
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCards() {
  const { data, isLoading } = trpc.evals.agentSummaries.useQuery({
    dateRange: { start: daysAgo(30), end: daysAgo(0) },
  });

  if (isLoading) return <div className="animate-pulse h-24 rounded-lg bg-muted" />;

  const summaries = data ?? [];
  const totalRuns  = summaries.reduce((s, a) => s + a.totalRuns, 0);
  const totalCost  = summaries.reduce((s, a) => s + a.totalCostCents, 0);
  const avgSuccess = summaries.length
    ? summaries.reduce((s, a) => s + a.successRate, 0) / summaries.length
    : 0;
  const totalTokens = summaries.reduce((s, a) => s + a.totalTokens, 0);

  const cards = [
    { label: "Total Runs (30d)", value: totalRuns.toLocaleString(),                 icon: Play,          color: "text-indigo-600" },
    { label: "Total Cost (30d)", value: `$${(totalCost / 100).toFixed(2)}`,         icon: DollarSign,    color: "text-amber-600"  },
    { label: "Avg Success Rate", value: `${(avgSuccess * 100).toFixed(1)}%`,        icon: CheckCircle2,  color: "text-emerald-600"},
    { label: "Tokens Used (30d)", value: `${(totalTokens / 1000).toFixed(1)}k`,    icon: Zap,           color: "text-rose-600"   },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map(({ label, value, icon: Icon, color }) => (
        <Card key={label}>
          <CardContent className="flex items-center gap-4 pt-6">
            <Icon className={`h-8 w-8 ${color}`} />
            <div>
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Quality score line chart ─────────────────────────────────────────────────

function QualityChart() {
  const { data, isLoading } = trpc.evals.historicalData.useQuery({
    agentNames: ["campaign-strategist", "content-writer", "playlist-pitcher", "analytics-interpreter"],
    weeks: 8,
  });

  if (isLoading) return <div className="animate-pulse h-64 rounded-lg bg-muted" />;

  const agents = [...new Set((data ?? []).map((d) => d.agentName))];

  // Pivot: week → { [agentName]: avgQuality }
  const pivot: Record<string, Record<string, number | null>> = {};
  for (const d of data ?? []) {
    if (!pivot[d.week]) pivot[d.week] = {};
    pivot[d.week]![d.agentName] = d.avgQuality;
  }
  const chartData = Object.entries(pivot)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, scores]) => ({ week, ...scores }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-indigo-500" />
          Quality Scores (8 weeks)
        </CardTitle>
        <CardDescription>Claude-as-judge average score per week (1–10)</CardDescription>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No eval data yet — run an evaluation below to populate this chart.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v}/10`, ""]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {agents.map((agent) => (
                <Line
                  key={agent}
                  type="monotone"
                  dataKey={agent}
                  name={agent}
                  stroke={AGENT_COLORS[agent] ?? "#94a3b8"}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Cost bar chart ───────────────────────────────────────────────────────────

function CostChart() {
  const { data, isLoading } = trpc.evals.historicalData.useQuery({
    agentNames: ["campaign-strategist", "content-writer", "playlist-pitcher", "analytics-interpreter"],
    weeks: 8,
  });

  if (isLoading) return <div className="animate-pulse h-64 rounded-lg bg-muted" />;

  const agents = [...new Set((data ?? []).map((d) => d.agentName))];

  const pivot: Record<string, Record<string, number>> = {};
  for (const d of data ?? []) {
    if (!pivot[d.week]) pivot[d.week] = {};
    pivot[d.week]![d.agentName] = d.avgCostCents;
  }
  const chartData = Object.entries(pivot)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, costs]) => ({ week, ...costs }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-amber-500" />
          Avg Cost / Run (¢)
        </CardTitle>
        <CardDescription>Average cost in cents per successful run, by week</CardDescription>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No run data yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v}¢`, ""]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {agents.map((agent) => (
                <Bar
                  key={agent}
                  dataKey={agent}
                  name={agent}
                  fill={AGENT_COLORS[agent] ?? "#94a3b8"}
                  radius={[2, 2, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Run eval panel ───────────────────────────────────────────────────────────

const AGENT_OPTIONS = [
  "campaign-strategist",
  "content-writer",
  "playlist-pitcher",
  "analytics-interpreter",
] as const;

function RunEvalPanel() {
  const [agent, setAgent] = useState<string>(AGENT_OPTIONS[0]);
  const [sampleSize, setSampleSize] = useState("5");
  const [dateStart, setDateStart] = useState(daysAgo(30));
  const [dateEnd, setDateEnd]     = useState(daysAgo(0));

  const evalMutation = trpc.evals.runEval.useMutation({
    onSuccess: (report) => {
      toast.success(
        `Eval complete: ${report.avgQualityScore}/10 avg quality, ${report.sampleSize} samples`
      );
    },
    onError: (err) => toast.error(`Eval failed: ${err.message}`),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Run Evaluation</CardTitle>
        <CardDescription>
          Score a sample of runs using Claude-as-judge. Results are saved to{" "}
          <code className="text-xs">eval_results</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Agent</Label>
          <Select value={agent} onValueChange={setAgent}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {AGENT_OPTIONS.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Sample size (LLM calls)</Label>
          <Select value={sampleSize} onValueChange={setSampleSize}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {[3, 5, 10, 20].map((n) => (
                <SelectItem key={n} value={String(n)}>{n} runs</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>From</Label>
          <input
            type="date"
            className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>To</Label>
          <input
            type="date"
            className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
          />
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-start gap-4">
        <Button
          onClick={() => evalMutation.mutate({ agentName: agent, dateRange: { start: dateStart, end: dateEnd }, sampleSize: parseInt(sampleSize) })}
          disabled={evalMutation.isPending}
          className="gap-2"
        >
          {evalMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {evalMutation.isPending ? "Evaluating…" : "Run eval"}
        </Button>

        {evalMutation.isSuccess && (
          <div className="rounded-lg border bg-muted/50 p-4 text-sm space-y-2 w-full">
            <div className="flex flex-wrap gap-4">
              <span>Quality: <strong>{evalMutation.data.avgQualityScore}/10</strong></span>
              <span>Samples: <strong>{evalMutation.data.sampleSize}</strong></span>
              <span>Success rate: <strong>{(evalMutation.data.stats.successRate * 100).toFixed(1)}%</strong></span>
              <span>Avg cost: <strong>{evalMutation.data.stats.avgCostCents.toFixed(1)}¢</strong></span>
              {evalMutation.data.worstDimension && (
                <span>Worst: <Badge variant="destructive" className="text-xs">{evalMutation.data.worstDimension}</Badge></span>
              )}
            </div>
            {evalMutation.data.recommendations.length > 0 && (
              <ul className="space-y-1 text-muted-foreground text-xs">
                {evalMutation.data.recommendations.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardFooter>
    </Card>
  );
}

// ─── A/B test panel ───────────────────────────────────────────────────────────

function ABTestPanel() {
  const [agent, setAgent]       = useState<string>(AGENT_OPTIONS[0]);
  const [oldPrompt, setOldPrompt] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [userMsg, setUserMsg]   = useState("");

  const mutation = trpc.evals.abTest.useMutation({
    onSuccess: (r) => toast.success(`A/B result: ${r.winner === "tie" ? "Tie" : `"${r.winner}" prompt wins`} (${r.oldPromptScore} vs ${r.newPromptScore})`),
    onError:   (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">A/B Prompt Test</CardTitle>
        <CardDescription>
          Run the same input through two system prompts and score both with Claude Haiku.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Agent</Label>
          <Select value={agent} onValueChange={setAgent}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AGENT_OPTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Old system prompt</Label>
            <Textarea className="h-36 font-mono text-xs" placeholder="Current prompt…" value={oldPrompt} onChange={(e) => setOldPrompt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>New system prompt</Label>
            <Textarea className="h-36 font-mono text-xs" placeholder="Improved prompt…" value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Test input (user message)</Label>
          <Textarea className="h-24 font-mono text-xs" placeholder="The input to run through both prompts…" value={userMsg} onChange={(e) => setUserMsg(e.target.value)} />
        </div>
        {mutation.isSuccess && (
          <div className="rounded-lg border p-4 text-sm space-y-2">
            <div className="flex items-center gap-3">
              <span className="font-semibold">Winner:</span>
              <Badge variant={mutation.data.winner === "new" ? "default" : mutation.data.winner === "old" ? "secondary" : "outline"}>
                {mutation.data.winner === "tie" ? "Tie" : `${mutation.data.winner === "new" ? "New" : "Old"} prompt`}
              </Badge>
              <span className="text-muted-foreground text-xs">Old: {mutation.data.oldPromptScore} · New: {mutation.data.newPromptScore} · Cost: {mutation.data.costCents}¢</span>
            </div>
            <p className="text-xs text-muted-foreground">{mutation.data.feedback}</p>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button
          onClick={() => mutation.mutate({ agentName: agent, oldPrompt, newPrompt, userMessage: userMsg })}
          disabled={mutation.isPending || !oldPrompt || !newPrompt || !userMsg}
          className="gap-2"
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {mutation.isPending ? "Running…" : "Run A/B test"}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function EvalDashboard() {
  return (
    <div className="space-y-8">
      <SummaryCards />
      <div className="grid gap-6 lg:grid-cols-2">
        <QualityChart />
        <CostChart />
      </div>
      <RunEvalPanel />
      <ABTestPanel />
    </div>
  );
}
