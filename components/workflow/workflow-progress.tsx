"use client";

import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type WorkflowProgressProps = {
  artistId?: string;
  releaseId?: string;
};

function stepBadge(status: string) {
  if (status === "completed") {
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">completed</Badge>;
  }
  if (status === "current") {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">in progress</Badge>;
  }
  return <Badge variant="outline">pending</Badge>;
}

export function WorkflowProgress({ artistId, releaseId }: WorkflowProgressProps) {
  const { data, isLoading } = trpc.workflow.progress.useQuery({ artistId, releaseId });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Workflow Progress</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading workflow state...</p>
        ) : (
          <div className="space-y-3">
            {(data?.steps ?? []).map((step, index) => (
              <div key={step.id} className="flex items-center justify-between rounded border p-3">
                <div>
                  <p className="text-sm font-medium">{index + 1}. {step.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {step.lastEventAt ? new Date(step.lastEventAt).toLocaleString() : "No activity yet"}
                  </p>
                </div>
                {stepBadge(step.status)}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

