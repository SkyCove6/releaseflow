"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { formatDistanceToNow } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RefreshCw } from "lucide-react";

function statusBadge(status: string) {
  if (status === "completed") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">completed</Badge>;
  if (status === "failed") return <Badge variant="destructive">failed</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function formatCost(cents: number | null) {
  if (!cents) return "—";
  return cents < 100 ? `${cents}¢` : `$${(cents / 100).toFixed(2)}`;
}

function formatDuration(ms: number | null) {
  if (!ms) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function AgentRunsTable() {
  const [agentFilter, setAgentFilter] = useState<string | undefined>();

  const { data, isLoading, refetch, isFetching } =
    trpc.agents.recentRuns.useQuery({ agentName: agentFilter, limit: 50 });

  const agents = ["voice-profiler", "campaign-strategist", "content-writer", "release-agent"];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Recent Agent Runs</CardTitle>
            <CardDescription>Last 50 runs across all agents</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={() => setAgentFilter(undefined)}
            className={`rounded px-2 py-1 text-xs ${!agentFilter ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
          >
            All
          </button>
          {agents.map((a) => (
            <button
              key={a}
              onClick={() => setAgentFilter(a === agentFilter ? undefined : a)}
              className={`rounded px-2 py-1 text-xs ${agentFilter === a ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
            >
              {a}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : !data?.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No agent runs yet. Trigger one above.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>When</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <code className="text-xs">{run.agent_name}</code>
                  </TableCell>
                  <TableCell>{statusBadge(run.status)}</TableCell>
                  <TableCell className="text-sm">
                    {run.tokens_used?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatCost(run.cost_cents)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDuration(run.duration_ms)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(run.created_at), {
                      addSuffix: true,
                    })}
                  </TableCell>
                  <TableCell>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-xs">
                          View
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>
                            {run.agent_name} run — {run.status}
                          </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          {run.error && (
                            <div className="rounded-md bg-destructive/10 p-3">
                              <p className="text-sm font-medium text-destructive">
                                Error
                              </p>
                              <p className="mt-1 text-xs text-destructive">
                                {run.error}
                              </p>
                            </div>
                          )}
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">
                              INPUT
                            </p>
                            <pre className="max-h-48 overflow-auto rounded bg-muted p-3 text-xs">
                              {JSON.stringify(run.input, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">
                              OUTPUT
                            </p>
                            <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
                              {JSON.stringify(run.output, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
