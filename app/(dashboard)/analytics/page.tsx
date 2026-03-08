"use client";

import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { normalizeReleaseStatus, type ReleaseStatus } from "@/lib/release-status";

type ReleaseListItem = {
  id: string;
  title?: string;
  status?: string;
  artists?: { name?: string } | null;
};

function toCanonicalStatus(value: string): ReleaseStatus {
  try {
    return normalizeReleaseStatus(value);
  } catch {
    return "draft";
  }
}

export default function AnalyticsPage() {
  const overview = trpc.analytics.overview.useQuery();
  const releases = trpc.releases.list.useQuery();
  const byStatus = trpc.analytics.releasesByStatus.useQuery();
  const releaseRows: ReleaseListItem[] = Array.isArray(releases.data)
    ? (releases.data as unknown as ReleaseListItem[])
    : [];
  const requestAnalytics = trpc.plan.requestAnalytics.useMutation({
    onSuccess: () => toast.success("Analytics job requested"),
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <Header title="Analytics" />
      <main className="flex-1 p-6 space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
          <p className="text-muted-foreground">Monitor release performance and generate reports</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Total Artists</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{overview.data?.totalArtists ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Total Releases</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{overview.data?.totalReleases ?? 0}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Object.entries(byStatus.data ?? {}).map(([status, count]) => (
              <Badge key={status} variant="outline">
                {status}: {count}
              </Badge>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Report Generation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {releaseRows.map((release) => {
              const status = toCanonicalStatus(String(release.status ?? "draft"));
              const canGenerate = status === "active" || status === "completed";

              return (
                <div key={release.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                  <div>
                    <div className="font-medium">{release.title ?? "Untitled"}</div>
                    <div className="text-xs text-muted-foreground">
                      {(release.artists as { name?: string } | null)?.name ?? "Unknown artist"} • {status}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={!canGenerate || requestAnalytics.isPending}
                    onClick={() => requestAnalytics.mutate({ releaseId: release.id })}
                  >
                    Generate analytics
                  </Button>
                </div>
              );
            })}
            {releaseRows.length === 0 && (
              <p className="text-sm text-muted-foreground">No releases available.</p>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
