import { describe, expect, it, vi } from "vitest";
import { releasesRouter } from "@/server/routers/releases";

const { emitLifecycleEvent } = vi.hoisted(() => ({
  emitLifecycleEvent: vi.fn().mockResolvedValue({ ok: true, traceId: "trace" }),
}));

vi.mock("@/server/utils/events", () => ({
  emitLifecycleEvent,
}));

describe("releases router", () => {
  it("allows canonical transition sequence and emits publish event on active", async () => {
    const releaseId = "00000000-0000-4000-8000-000000000111";
    let status: "draft" | "planned" | "active" | "completed" = "draft";

    const releasesTable = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: {
              id: releaseId,
              status,
              title: "Song",
              type: "single",
              artist_id: "00000000-0000-4000-8000-000000000222",
              artists: { name: "Artist", user_id: "user-1" },
            },
            error: null,
          })),
        })),
      })),
      update: vi.fn((payload: { status: typeof status }) => {
        status = payload.status;
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: releaseId, title: "Song", release_date: "2026-01-01" },
                error: null,
              })),
            })),
          })),
        };
      }),
    };

    const from = vi.fn((table: string) => {
      if (table === "releases") return releasesTable;
      throw new Error(`Unexpected table ${table}`);
    });

    const caller = releasesRouter.createCaller({
      user: { id: "user-1" },
      supabase: { from },
    } as never);

    await caller.updateStatus({ id: releaseId, status: "planned" });
    expect(status).toBe("planned");

    await caller.updateStatus({ id: releaseId, status: "active" });
    expect(status).toBe("active");

    await caller.updateStatus({ id: releaseId, status: "completed" });
    expect(status).toBe("completed");

    expect(emitLifecycleEvent).toHaveBeenCalledWith(
      "release/published",
      expect.objectContaining({ releaseId, status: "active" })
    );
  });
});
