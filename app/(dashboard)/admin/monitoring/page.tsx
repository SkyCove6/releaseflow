import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { MonitoringDashboard } from "@/components/admin/monitoring-dashboard";

export const metadata: Metadata = { title: "Monitoring — Admin" };

export default function MonitoringPage() {
  return (
    <>
      <Header title="Monitoring" />
      <main className="flex-1 p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Operations Dashboard</h2>
          <p className="text-muted-foreground">Real-time business and agent health metrics.</p>
        </div>
        <MonitoringDashboard />
      </main>
    </>
  );
}
