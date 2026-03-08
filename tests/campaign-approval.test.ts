import { describe, expect, it, vi } from "vitest";
import { campaignRouter } from "@/server/routers/campaign";

const { sendTestEvent } = vi.hoisted(() => ({
  sendTestEvent: vi.fn().mockResolvedValue({ ids: ["evt_2"] }),
}));

vi.mock("@/lib/testing/send-test-event", () => ({
  sendTestEvent,
}));

describe("campaign.approve route", () => {
  it("marks campaign active and emits campaign.approved event", async () => {
    const campaignRow = {
      id: "campaign-1",
      release_id: "release-1",
      status: "draft",
      releases: {
        id: "release-1",
        title: "Song",
        type: "single",
        status: "planned",
        artists: { id: "artist-1", name: "Artist", genre: "indie", user_id: "user-1" },
      },
    };

    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const single = vi.fn().mockResolvedValue({ data: campaignRow, error: null });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select, update });

    const caller = campaignRouter.createCaller({
      user: { id: "user-1" },
      supabase: { from },
    } as never);

    const result = await caller.approve({ campaignId: "11111111-1111-1111-8111-111111111111" });

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ status: "active" });
    expect(sendTestEvent).toHaveBeenCalledWith(
      "campaign.approved",
      expect.objectContaining({
        campaignId: "11111111-1111-1111-8111-111111111111",
        releaseId: "release-1",
      })
    );
  });
});

