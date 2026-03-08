import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { EventsDebugger } from "@/components/admin/events-debugger";

export const metadata: Metadata = { title: "Event Debugger" };

export default function AdminEventsPage() {
  return (
    <>
      <Header title="Event Debugger" />
      <main className="flex-1 p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Inngest Event Debugger</h2>
          <p className="text-muted-foreground">
            Inspect emitted events, trigger manual events, and trace downstream workflow runs.
          </p>
        </div>
        <EventsDebugger />
      </main>
    </>
  );
}

