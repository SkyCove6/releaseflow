import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { supabaseAdmin } from "@/lib/supabase-admin";

type WorkflowStepId =
  | "voice-profile"
  | "campaign-generation"
  | "content-generation"
  | "publishing"
  | "analytics";

const STEP_ORDER: WorkflowStepId[] = [
  "voice-profile",
  "campaign-generation",
  "content-generation",
  "publishing",
  "analytics",
];

const EVENT_MAP: Record<WorkflowStepId, string[]> = {
  "voice-profile": ["artist/voice-profile.updated", "artist/created", "artist.created"],
  "campaign-generation": ["release/created", "release.created"],
  "content-generation": ["campaign/approved", "campaign.approved", "content/approved", "content.approved"],
  publishing: ["release/published", "release.published"],
  analytics: ["analytics/report.requested", "analytics.report.requested"],
};

function normalizeStatus(completed: boolean, hasPreviousPending: boolean) {
  if (completed) return "completed" as const;
  if (!hasPreviousPending) return "current" as const;
  return "pending" as const;
}

export const workflowRouter = createTRPCRouter({
  progress: protectedProcedure
    .input(
      z.object({
        artistId: z.string().uuid().optional(),
        releaseId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { data } = await supabaseAdmin
        .from("event_logs")
        .select("event_name, payload, created_at, status, user_id")
        .eq("user_id", ctx.user.id)
        .order("created_at", { ascending: true })
        .limit(500);

      const filtered = (data ?? []).filter((row) => {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        if (input.releaseId && payload.releaseId !== input.releaseId && payload.resourceId !== input.releaseId) {
          return false;
        }
        if (input.artistId && payload.artistId !== input.artistId && payload.resourceId !== input.artistId) {
          return false;
        }
        return true;
      });

      const completedByStep = new Map<WorkflowStepId, boolean>();
      const latestByStep = new Map<WorkflowStepId, string>();

      for (const stepId of STEP_ORDER) {
        const names = EVENT_MAP[stepId];
        const matching = filtered.filter((row) => names.includes(String(row.event_name)));
        const success = matching.some((row) => row.status === "sent");
        completedByStep.set(stepId, success);
        const latest = matching[matching.length - 1];
        latestByStep.set(stepId, latest?.created_at as string);
      }

      let hasPreviousPending = false;
      const steps = STEP_ORDER.map((id) => {
        const completed = completedByStep.get(id) ?? false;
        const status = normalizeStatus(completed, hasPreviousPending);
        if (!completed) hasPreviousPending = true;
        return {
          id,
          title:
            id === "voice-profile"
              ? "Voice profile"
              : id === "campaign-generation"
                ? "Campaign generation"
                : id === "content-generation"
                  ? "Content generation"
                  : id === "publishing"
                    ? "Publishing"
                    : "Analytics",
          status,
          completed,
          lastEventAt: latestByStep.get(id) ?? null,
        };
      });

      return { steps };
    }),
});

