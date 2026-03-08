import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { VoiceProfilerPanel, InngestEventPanel } from "@/components/admin/agent-trigger-panel";
import { AgentRunsTable } from "@/components/admin/agent-runs-table";
import { Badge } from "@/components/ui/badge";
import { AgentMonitoringDashboard } from "@/components/admin/agent-monitoring-dashboard";

export const metadata: Metadata = { title: "Agent Monitoring" };

export default function AdminAgentsPage() {
  return (
    <>
      <Header title="Agent Monitoring" />
      <main className="flex-1 p-6">
        <div className="mb-6 flex items-center gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Agent Monitoring and Lab</h2>
            <p className="text-muted-foreground">
              Reliability dashboard, filters, costs, and manual agent/event tooling
            </p>
          </div>
          <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
            Admin
          </Badge>
        </div>

        <div className="space-y-8">
          <section>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Monitoring
            </h3>
            <AgentMonitoringDashboard />
          </section>

          {/* Direct agent calls via tRPC */}
          <section>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Direct Agent Calls (tRPC)
            </h3>
            <div className="grid gap-6 lg:grid-cols-1 xl:grid-cols-1">
              <VoiceProfilerPanel />
            </div>
          </section>

          {/* Inngest event triggers */}
          <section>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Inngest Event Bus
            </h3>
            <InngestEventPanel />
          </section>

          {/* Run history */}
          <section>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Run History
            </h3>
            <AgentRunsTable />
          </section>
        </div>
      </main>
    </>
  );
}
