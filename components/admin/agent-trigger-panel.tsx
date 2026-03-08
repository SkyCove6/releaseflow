"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, CheckCircle, XCircle } from "lucide-react";

// ─── Sample payload defaults ───────────────────────────────────────────────

const SAMPLE_VOICE_PROFILE_INPUT = {
  artistName: "Luna Veil",
  genre: "Indie Pop",
  existingBio:
    "Luna Veil is a London-based indie-pop artist known for her layered harmonies and cinematic production. Her music explores themes of stillness, memory, and quiet defiance.",
  socialPosts: [
    "sometimes silence says more than any song i could write",
    "working late. the city sounds different at 3am 🌙",
    "new era loading... can't say more yet",
    "thank you for every stream, every save, every message. this one's for you.",
    "nothing beats finishing a mix and knowing it's right",
  ],
  interviewExcerpts: [
    "I don't write to be understood immediately. I want the meaning to unfold over listens.",
    "Production is another instrument for me — every sound has to earn its place.",
  ],
  songTitles: ["Still Water", "Glass Hours", "Parallel", "After the Thaw"],
};

// ─── Result display ────────────────────────────────────────────────────────

function ResultBlock({ result }: { result: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

// ─── Voice Profiler Panel ──────────────────────────────────────────────────

export function VoiceProfilerPanel() {
  const [payload, setPayload] = useState(
    JSON.stringify(SAMPLE_VOICE_PROFILE_INPUT, null, 2)
  );
  const [artistId, setArtistId] = useState("");

  const mutation = trpc.agents.buildVoiceProfile.useMutation({
    onSuccess: () => toast.success("Voice profile built successfully"),
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  function handleRun() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      toast.error("Invalid JSON payload");
      return;
    }

    mutation.mutate({
      ...(parsed as Parameters<typeof mutation.mutate>[0]),
      artistId: artistId || undefined,
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Voice Profile Builder</CardTitle>
          <Badge variant="outline">voice-profiler</Badge>
        </div>
        <CardDescription>
          Analyses artist content to generate a reusable voice profile.
          Uses Claude Opus. Results are persisted to{" "}
          <code className="text-xs">artists.voice_profile</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="artist-id">Artist ID (optional)</Label>
          <Input
            id="artist-id"
            placeholder="uuid — if set, profile is saved to this artist"
            value={artistId}
            onChange={(e) => setArtistId(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vp-payload">Payload (JSON)</Label>
          <Textarea
            id="vp-payload"
            className="h-64 font-mono text-xs"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
          />
        </div>
        {mutation.data && <ResultBlock result={mutation.data} />}
        {mutation.error && (
          <p className="text-sm text-destructive">{mutation.error.message}</p>
        )}
      </CardContent>
      <CardFooter className="flex items-center gap-3">
        <Button
          onClick={handleRun}
          disabled={mutation.isPending}
          className="gap-2"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {mutation.isPending ? "Running…" : "Run agent"}
        </Button>
        {mutation.isSuccess && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" /> Done
          </span>
        )}
        {mutation.isError && (
          <span className="flex items-center gap-1 text-sm text-destructive">
            <XCircle className="h-4 w-4" /> Error
          </span>
        )}
      </CardFooter>
    </Card>
  );
}

// ─── Inngest Event Trigger Panel ───────────────────────────────────────────

const EVENT_BASE = {
  userId: "a0000000-0000-0000-0000-000000000001",
  actorId: "a0000000-0000-0000-0000-000000000001",
  tenantId: "a0000000-0000-0000-0000-000000000001",
} as const;

const INNGEST_EVENTS: Array<{
  label: string;
  eventName: string;
  sample: Record<string, unknown>;
}> = [
  {
    label: "artist/created → generate-voice-profile",
    eventName: "artist/created",
    sample: {
      ...EVENT_BASE,
      artistId: "a1000000-0000-0000-0000-000000000001",
      resourceId: "a1000000-0000-0000-0000-000000000001",
      idempotencyKey: "artist:created:a1000000-0000-0000-0000-000000000001",
      traceId: "trace_artist_created",
      artistName: "Luna Veil",
      genre: "Indie Pop",
      existingBio:
        "London-based indie-pop artist with cinematic production.",
      socialPosts: ["something new is coming", "late nights in the studio 🌙"],
      songTitles: ["Still Water", "Glass Hours"],
    },
  },
  {
    label: "release/created → generate-campaign",
    eventName: "release/created",
    sample: {
      ...EVENT_BASE,
      releaseId: "a2000000-0000-0000-0000-000000000001",
      artistId: "a1000000-0000-0000-0000-000000000001",
      resourceId: "a2000000-0000-0000-0000-000000000001",
      idempotencyKey: "release:created:a2000000-0000-0000-0000-000000000001",
      traceId: "trace_release_created",
      title: "Still Water",
      type: "single",
      status: "draft",
      releaseDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
    },
  },
  {
    label: "campaign/approved → generate-content",
    eventName: "campaign/approved",
    sample: {
      ...EVENT_BASE,
      campaignId: "a3000000-0000-0000-0000-000000000001",
      releaseId: "a2000000-0000-0000-0000-000000000001",
      artistId: "a1000000-0000-0000-0000-000000000001",
      resourceId: "a3000000-0000-0000-0000-000000000001",
      idempotencyKey: "campaign:approved:a3000000-0000-0000-0000-000000000001",
      traceId: "trace_campaign_approved",
      title: "Still Water",
      releaseStatus: "planned",
      genre: "Indie Pop",
      releaseType: "single",
    },
  },
  {
    label: "release/published → on-release-published",
    eventName: "release/published",
    sample: {
      ...EVENT_BASE,
      releaseId: "a2000000-0000-0000-0000-000000000001",
      artistId: "a1000000-0000-0000-0000-000000000001",
      resourceId: "a2000000-0000-0000-0000-000000000001",
      idempotencyKey: "release:published:a2000000-0000-0000-0000-000000000001",
      traceId: "trace_release_published",
      title: "Still Water",
      artistName: "Luna Veil",
      status: "active",
    },
  },
  {
    label: "analytics/report.requested → generate-analytics-report",
    eventName: "analytics/report.requested",
    sample: {
      ...EVENT_BASE,
      releaseId: "a2000000-0000-0000-0000-000000000001",
      artistId: "a1000000-0000-0000-0000-000000000001",
      resourceId: "a2000000-0000-0000-0000-000000000001",
      idempotencyKey: "analytics:requested:a2000000-0000-0000-0000-000000000001",
      traceId: "trace_analytics_sample",
      title: "Still Water",
      artistName: "Luna Veil",
      genre: "Indie Pop",
      dateRange: {
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        end:   new Date().toISOString().split("T")[0],
      },
    },
  },
  {
    label: "pitch/requested → generate-pitches",
    eventName: "pitch/requested",
    sample: {
      ...EVENT_BASE,
      releaseId: "a2000000-0000-0000-0000-000000000001",
      artistId: "a1000000-0000-0000-0000-000000000001",
      campaignId: "a3000000-0000-0000-0000-000000000001",
      resourceId: "a3000000-0000-0000-0000-000000000001",
      idempotencyKey: "pitch:requested:a3000000-0000-0000-0000-000000000001",
      traceId: "trace_pitch_requested",
      releaseTitle: "Still Water",
      genre: "Indie Pop",
      mood: ["melancholic", "cinematic"],
      artistName: "Luna Veil",
      targetPlaylistCount: 5,
    },
  },
];

export function InngestEventPanel() {
  const [selected, setSelected] = useState(0);
  const [payload, setPayload] = useState(
    JSON.stringify(INNGEST_EVENTS[0]!.sample, null, 2)
  );
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [error, setError] = useState("");

  function selectEvent(idx: number) {
    setSelected(idx);
    setPayload(JSON.stringify(INNGEST_EVENTS[idx]!.sample, null, 2));
    setStatus("idle");
  }

  async function handleSend() {
    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      toast.error("Invalid JSON payload");
      return;
    }

    setStatus("sending");
    setError("");

    try {
      const res = await fetch("/api/inngest/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: INNGEST_EVENTS[selected]!.eventName,
          data,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      setStatus("sent");
      toast.success("Event sent to Inngest");
    } catch (err) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Failed to send event: ${msg}`);
    }
  }

  const event = INNGEST_EVENTS[selected];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Inngest Event Trigger</CardTitle>
        <CardDescription>
          Fire any event directly to the Inngest dev server. Requires{" "}
          <code className="text-xs">npm run dev</code> (runs both Next.js +
          Inngest CLI).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {INNGEST_EVENTS.map((e, i) => (
            <button
              key={e.eventName}
              onClick={() => selectEvent(i)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                i === selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <Label>
            Payload for{" "}
            <code className="text-xs font-medium">{event?.eventName}</code>
          </Label>
          <Textarea
            className="h-52 font-mono text-xs"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
      <CardFooter className="flex items-center gap-3">
        <Button
          onClick={handleSend}
          disabled={status === "sending"}
          className="gap-2"
        >
          {status === "sending" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {status === "sending" ? "Sending…" : "Send event"}
        </Button>
        {status === "sent" && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" /> Sent
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
