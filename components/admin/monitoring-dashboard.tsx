"use client";

import { trpc } from "@/lib/trpc/client";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Users, DollarSign, Bot, CheckCircle } from "lucide-react";

// ─── Colour palette ───────────────────────────────────────────────────────────

const AGENT_COLOURS: Record<string, string> = {
  "voice-profiler":        "#6366f1",
  "campaign-strategist":   "#8b5cf6",
  "content-writer":        "#ec4899",
  "playlist-pitcher":      "#f59e0b",
  "analytics-interpreter": "#10b981",
};
const PIE_COLOURS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981"];

function cents(c: number) {
  return `$${(c / 100).toFixed(2)}`;
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  loading,
  alert,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  loading?: boolean;
  alert?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-5">
        <div className={`rounded-lg p-2 ${alert ? "bg-red-100" : "bg-muted"}`}>
          <Icon className={`h-5 w-5 ${alert ? "text-red-600" : "text-indigo-500"}`} />
        </div>
        <div className="min-w-0">
          {loading ? (
            <Skeleton className="h-7 w-20 mb-1" />
          ) : (
            <p className="text-2xl font-bold tabular-nums">{value}</p>
          )}
          <p className="text-xs text-muted-foreground truncate">{title}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export function MonitoringDashboard() {
  const { data: metrics, isLoading: mLoading } = trpc.admin.metrics.useQuery();
  const { data: signups, isLoading: sLoading }  = trpc.admin.signupTimeline.useQuery({ days: 30 });
  const { data: costs,   isLoading: cLoading }  = trpc.admin.agentCostTimeline.useQuery({ days: 30 });
  const { data: rates }  = trpc.admin.agentSuccessRates.useQuery({ days: 30 });
  const { data: plans }  = trpc.admin.planDistribution.useQuery();
  const { data: errors } = trpc.admin.errorLog.useQuery({ limit: 20 });
  const { data: cohorts } = trpc.admin.cohortRetention.useQuery();
  const { data: stale } = trpc.admin.staleReleases.useQuery({ minutesThreshold: 120, limit: 20 });
  const staleRows = stale ?? [];

  const agentNames = Array.from(
    new Set((costs ?? []).flatMap((row) => Object.keys(row).filter((k) => k !== "date")))
  );

  return (
    <div className="space-y-8">

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={DollarSign} title="MRR" loading={mLoading}
          value={metrics ? cents(metrics.mrrCents) : "—"} />
        <StatCard icon={Users} title="Total users" loading={mLoading}
          value={metrics?.totalUsers ?? "—"}
          sub={`+${metrics?.newUsersThisWeek ?? 0} this week`} />
        <StatCard icon={Bot} title="Agent runs / month" loading={mLoading}
          value={metrics?.agentRunsThisMonth ?? "—"} />
        <StatCard icon={DollarSign} title="AI cost / month" loading={mLoading}
          value={metrics ? cents(metrics.costCentsThisMonth) : "—"} />
        <StatCard icon={CheckCircle} title="Success rate" loading={mLoading}
          value={metrics ? `${metrics.successRate}%` : "—"} />
        <StatCard icon={AlertTriangle} title="Failed runs / week" loading={mLoading}
          value={metrics?.failedRunsThisWeek ?? "—"}
          alert={(metrics?.failedRunsThisWeek ?? 0) > 5} />
      </div>

      {/* ── Signups + Agent cost ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Signups (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            {sLoading ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={signups ?? []}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#6366f1" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Cost by Agent (30d, USD)</CardTitle>
          </CardHeader>
          <CardContent>
            {cLoading ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={(costs ?? []).map((row) => ({
                  ...row,
                  ...Object.fromEntries(
                    Object.entries(row)
                      .filter(([k]) => k !== "date")
                      .map(([k, v]) => {
                        const numeric = typeof v === "number" ? v : Number(v ?? 0);
                        return [k, Math.round((numeric / 100) * 100) / 100];
                      })
                  ),
                }))}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                  <Legend />
                  {agentNames.map((name) => (
                    <Bar key={name} dataKey={name} stackId="a"
                      fill={AGENT_COLOURS[name] ?? "#94a3b8"} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Agent health + Plan distribution ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent Success Rates (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(rates ?? []).map((r) => (
                <div key={r.agent} className="flex items-center gap-3">
                  <span className="w-44 truncate text-sm">{r.agent}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${r.successRate}%`,
                        background: r.successRate >= 90 ? "#10b981" : r.successRate >= 70 ? "#f59e0b" : "#ef4444",
                      }}
                    />
                  </div>
                  <span className="w-12 text-right text-sm tabular-nums">{r.successRate}%</span>
                  <span className="text-xs text-muted-foreground">({r.total})</span>
                </div>
              ))}
              {(rates ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No runs in this period.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={plans ?? []} dataKey="count" nameKey="plan"
                  cx="50%" cy="50%" outerRadius={60} innerRadius={30}>
                  {(plans ?? []).map((_, i) => (
                    <Cell key={i} fill={PIE_COLOURS[i % PIE_COLOURS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <ul className="space-y-1.5 text-sm">
              {(plans ?? []).map((p, i) => (
                <li key={p.plan} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full"
                    style={{ background: PIE_COLOURS[i % PIE_COLOURS.length] }} />
                  <span className="capitalize">{p.plan}</span>
                  <span className="font-semibold">{p.count}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* ── Cohort retention ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cohort Retention</CardTitle>
          <CardDescription>% of sign-up cohort that ran ≥1 agent in week 1 and week 4</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={cohorts ?? []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Legend />
              <Bar dataKey="week1Rate" name="Week 1" fill="#6366f1" />
              <Bar dataKey="week4Rate" name="Week 4" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Error log ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Agent Errors</CardTitle>
        </CardHeader>
        <CardContent>
          {(errors ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No errors.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4">Agent</th>
                    <th className="pb-2 pr-4">Error</th>
                    <th className="pb-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {errors?.map((e) => (
                    <tr key={e.id as string} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <Badge variant="outline">{e.agent_name as string}</Badge>
                      </td>
                      <td className="py-2 pr-4 max-w-md truncate text-destructive text-xs">
                        {(e.error as string) ?? "Unknown error"}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(e.created_at as string).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stale Release Pipeline</CardTitle>
          <CardDescription>Releases that appear stalled in planned/active stages</CardDescription>
        </CardHeader>
        <CardContent>
          {staleRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stale releases detected.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4">Release</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Minutes</th>
                    <th className="pb-2 pr-4">Campaign</th>
                    <th className="pb-2 pr-4">Content</th>
                    <th className="pb-2 pr-4">Pitches</th>
                    <th className="pb-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {staleRows.map((row) => (
                    <tr key={row.id as string} className="border-b last:border-0">
                      <td className="py-2 pr-4">{row.title as string}</td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline">{row.status as string}</Badge>
                      </td>
                      <td className="py-2 pr-4">{Number(row.minutesSinceUpdate ?? 0)}</td>
                      <td className="py-2 pr-4">{row.hasCampaign ? "yes" : "no"}</td>
                      <td className="py-2 pr-4">{row.hasContent ? "yes" : "no"}</td>
                      <td className="py-2 pr-4">{Number(row.pitchCount ?? 0)}</td>
                      <td className="py-2">{(row.staleReason as string) ?? "unknown"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
