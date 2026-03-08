"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const EVENT_NAMES = [
  "artist/created",
  "release/created",
  "campaign/approved",
  "pitch/requested",
  "release/published",
  "user/signed-up",
  "analytics/report.requested",
] as const;

export function EventsDebugger() {
  const [eventName, setEventName] = useState<string>("release/created");
  const [status, setStatus] = useState<string>("");
  const [payload, setPayload] = useState<string>(
    JSON.stringify(
      {
        userId: "00000000-0000-0000-0000-000000000000",
        actorId: "00000000-0000-0000-0000-000000000000",
        tenantId: "00000000-0000-0000-0000-000000000000",
        resourceId: "00000000-0000-0000-0000-000000000000",
        idempotencyKey: "debug:event",
        traceId: "debug_trace",
      },
      null,
      2
    )
  );
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [selectedTrace, setSelectedTrace] = useState<string>("");
  const [sendResult, setSendResult] = useState<string>("");

  const logs = trpc.admin.recentEventLogs.useQuery({
    eventName: eventName || undefined,
    status: (status || undefined) as "sent" | "failed" | undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit: 120,
  });

  const workflowRuns = trpc.admin.workflowRuns.useQuery(
    {
      traceId: selectedTrace || undefined,
      limit: 80,
    },
    { enabled: Boolean(selectedTrace) }
  );

  const recentTraces = useMemo(
    () =>
      Array.from(
        new Set(
          (logs.data ?? [])
            .map((row) => String(row.trace_id ?? ""))
            .filter((trace) => trace.length > 0)
        )
      ).slice(0, 50),
    [logs.data]
  );

  async function triggerEvent() {
    try {
      const parsedPayload = JSON.parse(payload) as Record<string, unknown>;
      const response = await fetch("/api/inngest/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: eventName,
          data: parsedPayload,
        }),
      });

      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSendResult(`FAILED: ${body.error ?? "unknown error"}`);
        return;
      }

      setSendResult("OK");
      await logs.refetch();
    } catch (error) {
      setSendResult(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manual event trigger</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Select value={eventName} onValueChange={setEventName}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_NAMES.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            <Select value={status || "all"} onValueChange={(value) => setStatus(value === "all" ? "" : value)}>
              <SelectTrigger>
                <SelectValue placeholder="status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all statuses</SelectItem>
                <SelectItem value="sent">sent</SelectItem>
                <SelectItem value="failed">failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Textarea className="font-mono text-xs min-h-44" value={payload} onChange={(event) => setPayload(event.target.value)} />
          <div className="flex items-center gap-3">
            <Button onClick={() => void triggerEvent()}>Trigger event</Button>
            {sendResult ? <Badge variant={sendResult === "OK" ? "default" : "destructive"}>{sendResult}</Badge> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent events</CardTitle>
        </CardHeader>
        <CardContent>
          {!logs.data?.length ? (
            <p className="text-sm text-muted-foreground">No events found for this filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4">Event</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Trace</th>
                    <th className="pb-2 pr-4">Error</th>
                    <th className="pb-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.data.map((row) => (
                    <tr key={row.id as string} className="border-b last:border-0">
                      <td className="py-2 pr-4">{row.event_name as string}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={row.status === "failed" ? "destructive" : "outline"}>
                          {row.status as string}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          className="text-xs underline"
                          onClick={() => setSelectedTrace(String(row.trace_id ?? ""))}
                        >
                          {String(row.trace_id ?? "").slice(0, 18)}
                        </button>
                      </td>
                      <td className="py-2 pr-4 text-xs text-destructive">{(row.error as string) ?? ""}</td>
                      <td className="py-2">{new Date(row.created_at as string).toLocaleString()}</td>
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
          <CardTitle className="text-base">Workflow runs for trace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={selectedTrace || "none"} onValueChange={(value) => setSelectedTrace(value === "none" ? "" : value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select a trace id" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {recentTraces.map((trace) => (
                <SelectItem key={trace} value={trace}>
                  {trace}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!workflowRuns.data?.length ? (
            <p className="text-sm text-muted-foreground">No workflow runs selected.</p>
          ) : (
            <div className="space-y-2">
              {workflowRuns.data.map((run) => (
                <details key={run.id as string} className="rounded border p-3">
                  <summary className="cursor-pointer text-sm">
                    {run.agent_name as string} · {run.status as string} · {new Date(run.created_at as string).toLocaleString()}
                  </summary>
                  <pre className="mt-3 overflow-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(run.output ?? {}, null, 2)}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

