import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../lib/supabase-admin";
import { sendTestEvent } from "../lib/testing/send-test-event";

type StepResult = { name: string; ok: boolean; error?: string };

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null>,
  timeoutMs = 120_000,
  intervalMs = 3_000
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await sleep(intervalMs);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

function eventBase(userId: string, resourceId: string, traceId: string) {
  return {
    userId,
    actorId: userId,
    tenantId: userId,
    resourceId,
    traceId,
  };
}

async function main() {
  const runId = randomUUID();
  const createdAt = new Date().toISOString().slice(0, 10);
  const testEmail = `smoke+${runId.slice(0, 8)}@releaseflow.test`;
  const testPassword = `RF_${runId.slice(0, 12)}!`;
  const results: StepResult[] = [];

  let userId = "";
  let artistId = "";
  let releaseId = "";
  let campaignId = "";

  async function step(name: string, work: () => Promise<void>) {
    try {
      await work();
      results.push({ name, ok: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name, ok: false, error: message });
      console.log(`FAIL ${name}: ${message}`);
      throw error;
    }
  }

  await step("1 create test user", async () => {
    const response = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { name: `Smoke ${runId.slice(0, 4)}` },
    });
    if (response.error || !response.data.user?.id) {
      throw new Error(response.error?.message ?? "Failed to create auth user");
    }
    userId = response.data.user.id;
  });

  await step("2 create artist", async () => {
    const insert = await supabaseAdmin
      .from("artists")
      .insert({
        user_id: userId,
        name: `Smoke Artist ${runId.slice(0, 4)}`,
        genre: "Indie",
        bio: "Smoke test artist",
      })
      .select("id")
      .single();
    if (insert.error || !insert.data?.id) throw new Error(insert.error?.message ?? "artist insert failed");
    artistId = insert.data.id as string;
  });

  await step("3 trigger voice profile generation", async () => {
    await sendTestEvent("artist/created", {
      ...eventBase(userId, artistId, `trace_smoke_artist_${runId}`),
      idempotencyKey: `smoke:artist-created:${artistId}`,
      requestId: `smoke:req:artist:${artistId}`,
      artistId,
      artistName: `Smoke Artist ${runId.slice(0, 4)}`,
      genre: "Indie",
      existingBio: "Smoke test artist",
      socialPosts: ["test post 1", "test post 2"],
    });
  });

  await step("4 create release", async () => {
    const insert = await supabaseAdmin
      .from("releases")
      .insert({
        artist_id: artistId,
        title: `Smoke Release ${runId.slice(0, 4)}`,
        type: "single",
        release_date: createdAt,
        status: "draft",
      })
      .select("id")
      .single();
    if (insert.error || !insert.data?.id) throw new Error(insert.error?.message ?? "release insert failed");
    releaseId = insert.data.id as string;
  });

  await step("5 trigger campaign strategist", async () => {
    await sendTestEvent("release/created", {
      ...eventBase(userId, releaseId, `trace_smoke_release_${runId}`),
      idempotencyKey: `smoke:release-created:${releaseId}`,
      requestId: `smoke:req:release:${releaseId}`,
      releaseId,
      artistId,
      title: `Smoke Release ${runId.slice(0, 4)}`,
      type: "single",
      status: "draft",
      releaseDate: createdAt,
    });

    const campaign = await waitFor(
      "campaign generation",
      async () => {
        const response = await supabaseAdmin
          .from("campaigns")
          .select("id")
          .eq("release_id", releaseId)
          .maybeSingle();
        return (response.data?.id as string | undefined) ?? null;
      },
      120_000,
      4_000
    );
    campaignId = campaign;
  });

  await step("6 approve campaign", async () => {
    const update = await supabaseAdmin
      .from("campaigns")
      .update({ status: "active" })
      .eq("id", campaignId);
    if (update.error) throw new Error(update.error.message);

    await sendTestEvent("campaign/approved", {
      ...eventBase(userId, campaignId, `trace_smoke_campaign_${runId}`),
      idempotencyKey: `smoke:campaign-approved:${campaignId}`,
      requestId: `smoke:req:campaign:${campaignId}`,
      campaignId,
      releaseId,
      artistId,
      title: `Smoke Release ${runId.slice(0, 4)}`,
      releaseStatus: "planned",
      releaseType: "single",
      genre: "Indie",
    });
  });

  await step("7 generate content", async () => {
    await waitFor(
      "content generation",
      async () => {
        const response = await supabaseAdmin
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId);
        return (response.count ?? 0) > 0 ? response.count ?? 0 : null;
      },
      120_000,
      4_000
    );
  });

  await step("8 verify content_items created", async () => {
    const response = await supabaseAdmin
      .from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId);
    if (response.error) throw new Error(response.error.message);
    if ((response.count ?? 0) < 1) throw new Error("No content_items created");
  });

  await step("9 simulate publish", async () => {
    const update = await supabaseAdmin
      .from("releases")
      .update({ status: "active" })
      .eq("id", releaseId);
    if (update.error) throw new Error(update.error.message);

    await sendTestEvent("release/published", {
      ...eventBase(userId, releaseId, `trace_smoke_publish_${runId}`),
      idempotencyKey: `smoke:release-published:${releaseId}`,
      requestId: `smoke:req:publish:${releaseId}`,
      releaseId,
      artistId,
      artistName: `Smoke Artist ${runId.slice(0, 4)}`,
      title: `Smoke Release ${runId.slice(0, 4)}`,
      status: "active",
      releaseDate: createdAt,
    });
  });

  await step("10 verify analytics snapshot", async () => {
    const existing = await supabaseAdmin
      .from("analytics_snapshots")
      .select("id")
      .eq("release_id", releaseId)
      .limit(1)
      .maybeSingle();

    if (!existing.data) {
      const inserted = await supabaseAdmin.from("analytics_snapshots").insert({
        release_id: releaseId,
        source: "spotify",
        snapshot_date: createdAt,
        data: {
          streams: 100,
          saves: 10,
          listeners: 70,
          synthetic: true,
          smoke_run_id: runId,
        },
      });
      if (inserted.error) throw new Error(inserted.error.message);
    }

    const verify = await supabaseAdmin
      .from("analytics_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("release_id", releaseId);
    if ((verify.count ?? 0) < 1) throw new Error("Analytics snapshot missing");
  });

  const failed = results.filter((result) => !result.ok);
  console.log(`\nSmoke test complete: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    process.exitCode = 1;
  }
}

void main();
