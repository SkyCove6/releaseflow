import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { EvalDashboard } from "@/components/admin/eval-dashboard";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Agent Evals" };

export default function AdminEvalsPage() {
  return (
    <>
      <Header title="Agent Evals" />
      <main className="flex-1 p-6">
        <div className="mb-6 flex items-center gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Agent Evaluation</h2>
            <p className="text-muted-foreground">
              Monitor quality, cost, and performance. Use Claude-as-judge to score outputs and
              A/B test prompt improvements.
            </p>
          </div>
          <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
            Dev only
          </Badge>
        </div>
        <EvalDashboard />
      </main>
    </>
  );
}
