import { describe, expect, it, vi } from "vitest";
import { planRouter } from "@/server/routers/plan";

const { emitLifecycleEvent } = vi.hoisted(() => ({
  emitLifecycleEvent: vi.fn().mockResolvedValue({ ok: true, traceId: "trace" }),
}));

vi.mock("@/server/utils/events", () => ({
  emitLifecycleEvent,
}));

vi.mock("@/lib/plan-limits", () => ({
  checkReleaseLimit: vi.fn(),
  getPlanContext: vi.fn().mockResolvedValue({
    planId: "starter",
    limits: { releasesPerMonth: 5 },
  }),
}));

describe("campaign approval workflow", () => {
  it("emits campaign/approved and pitch/requested", async () => {
    const campaignId = "00000000-0000-4000-8000-000000000333";
    const releaseId = "00000000-0000-4000-8000-000000000444";
    const artistId = "00000000-0000-4000-8000-000000000555";
    const campaignRow = {
      id: campaignId,
      release_id: releaseId,
      releases: {
        id: releaseId,
        title: "Single",
        type: "single",
        status: "planned",
        artists: { id: artistId, name: "Nova", genre: "pop", user_id: "user-1" },
      },
    };

    const from = vi.fn((table: string) => {
      if (table === "campaigns") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: campaignRow, error: null })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const caller = planRouter.createCaller({
      user: { id: "user-1" },
      supabase: { from },
    } as never);

    const result = await caller.approveCampaign({ campaignId });

    expect(result.ok).toBe(true);
    expect(emitLifecycleEvent).toHaveBeenCalledWith(
      "campaign/approved",
      expect.objectContaining({ campaignId, releaseId })
    );
    expect(emitLifecycleEvent).toHaveBeenCalledWith(
      "pitch/requested",
      expect.objectContaining({ campaignId, releaseId })
    );
  });
});
