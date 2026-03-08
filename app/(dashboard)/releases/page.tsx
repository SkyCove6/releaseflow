"use client";

import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { normalizeReleaseStatus, type ReleaseStatus } from "@/lib/release-status";

type ReleaseCampaign = {
  id: string;
  content_items?: Array<unknown> | null;
};

type ReleaseListItem = {
  id: string;
  title?: string;
  status?: string;
  type?: string;
  artists?: { name?: string } | null;
  campaigns?: Array<ReleaseCampaign> | null;
  playlist_pitches?: Array<unknown> | null;
};

function toCanonicalStatus(value: string): ReleaseStatus {
  try {
    return normalizeReleaseStatus(value);
  } catch {
    return "draft";
  }
}

function statusTone(status: ReleaseStatus) {
  if (status === "completed") return "bg-emerald-100 text-emerald-900";
  if (status === "active") return "bg-sky-100 text-sky-900";
  if (status === "planned") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-900";
}

export default function ReleasesPage() {
  const utils = trpc.useUtils();
  const releases = trpc.releases.list.useQuery();
  const releaseRows: ReleaseListItem[] = Array.isArray(releases.data)
    ? (releases.data as unknown as ReleaseListItem[])
    : [];
  const buildPlan = trpc.plan.generatePlan.useMutation({
    onSuccess: async () => {
      await utils.releases.list.invalidate();
      toast.success("Rollout plan generated");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateStatus = trpc.releases.updateStatus.useMutation({
    onSuccess: async () => {
      await utils.releases.list.invalidate();
      toast.success("Release status updated");
    },
    onError: (error) => toast.error(error.message),
  });
  const approveCampaign = trpc.plan.approveCampaign.useMutation({
    onSuccess: async () => {
      await utils.releases.list.invalidate();
      toast.success("Campaign approved");
    },
    onError: (error) => toast.error(error.message),
  });
  const requestAnalytics = trpc.plan.requestAnalytics.useMutation({
    onSuccess: () => toast.success("Analytics generation requested"),
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <Header title="Releases" />
      <main className="flex-1 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Releases</h2>
            <p className="text-muted-foreground">Drive each release from draft to completed</p>
          </div>
          <Button asChild>
            <Link href="/releases/new">New Release</Link>
          </Button>
        </div>

        {releaseRows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No releases yet</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Create your first release to start the automation chain.
              </p>
              <Button asChild>
                <Link href="/releases/new">Create Release</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {releaseRows.map((release) => {
              const campaigns = Array.isArray(release.campaigns) ? release.campaigns : [];
              const firstCampaign = campaigns[0] ?? null;
              const pitches = Array.isArray(release.playlist_pitches) ? release.playlist_pitches : [];
              const contentCount = campaigns.reduce((count, campaign) => {
                const items = Array.isArray(campaign.content_items) ? campaign.content_items : [];
                return count + items.length;
              }, 0);
              const status = toCanonicalStatus(String(release.status ?? "draft"));

              return (
                <Card key={release.id}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{release.title ?? "Untitled"}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {(release.artists as { name?: string } | null)?.name ?? "Unknown artist"} •{" "}
                        {release.type?.toUpperCase() ?? "SINGLE"}
                      </p>
                    </div>
                    <Badge className={statusTone(status)}>{status}</Badge>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-sm text-muted-foreground">
                      Campaigns: {campaigns.length} • Content items: {contentCount} • Pitches: {pitches.length}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {status === "draft" && (
                        <Button
                          size="sm"
                          onClick={() => buildPlan.mutate({ releaseId: release.id })}
                          disabled={buildPlan.isPending}
                        >
                          Build rollout plan
                        </Button>
                      )}
                      {status === "planned" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateStatus.mutate({ id: release.id, status: "active" })
                            }
                            disabled={updateStatus.isPending}
                          >
                            Publish now
                          </Button>
                          <Button
                            size="sm"
                            onClick={() =>
                              firstCampaign
                                ? approveCampaign.mutate({ campaignId: String(firstCampaign.id) })
                                : toast.error("Campaign is not ready yet")
                            }
                            disabled={approveCampaign.isPending}
                          >
                            Approve plan
                          </Button>
                          <Button asChild size="sm" variant="ghost">
                            <Link href="/content">Generate content</Link>
                          </Button>
                        </>
                      )}
                      {status === "active" && (
                        <Button
                          size="sm"
                          onClick={() => requestAnalytics.mutate({ releaseId: release.id })}
                          disabled={requestAnalytics.isPending}
                        >
                          Generate analytics
                        </Button>
                      )}
                      {status === "completed" && (
                        <Button asChild size="sm" variant="outline">
                          <Link href="/analytics">Review report</Link>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
