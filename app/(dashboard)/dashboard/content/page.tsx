"use client";

import { useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { WorkflowProgress } from "@/components/workflow/workflow-progress";

type ContentItem = {
  id: string;
  platform: string;
  content_type: string;
  body: string;
  status: "draft" | "approved" | "scheduled" | "published" | "failed";
  hashtags?: string[];
  cta?: string;
};

const statuses = ["all", "draft", "approved", "scheduled", "published", "failed"] as const;

function statusBadge(status: ContentItem["status"]) {
  if (status === "approved") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">approved</Badge>;
  if (status === "published") return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">published</Badge>;
  if (status === "failed") return <Badge variant="destructive">failed</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function DashboardContentReviewPage() {
  const utils = trpc.useUtils();
  const [activeStatus, setActiveStatus] = useState<(typeof statuses)[number]>("all");
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editHashtags, setEditHashtags] = useState("");
  const [editCta, setEditCta] = useState("");

  const query = trpc.content.list.useQuery();
  const approve = trpc.content.approve.useMutation({
    onSuccess: async () => {
      toast.success("Content approved");
      await utils.content.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const reject = trpc.content.reject.useMutation({
    onSuccess: async () => {
      toast.success("Content rejected");
      await utils.content.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const update = trpc.content.update.useMutation({
    onSuccess: async () => {
      toast.success("Content updated");
      setEditing(null);
      await utils.content.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const allItems = (query.data ?? []) as unknown as ContentItem[];
  const filteredItems = useMemo(
    () =>
      allItems.filter((item) => (activeStatus === "all" ? true : item.status === activeStatus)),
    [activeStatus, allItems]
  );

  function startEdit(item: ContentItem) {
    setEditing(item);
    setEditBody(item.body);
    setEditHashtags((item.hashtags ?? []).join(", "));
    setEditCta(item.cta ?? "");
  }

  return (
    <>
      <Header title="Content Review" />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle>Generated content items</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={activeStatus} onValueChange={(value) => setActiveStatus(value as (typeof statuses)[number])}>
                <TabsList className="mb-4 grid w-full grid-cols-3 gap-2 sm:grid-cols-6">
                  {statuses.map((status) => (
                    <TabsTrigger key={status} value={status} className="capitalize">
                      {status}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {statuses.map((status) => (
                  <TabsContent key={status} value={status} className="space-y-3">
                    {filteredItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No content items in this stage.</p>
                    ) : (
                      filteredItems.map((item) => (
                        <Card key={item.id}>
                          <CardContent className="space-y-3 pt-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{item.platform}</Badge>
                              <Badge variant="outline">{item.content_type}</Badge>
                              {statusBadge(item.status)}
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{item.body}</p>
                            <div className="text-xs text-muted-foreground">
                              <p>Hashtags: {(item.hashtags ?? []).join(" ") || "None"}</p>
                              <p>CTA: {item.cta || "None"}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                onClick={() => approve.mutate({ contentId: item.id })}
                                disabled={approve.isPending || item.status === "approved"}
                              >
                                Approve
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => startEdit(item)}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => reject.mutate({ contentId: item.id, reason: "Rejected in review UI" })}
                              >
                                Reject
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          <WorkflowProgress />
        </div>
      </main>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit content item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="edit-content-body">Body</Label>
              <Input id="edit-content-body" value={editBody} onChange={(event) => setEditBody(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-content-hashtags">Hashtags (comma-separated)</Label>
              <Input id="edit-content-hashtags" value={editHashtags} onChange={(event) => setEditHashtags(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-content-cta">CTA</Label>
              <Input id="edit-content-cta" value={editCta} onChange={(event) => setEditCta(event.target.value)} />
            </div>
            <Button
              onClick={() =>
                editing &&
                update.mutate({
                  contentId: editing.id,
                  body: editBody,
                  hashtags: editHashtags.split(",").map((tag) => tag.trim()).filter(Boolean),
                  cta: editCta,
                })
              }
            >
              Save content
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

