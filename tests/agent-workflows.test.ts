import { createServer } from "node:http";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentWithResilience } from "@/lib/agents/resilient-runner";
import { sendTestEvent } from "@/lib/testing/send-test-event";

const { sendMock, getUserMock, insertMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getUserMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: sendMock,
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: getUserMock,
    },
  }),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: insertMock,
    }),
  },
}));

describe("agent reliability and trigger endpoint", () => {
  beforeEach(() => {
    sendMock.mockReset();
    getUserMock.mockReset();
    insertMock.mockReset();
    process.env.NODE_ENV = "development";
    process.env.ADMIN_USER_IDS = "admin-1";
  });

  it("retries agent execution and logs completed run", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        value: { message: "ok" },
        output: { message: "ok" },
        tokensUsed: 120,
        costCents: 4,
      });

    const result = await runAgentWithResilience(
      {
        agentName: "content-writer",
        userId: "user-1",
        input: { campaignId: "campaign-1" },
        traceId: "trace-1",
      },
      execute
    );

    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("accepts allowed admin trigger events via HTTP", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    sendMock.mockResolvedValue({ ids: ["evt_1"] });
    const { POST } = await import("@/app/api/inngest/trigger/route");

    const server = createServer(async (req, res) => {
      if (!req.url || req.method !== "POST") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString("utf8");

      const response = await POST(
        new Request("http://localhost/api/inngest/trigger", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        })
      );

      const text = await response.text();
      res.statusCode = response.status;
      res.setHeader("content-type", response.headers.get("content-type") ?? "application/json");
      res.end(text);
    });

    const response = await request(server)
      .post("/api/inngest/trigger")
      .send({
        name: "release/created",
        data: {
          userId: "user-1",
          actorId: "user-1",
          tenantId: "user-1",
          resourceId: "release-1",
          idempotencyKey: "test",
          traceId: "trace",
        },
      });

    server.close();

    expect(response.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("maps dotted event names to canonical inngest names", async () => {
    sendMock.mockResolvedValue({ ids: ["evt_2"] });

    await sendTestEvent("release.created", {
      userId: "user-1",
      actorId: "user-1",
      tenantId: "user-1",
      resourceId: "release-1",
      idempotencyKey: "release:created:release-1",
      traceId: "trace-1",
      releaseId: "release-1",
      artistId: "artist-1",
      title: "Song",
      type: "single",
      status: "draft",
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "release/created",
      })
    );
  });
});
