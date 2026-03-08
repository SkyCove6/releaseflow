import { describe, expect, it, vi } from "vitest";
import { artistsRouter } from "@/server/routers/artists";

const { emitLifecycleEvent } = vi.hoisted(() => ({
  emitLifecycleEvent: vi.fn().mockResolvedValue({ ok: true, traceId: "trace" }),
}));

vi.mock("@/server/utils/events", () => ({
  emitLifecycleEvent,
}));

describe("artists router", () => {
  it("creates artist using authenticated user_id and emits artist/created", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: "artist-1", name: "Luna", genre: "indie", bio: "bio", user_id: "user-1" },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });

    const caller = artistsRouter.createCaller({
      user: { id: "user-1" },
      supabase: { from },
    } as never);

    const result = await caller.create({ name: "Luna", genre: "indie", bio: "bio" });

    expect(result.id).toBe("artist-1");
    expect(from).toHaveBeenCalledWith("artists");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        name: "Luna",
      })
    );
    expect(emitLifecycleEvent).toHaveBeenCalledWith(
      "artist/created",
      expect.objectContaining({ artistId: "artist-1", userId: "user-1" })
    );
  });
});
