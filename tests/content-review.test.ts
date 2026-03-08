import { describe, expect, it, vi } from "vitest";
import { contentRouter } from "@/server/routers/content";

const { sendTestEvent } = vi.hoisted(() => ({
  sendTestEvent: vi.fn().mockResolvedValue({ ids: ["evt_3"] }),
}));

vi.mock("@/lib/testing/send-test-event", () => ({
  sendTestEvent,
}));

describe("content review routes", () => {
  it("approves content and updates DB status", async () => {
    const row = {
      id: "content-1",
      status: "draft",
      platform: "instagram",
      content_type: "post",
      body: "Body",
      campaigns: {
        id: "campaign-1",
        release_id: "release-1",
        releases: {
          id: "release-1",
          title: "Song",
          artist_id: "artist-1",
          artists: { id: "artist-1", name: "Artist", user_id: "user-1" },
        },
      },
    };

    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const single = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select, update });

    const caller = contentRouter.createCaller({
      user: { id: "user-1" },
      supabase: { from },
    } as never);

    const result = await caller.approve({ contentId: "00000000-0000-4000-8000-000000000001" });
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "approved" }));
    expect(sendTestEvent).toHaveBeenCalledWith(
      "content.approved",
      expect.objectContaining({
        contentId: "00000000-0000-4000-8000-000000000001",
      })
    );
  });

  it("rejects content and updates DB status", async () => {
    const row = {
      id: "content-2",
      status: "draft",
      platform: "instagram",
      content_type: "post",
      variants: {},
      campaigns: {
        id: "campaign-1",
        release_id: "release-1",
        releases: {
          id: "release-1",
          artist_id: "artist-1",
          artists: { id: "artist-1", user_id: "user-1" },
        },
      },
    };

    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const single = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select, update });

    const caller = contentRouter.createCaller({
      user: { id: "user-1" },
      supabase: { from },
    } as never);

    const result = await caller.reject({
      contentId: "00000000-0000-4000-8000-000000000002",
      reason: "Not aligned to voice",
    });
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(sendTestEvent).toHaveBeenCalledWith(
      "content.rejected",
      expect.objectContaining({
        contentId: "00000000-0000-4000-8000-000000000002",
      })
    );
  });
});

