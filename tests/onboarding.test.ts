import { describe, expect, it, vi } from "vitest";
import { artistRouter } from "@/server/routers/artist";

const { sendTestEvent } = vi.hoisted(() => ({
  sendTestEvent: vi.fn().mockResolvedValue({ ids: ["evt_1"] }),
}));

vi.mock("@/lib/testing/send-test-event", () => ({
  sendTestEvent,
}));

describe("onboarding artist.create", () => {
  it("creates an artist row and emits artist.created event", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "artist-1",
        name: "Nova",
        genre: "indie",
        bio: "bio text",
        user_id: "user-1",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });

    const caller = artistRouter.createCaller({
      user: { id: "user-1" },
      supabase: { from },
    } as never);

    const result = await caller.create({
      name: "Nova",
      genre: "indie",
      spotifyUrl: "https://open.spotify.com/artist/abcd1234",
      instagramUrl: "https://instagram.com/nova",
      pastCaptions: ["line 1", "line 2"],
      artistBio: "bio text",
      interviewExcerpts: ["excerpt"],
    });

    expect(result.id).toBe("artist-1");
    expect(from).toHaveBeenCalledWith("artists");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        spotify_id: "abcd1234",
      })
    );
    expect(sendTestEvent).toHaveBeenCalledWith(
      "artist.created",
      expect.objectContaining({
        artistId: "artist-1",
        userId: "user-1",
      })
    );
  });
});

