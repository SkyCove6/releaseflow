"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc/client";
import { WorkflowProgress } from "@/components/workflow/workflow-progress";
import { toast } from "sonner";

type Milestone = {
  id: string;
  date: string;
  platform: string;
  description: string;
  priority: "low" | "medium" | "high";
};

const PRIORITY_STYLES: Record<Milestone["priority"], string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

export default function CampaignReviewPage() {
  const params = useParams<{ releaseId: string }>();
  const releaseId = params.releaseId;
  const utils = trpc.useUtils();

  const query = trpc.campaign.byRelease.useQuery({ releaseId });
  const approve = trpc.campaign.approve.useMutation({
    onSuccess: async () => {
      toast.success("Campaign approved");
      await utils.campaign.byRelease.invalidate({ releaseId });
    },
    onError: (error) => toast.error(error.message),
  });
  const updateMilestone = trpc.campaign.updateMilestone.useMutation({
    onSuccess: async () => {
      toast.success("Milestone updated");
      await utils.campaign.byRelease.invalidate({ releaseId });
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteMilestone = trpc.campaign.deleteMilestone.useMutation({
    onSuccess: async () => {
      toast.success("Milestone deleted");
      await utils.campaign.byRelease.invalidate({ releaseId });
    },
    onError: (error) => toast.error(error.message),
  });

  const campaign = query.data?.campaign;
  const milestones = (campaign?.milestones ?? []) as Milestone[];
  const phases = useMemo(
    () =>
      milestones.reduce<Record<string, Milestone[]>>((acc, milestone) => {
        const key = milestone.platform || "general";
        if (!acc[key]) acc[key] = [];
        acc[key].push(milestone);
        return acc;
      }, {}),
    [milestones]
  );

  const [editing, setEditing] = useState<Milestone | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editPlatform, setEditPlatform] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<Milestone["priority"]>("medium");

  function startEditing(milestone: Milestone) {
    setEditing(milestone);
    setEditDate(milestone.date);
    setEditPlatform(milestone.platform);
    setEditDescription(milestone.description);
    setEditPriority(milestone.priority);
  }

  return (
    <>
      <Header title="Campaign Review" />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Campaign timeline</span>
                <Button
                  onClick={() => campaign && approve.mutate({ campaignId: campaign.id as string })}
                  disabled={!campaign || approve.isPending}
                >
                  Approve campaign
                </Button>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Review and refine milestones before content generation.
              </p>
            </CardHeader>
            <CardContent>
              {!campaign ? (
                <p className="text-sm text-muted-foreground">
                  Campaign still generating. Keep this tab open and refresh.
                </p>
              ) : (
                <Tabs defaultValue="timeline" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="phases">Phases</TabsTrigger>
                  </TabsList>

                  <TabsContent value="timeline" className="space-y-3">
                    {milestones.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No milestones available yet.</p>
                    ) : (
                      milestones.map((milestone) => (
                        <Card key={milestone.id}>
                          <CardContent className="space-y-3 pt-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{milestone.date}</Badge>
                              <Badge variant="outline">{milestone.platform}</Badge>
                              <Badge className={PRIORITY_STYLES[milestone.priority]}>
                                {milestone.priority}
                              </Badge>
                            </div>
                            <p className="text-sm">{milestone.description}</p>
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" onClick={() => startEditing(milestone)}>
                                Edit milestone
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  campaign &&
                                  deleteMilestone.mutate({
                                    campaignId: campaign.id as string,
                                    milestoneId: milestone.id,
                                  })
                                }
                              >
                                Delete milestone
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="phases" className="space-y-3">
                    {Object.entries(phases).map(([phase, phaseMilestones]) => (
                      <Card key={phase}>
                        <CardHeader>
                          <CardTitle className="text-base capitalize">{phase}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                            {phaseMilestones.map((item) => (
                              <li key={item.id}>{item.description}</li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    ))}
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>

          <WorkflowProgress releaseId={releaseId} />
        </div>
      </main>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit milestone</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="edit-date">Date</Label>
              <Input id="edit-date" type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-platform">Platform</Label>
              <Input id="edit-platform" value={editPlatform} onChange={(event) => setEditPlatform(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-priority">Priority</Label>
              <select
                id="edit-priority"
                className="flex h-9 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={editPriority}
                onChange={(event) => setEditPriority(event.target.value as Milestone["priority"])}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <Button
              onClick={() => {
                if (!editing || !campaign) return;
                updateMilestone.mutate({
                  campaignId: campaign.id as string,
                  milestoneId: editing.id,
                  date: editDate,
                  platform: editPlatform,
                  description: editDescription,
                  priority: editPriority,
                });
                setEditing(null);
              }}
            >
              Save changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

