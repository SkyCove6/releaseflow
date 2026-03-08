import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendTestEvent } from "@/lib/testing/send-test-event";

export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = [
  "artist/created",
  "release/created",
  "campaign/approved",
  "pitch/requested",
  "release/published",
  "user/signed-up",
  "analytics/report.requested",
] as const;

function assertAdmin(userId: string) {
  const adminIds = (process.env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim());
  return adminIds.includes(userId);
}

const bodySchema = z.object({
  name: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request) {
  const adminTriggerEnabled =
    process.env.NODE_ENV === "development" ||
    process.env.ENABLE_ADMIN_EVENT_TRIGGER === "true";

  if (!adminTriggerEnabled) {
    return NextResponse.json({ error: "Admin event trigger is disabled" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!assertAdmin(user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!ALLOWED_EVENTS.includes(parsed.data.name as (typeof ALLOWED_EVENTS)[number])) {
    return NextResponse.json({ error: "Event not allowed in admin trigger" }, { status: 400 });
  }

  try {
    const result = await sendTestEvent(
      parsed.data.name as (typeof ALLOWED_EVENTS)[number],
      parsed.data.data
    );
    return NextResponse.json({ ok: true, ids: result.ids ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
