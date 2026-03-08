"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";

function cents(value: number) {
  return `$${(value / 100).toFixed(2)}`;
}

function statusBadge(status: string) {
  if (status === "completed") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">completed</Badge>;
  if (status === "failed") return <Badge variant="destructive">failed</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export function AgentMonitoringDashboard() {
  const [agentName, setAgentName] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const { data, isLoading } = trpc.admin.agentRunsDashboard.useQuery({
    agentName: agentName || undefined,
    status: (status || undefined) as "running" | "completed" | "failed" | undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit: 200,
  });

  const userChart = useMemo(
    () => (data?.runsPerUser ?? []).map((row) => ({ user: row.userId.slice(0, 8), runs: row.count })),
    [data?.runsPerUser]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent Monitoring</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input placeholder="Agent name" value={agentName} onChange={(event) => setAgentName(event.target.value)} />
          <Select value={status || "all"} onValueChange={(value) => setStatus(value === "all" ? "" : value)}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="running">running</SelectItem>
              <SelectItem value="completed">completed</SelectItem>
              <SelectItem value="failed">failed</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Total runs</p>
            <p className="text-2xl font-semibold">{data?.metrics.totalRuns ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Failure rate</p>
            <p className="text-2xl font-semibold">{data?.metrics.failureRate ?? 0}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Average latency</p>
            <p className="text-2xl font-semibold">{data?.metrics.averageLatencyMs ?? 0}ms</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">AI cost per run</p>
            <p className="text-2xl font-semibold">{cents(data?.metrics.averageCostCents ?? 0)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runs per user</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={userChart}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="user" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="runs" fill="#4f46e5" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading runs...</p>
          ) : !(data?.runs.length) ? (
            <p className="text-sm text-muted-foreground">No runs match the filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4">Agent</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Latency</th>
                    <th className="pb-2 pr-4">Cost</th>
                    <th className="pb-2 pr-4">User</th>
                    <th className="pb-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((row) => (
                    <tr key={row.id as string} className="border-b last:border-0">
                      <td className="py-2 pr-4">{row.agent_name as string}</td>
                      <td className="py-2 pr-4">{statusBadge(row.status as string)}</td>
                      <td className="py-2 pr-4">{Number(row.duration_ms ?? 0)}ms</td>
                      <td className="py-2 pr-4">{cents(Number(row.cost_cents ?? 0))}</td>
                      <td className="py-2 pr-4">{String(row.user_id ?? "anonymous").slice(0, 8)}</td>
                      <td className="py-2">{new Date(row.created_at as string).toLocaleString()}</td>
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

