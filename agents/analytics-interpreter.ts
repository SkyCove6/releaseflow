import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";

// =============================================================================
// Platform data schemas
// =============================================================================

export const SpotifyAnalyticsSchema = z.object({
  streams:          z.number(),
  saves:            z.number(),
  playlistAdds:     z.number(),
  listeners:        z.number(),
  /** Top source countries, e.g. { "US": 42, "GB": 18 } */
  countries:        z.record(z.string(), z.number()).optional(),
  topPlaylists:     z.array(z.object({ name: z.string(), streams: z.number() })).optional(),
  skipRate:         z.number().min(0).max(1).optional(),
});
export type SpotifyAnalytics = z.infer<typeof SpotifyAnalyticsSchema>;

export const AppleAnalyticsSchema = z.object({
  plays:            z.number(),
  listeners:        z.number(),
  shazams:          z.number().optional(),
  playlistAdds:     z.number().optional(),
});
export type AppleAnalytics = z.infer<typeof AppleAnalyticsSchema>;

export const YouTubeAnalyticsSchema = z.object({
  views:            z.number(),
  watchTimeMinutes: z.number(),
  subscribers:      z.number().optional(),
  likes:            z.number().optional(),
  comments:         z.number().optional(),
});
export type YouTubeAnalytics = z.infer<typeof YouTubeAnalyticsSchema>;

export const InstagramInsightsSchema = z.object({
  reach:            z.number(),
  impressions:      z.number(),
  likes:            z.number().optional(),
  comments:         z.number().optional(),
  shares:           z.number().optional(),
  saves:            z.number().optional(),
  profileVisits:    z.number().optional(),
  followerGrowth:   z.number().optional(),
});
export type InstagramInsights = z.infer<typeof InstagramInsightsSchema>;

export const TikTokAnalyticsSchema = z.object({
  views:            z.number(),
  likes:            z.number().optional(),
  shares:           z.number().optional(),
  comments:         z.number().optional(),
  followers:        z.number().optional(),
  videoCreations:   z.number().optional(),   // UGC count using the track
});
export type TikTokAnalytics = z.infer<typeof TikTokAnalyticsSchema>;

// =============================================================================
// Campaign plan (matches what generate-campaign.ts produces)
// =============================================================================

export const CampaignPlanSchema = z.object({
  strategy: z.object({
    approach:          z.string(),
    focus_platforms:   z.array(z.string()),
    key_message:       z.string(),
  }).optional(),
  kpi_targets: z.object({
    spotify_streams_day1: z.number().optional(),
    instagram_reach:       z.number().optional(),
    playlist_adds:         z.number().optional(),
  }).optional(),
  timeline: z.object({
    pre_release_weeks: z.number(),
    release_date:      z.string(),
  }).optional(),
});
export type CampaignPlan = z.infer<typeof CampaignPlanSchema>;

// =============================================================================
// Previous report shape (for trend comparison)
// =============================================================================

export const AnalyticsReportMetricsSchema = z.object({
  totalStreams:     z.number(),
  streamsDelta:     z.number(),       // vs prior period
  playlistAdds:     z.number(),
  saves:            z.number(),
  socialReach:      z.number(),
  engagementRate:   z.number(),       // 0–1
});

export const AnalyticsReportSchema = z.object({
  period: z.object({ start: z.string(), end: z.string() }),
  highlights:     z.array(z.string()),
  metrics:        AnalyticsReportMetricsSchema,
  platformBreakdown: z.array(z.object({
    platform: z.string(),
    metrics:  z.record(z.string(), z.unknown()),
    trend:    z.string(),
  })),
  campaignPerformance: z.array(z.object({
    kpi:            z.string(),
    target:         z.number(),
    actual:         z.number(),
    status:         z.enum(["ahead", "on-track", "behind"]),
    recommendation: z.string(),
  })),
  aiInsights:          z.array(z.string()),
  recommendedActions:  z.array(z.object({
    action:    z.string(),
    rationale: z.string(),
    priority:  z.enum(["high", "medium", "low"]),
  })),
  narrativeSummary: z.string(),
});
export type AnalyticsReport = z.infer<typeof AnalyticsReportSchema>;

// =============================================================================
// Agent input / result
// =============================================================================

export const AnalyticsInterpreterInputSchema = z.object({
  releaseId:     z.string().uuid(),
  releaseTitle:  z.string().min(1),
  artistName:    z.string().min(1),
  genre:         z.string().min(1),
  dateRange:     z.object({ start: z.string(), end: z.string() }),
  dataSources: z.object({
    spotify:   SpotifyAnalyticsSchema.nullable(),
    apple:     AppleAnalyticsSchema.nullable(),
    youtube:   YouTubeAnalyticsSchema.nullable(),
    instagram: InstagramInsightsSchema.nullable(),
    tiktok:    TikTokAnalyticsSchema.nullable(),
  }),
  previousReports: z.array(AnalyticsReportSchema).optional().default([]),
  campaignPlan:    CampaignPlanSchema.optional(),
  userId:          z.string().uuid().optional(),
});
export type AnalyticsInterpreterInput = z.infer<typeof AnalyticsInterpreterInputSchema>;

export type AnalyticsInterpreterResult =
  | {
      ok:         true;
      report:     AnalyticsReport;
      htmlReport: string;
      tokensUsed: number;
      costCents:  number;
      durationMs: number;
    }
  | { ok: false; error: string };

// =============================================================================
// Anthropic client & cost helper
// =============================================================================

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

// Sonnet: $3/$15 per M tokens (input/output)
function estimateCostCents(input: number, output: number): number {
  return Math.round((input / 1_000_000) * 300 + (output / 1_000_000) * 1500);
}

function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<{ result: T; attempts: number }> {
  return (async () => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return { result: await fn(), attempts: attempt };
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
      }
    }
    throw new Error("unreachable");
  })();
}

// =============================================================================
// Genre benchmarks (indie baseline numbers, not official data)
// =============================================================================

interface GenreBenchmark {
  weeklyStreams:     number;
  saveRate:          number;   // saves / streams
  playlistAddRate:   number;   // playlist adds / streams
  engagementRate:    number;   // avg social engagement rate
}

const GENRE_BENCHMARKS: Record<string, GenreBenchmark> = {
  "pop":          { weeklyStreams: 15000, saveRate: 0.08, playlistAddRate: 0.03, engagementRate: 0.04 },
  "indie pop":    { weeklyStreams: 8000,  saveRate: 0.10, playlistAddRate: 0.04, engagementRate: 0.05 },
  "indie":        { weeklyStreams: 7000,  saveRate: 0.10, playlistAddRate: 0.04, engagementRate: 0.05 },
  "hip-hop":      { weeklyStreams: 20000, saveRate: 0.07, playlistAddRate: 0.02, engagementRate: 0.06 },
  "rap":          { weeklyStreams: 20000, saveRate: 0.07, playlistAddRate: 0.02, engagementRate: 0.06 },
  "electronic":   { weeklyStreams: 12000, saveRate: 0.09, playlistAddRate: 0.05, engagementRate: 0.04 },
  "edm":          { weeklyStreams: 18000, saveRate: 0.07, playlistAddRate: 0.04, engagementRate: 0.04 },
  "r&b":          { weeklyStreams: 14000, saveRate: 0.09, playlistAddRate: 0.03, engagementRate: 0.05 },
  "soul":         { weeklyStreams: 9000,  saveRate: 0.11, playlistAddRate: 0.04, engagementRate: 0.05 },
  "rock":         { weeklyStreams: 10000, saveRate: 0.07, playlistAddRate: 0.03, engagementRate: 0.04 },
  "alternative":  { weeklyStreams: 9000,  saveRate: 0.09, playlistAddRate: 0.04, engagementRate: 0.05 },
  "country":      { weeklyStreams: 12000, saveRate: 0.08, playlistAddRate: 0.03, engagementRate: 0.04 },
  "jazz":         { weeklyStreams: 5000,  saveRate: 0.12, playlistAddRate: 0.06, engagementRate: 0.03 },
  "classical":    { weeklyStreams: 4000,  saveRate: 0.11, playlistAddRate: 0.07, engagementRate: 0.02 },
  "folk":         { weeklyStreams: 6000,  saveRate: 0.11, playlistAddRate: 0.05, engagementRate: 0.05 },
  "default":      { weeklyStreams: 10000, saveRate: 0.08, playlistAddRate: 0.03, engagementRate: 0.04 },
};

function getBenchmark(genre: string): GenreBenchmark {
  const key = genre.toLowerCase();
  return GENRE_BENCHMARKS[key] ?? GENRE_BENCHMARKS["default"]!;
}

// =============================================================================
// Data aggregation helpers
// =============================================================================

function aggregateMetrics(sources: AnalyticsInterpreterInput["dataSources"]): {
  totalStreams:   number;
  playlistAdds:  number;
  saves:         number;
  socialReach:   number;
  totalLikes:    number;
  totalComments: number;
  totalShares:   number;
} {
  const totalStreams  = (sources.spotify?.streams ?? 0) + (sources.apple?.plays ?? 0);
  const playlistAdds = (sources.spotify?.playlistAdds ?? 0) + (sources.apple?.playlistAdds ?? 0);
  const saves        = (sources.spotify?.saves ?? 0) + (sources.instagram?.saves ?? 0);
  const socialReach  = (sources.instagram?.reach ?? 0) + (sources.tiktok?.views ?? 0) + (sources.youtube?.views ?? 0);
  const totalLikes   = (sources.instagram?.likes ?? 0) + (sources.tiktok?.likes ?? 0) + (sources.youtube?.likes ?? 0);
  const totalComments = (sources.instagram?.comments ?? 0) + (sources.tiktok?.comments ?? 0) + (sources.youtube?.comments ?? 0);
  const totalShares  = (sources.instagram?.shares ?? 0) + (sources.tiktok?.shares ?? 0);

  return { totalStreams, playlistAdds, saves, socialReach, totalLikes, totalComments, totalShares };
}

function computeEngagementRate(
  sources: AnalyticsInterpreterInput["dataSources"],
  agg: ReturnType<typeof aggregateMetrics>
): number {
  if (agg.socialReach === 0) return 0;
  const engagements = agg.totalLikes + agg.totalComments + agg.totalShares;
  return Math.round((engagements / agg.socialReach) * 10000) / 10000;
}

function buildPlatformSummary(sources: AnalyticsInterpreterInput["dataSources"]): string {
  const lines: string[] = [];

  if (sources.spotify) {
    const s = sources.spotify;
    lines.push(`SPOTIFY: ${s.streams.toLocaleString()} streams, ${s.listeners.toLocaleString()} listeners, ${s.saves} saves, ${s.playlistAdds} playlist adds${s.skipRate !== undefined ? `, skip rate ${(s.skipRate * 100).toFixed(1)}%` : ""}`);
    if (s.topPlaylists?.length) {
      lines.push(`  Top playlists: ${s.topPlaylists.slice(0, 3).map((p) => `"${p.name}" (${p.streams.toLocaleString()} streams)`).join(", ")}`);
    }
    if (s.countries && Object.keys(s.countries).length) {
      const top = Object.entries(s.countries).sort((a, b) => b[1] - a[1]).slice(0, 3);
      lines.push(`  Top countries: ${top.map(([c, n]) => `${c} ${n}%`).join(", ")}`);
    }
  }

  if (sources.apple) {
    const a = sources.apple;
    lines.push(`APPLE MUSIC: ${a.plays.toLocaleString()} plays, ${a.listeners.toLocaleString()} listeners${a.shazams ? `, ${a.shazams} Shazams` : ""}${a.playlistAdds ? `, ${a.playlistAdds} playlist adds` : ""}`);
  }

  if (sources.youtube) {
    const y = sources.youtube;
    lines.push(`YOUTUBE: ${y.views.toLocaleString()} views, ${y.watchTimeMinutes.toLocaleString()} watch-minutes${y.likes ? `, ${y.likes} likes` : ""}${y.comments ? `, ${y.comments} comments` : ""}`);
  }

  if (sources.instagram) {
    const i = sources.instagram;
    lines.push(`INSTAGRAM: ${i.reach.toLocaleString()} reach, ${i.impressions.toLocaleString()} impressions${i.likes ? `, ${i.likes} likes` : ""}${i.saves ? `, ${i.saves} saves` : ""}${i.followerGrowth !== undefined ? `, ${i.followerGrowth > 0 ? "+" : ""}${i.followerGrowth} followers` : ""}`);
  }

  if (sources.tiktok) {
    const t = sources.tiktok;
    lines.push(`TIKTOK: ${t.views.toLocaleString()} views${t.likes ? `, ${t.likes} likes` : ""}${t.shares ? `, ${t.shares} shares` : ""}${t.videoCreations ? `, ${t.videoCreations} UGC videos` : ""}`);
  }

  return lines.length ? lines.join("\n") : "No platform data available for this period.";
}

function buildPreviousComparison(
  previous: AnalyticsReport[],
  currentStreams: number
): string {
  if (!previous.length) return "No previous reports available for comparison.";

  const recent = previous[0]!;
  const streamsDelta = currentStreams - recent.metrics.totalStreams;
  const pct = recent.metrics.totalStreams > 0
    ? ((streamsDelta / recent.metrics.totalStreams) * 100).toFixed(1)
    : "N/A";

  return `Previous period streams: ${recent.metrics.totalStreams.toLocaleString()} → current: ${currentStreams.toLocaleString()} (${streamsDelta >= 0 ? "+" : ""}${pct}%). Previous highlights: ${recent.highlights.slice(0, 2).join("; ")}.`;
}

function buildKpiContext(
  plan: CampaignPlan | undefined,
  agg: ReturnType<typeof aggregateMetrics>
): string {
  if (!plan?.kpi_targets) return "No campaign KPI targets defined.";
  const kpis = plan.kpi_targets;
  const lines: string[] = [];

  if (kpis.spotify_streams_day1 !== undefined)
    lines.push(`Spotify day-1 target: ${kpis.spotify_streams_day1.toLocaleString()} (actual total period: ${agg.totalStreams.toLocaleString()})`);
  if (kpis.instagram_reach !== undefined)
    lines.push(`Instagram reach target: ${kpis.instagram_reach.toLocaleString()} (actual: ${agg.socialReach.toLocaleString()})`);
  if (kpis.playlist_adds !== undefined)
    lines.push(`Playlist adds target: ${kpis.playlist_adds} (actual: ${agg.playlistAdds})`);

  return lines.join("\n");
}

// =============================================================================
// HTML email report builder
// =============================================================================

function buildHtmlReport(
  report: AnalyticsReport,
  releaseTitle: string,
  artistName: string
): string {
  const statusBadge = (status: "ahead" | "on-track" | "behind") => {
    const colors = { ahead: "#16a34a", "on-track": "#2563eb", behind: "#dc2626" };
    return `<span style="background:${colors[status]};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${status.toUpperCase()}</span>`;
  };

  const priorityBadge = (p: "high" | "medium" | "low") => {
    const colors = { high: "#dc2626", medium: "#d97706", low: "#6b7280" };
    return `<span style="color:${colors[p]};font-weight:700;font-size:11px;">[${p.toUpperCase()}]</span>`;
  };

  const platformRows = report.platformBreakdown
    .map(
      (p) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-weight:600;text-transform:capitalize;">${p.platform}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:12px;">${Object.entries(p.metrics).map(([k, v]) => `${k}: ${v}`).join(" · ")}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:12px;">${p.trend}</td>
      </tr>`
    )
    .join("");

  const kpiRows = report.campaignPerformance
    .map(
      (k) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${k.kpi}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-family:monospace;">${k.target.toLocaleString()}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-family:monospace;">${k.actual.toLocaleString()}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${statusBadge(k.status)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:12px;">${k.recommendation}</td>
      </tr>`
    )
    .join("");

  const actionsList = report.recommendedActions
    .map(
      (a) => `
      <li style="margin-bottom:10px;">
        ${priorityBadge(a.priority)}
        <strong style="margin-left:6px;">${a.action}</strong>
        <br/><span style="color:#6b7280;font-size:13px;margin-left:42px;">${a.rationale}</span>
      </li>`
    )
    .join("");

  const insightsList = report.aiInsights
    .map((i) => `<li style="margin-bottom:8px;color:#374151;">${i}</li>`)
    .join("");

  const highlightsList = report.highlights
    .map((h) => `<li style="margin-bottom:6px;font-weight:500;">${h}</li>`)
    .join("");

  const m = report.metrics;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><title>Analytics Report — ${releaseTitle}</title></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 40px;">
          <p style="margin:0 0 4px;color:#a5b4fc;font-size:12px;text-transform:uppercase;letter-spacing:1px;">ReleaseFlow Analytics Report</p>
          <h1 style="margin:0 0 4px;color:#fff;font-size:22px;">${releaseTitle}</h1>
          <p style="margin:0;color:#94a3b8;font-size:13px;">${artistName} · ${report.period.start} → ${report.period.end}</p>
        </td></tr>

        <!-- Highlights -->
        <tr><td style="padding:28px 40px 0;">
          <h2 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Key Highlights</h2>
          <ul style="margin:0;padding-left:18px;">${highlightsList}</ul>
        </td></tr>

        <!-- Metric tiles -->
        <tr><td style="padding:24px 40px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${[
                ["Total Streams", m.totalStreams.toLocaleString()],
                ["Playlist Adds", m.playlistAdds.toLocaleString()],
                ["Saves", m.saves.toLocaleString()],
                ["Social Reach", m.socialReach.toLocaleString()],
                ["Engagement", `${(m.engagementRate * 100).toFixed(1)}%`],
                ["Stream Δ", `${m.streamsDelta >= 0 ? "+" : ""}${m.streamsDelta.toLocaleString()}`],
              ].map(([label, value]) => `
              <td style="text-align:center;background:#f8fafc;border-radius:8px;padding:14px 8px;margin:4px;">
                <p style="margin:0 0 2px;font-size:20px;font-weight:700;color:#111827;">${value}</p>
                <p style="margin:0;font-size:11px;color:#6b7280;">${label}</p>
              </td>`).join("")}
            </tr>
          </table>
        </td></tr>

        <!-- Platform breakdown -->
        <tr><td style="padding:0 40px 24px;">
          <h2 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Platform Breakdown</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <tr style="background:#f9fafb;">
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">Platform</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">Metrics</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">Trend</th>
            </tr>
            ${platformRows}
          </table>
        </td></tr>

        <!-- Campaign KPIs -->
        ${report.campaignPerformance.length ? `
        <tr><td style="padding:0 40px 24px;">
          <h2 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Campaign KPI Performance</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <tr style="background:#f9fafb;">
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">KPI</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">Target</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">Actual</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">Status</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">Recommendation</th>
            </tr>
            ${kpiRows}
          </table>
        </td></tr>` : ""}

        <!-- AI Insights -->
        <tr><td style="padding:0 40px 24px;">
          <h2 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">AI Insights</h2>
          <ul style="margin:0;padding-left:18px;">${insightsList}</ul>
        </td></tr>

        <!-- Recommended actions -->
        <tr><td style="padding:0 40px 24px;">
          <h2 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Recommended Actions</h2>
          <ul style="margin:0;padding-left:0;list-style:none;">${actionsList}</ul>
        </td></tr>

        <!-- Narrative summary -->
        <tr><td style="padding:0 40px 32px;">
          <h2 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Summary</h2>
          <div style="background:#f8fafc;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;padding:16px 20px;">
            ${report.narrativeSummary.split("\n\n").map((p) => `<p style="margin:0 0 12px;line-height:1.6;color:#374151;">${p}</p>`).join("").replace(/<p([^>]*)>([^<]*)<\/p>$/, "<p$1 style=\"margin:0;line-height:1.6;color:#374151;\">$2</p>")}
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">Generated by ReleaseFlow · <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://releaseflow.app"}/analytics" style="color:#6366f1;text-decoration:none;">View full dashboard</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// =============================================================================
// System prompt
// =============================================================================

const ANALYTICS_SYSTEM_PROMPT = `You are an expert music marketing analyst for independent artists and labels.
You interpret streaming and social media data and produce clear, actionable analytics reports.

RULES:
1. Be specific and data-driven — reference actual numbers, not vague statements.
2. Compare metrics to genre benchmarks where provided.
3. Identify patterns across platforms (e.g., TikTok virality → Spotify spike).
4. Keep insights concise but meaningful — no filler phrases.
5. Recommended actions must be immediately actionable (this week).
6. The narrative summary should be 2 paragraphs: performance overview first, then outlook and actions.
7. Return ONLY a valid JSON object matching the schema — no markdown, no commentary.

JSON schema:
{
  "period":            { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "highlights":        ["string", "string", "string"],
  "metrics": {
    "totalStreams":     number,
    "streamsDelta":     number,
    "playlistAdds":     number,
    "saves":            number,
    "socialReach":      number,
    "engagementRate":   number
  },
  "platformBreakdown": [
    { "platform": "string", "metrics": { "key": "value" }, "trend": "string" }
  ],
  "campaignPerformance": [
    { "kpi": "string", "target": number, "actual": number, "status": "ahead|on-track|behind", "recommendation": "string" }
  ],
  "aiInsights":         ["string"],
  "recommendedActions": [
    { "action": "string", "rationale": "string", "priority": "high|medium|low" }
  ],
  "narrativeSummary":   "string"
}`;

// =============================================================================
// Main agent function
// =============================================================================

export async function interpretAnalytics(
  rawInput: AnalyticsInterpreterInput,
  options: { skipRunLogging?: boolean } = {}
): Promise<AnalyticsInterpreterResult> {
  const input = AnalyticsInterpreterInputSchema.parse(rawInput);
  const startMs = Date.now();

  const agg = aggregateMetrics(input.dataSources);
  const engagementRate = computeEngagementRate(input.dataSources, agg);
  const benchmark = getBenchmark(input.genre);

  // ─── Build LLM user message ───────────────────────────────────────────────

  const userMessage = `=== RELEASE ===
Title: "${input.releaseTitle}"
Artist: ${input.artistName}
Genre: ${input.genre}
Report period: ${input.dateRange.start} → ${input.dateRange.end}

=== AGGREGATED TOTALS ===
Total streams (Spotify + Apple): ${agg.totalStreams.toLocaleString()}
Playlist adds: ${agg.playlistAdds}
Saves: ${agg.saves}
Total social reach: ${agg.socialReach.toLocaleString()}
Engagement rate: ${(engagementRate * 100).toFixed(2)}%

=== PLATFORM DATA ===
${buildPlatformSummary(input.dataSources)}

=== GENRE BENCHMARKS (${input.genre}) ===
Expected weekly streams for emerging artist: ~${benchmark.weeklyStreams.toLocaleString()}
Typical save rate: ${(benchmark.saveRate * 100).toFixed(1)}%
Typical playlist add rate: ${(benchmark.playlistAddRate * 100).toFixed(1)}%
Typical social engagement rate: ${(benchmark.engagementRate * 100).toFixed(1)}%

=== PERIOD-OVER-PERIOD COMPARISON ===
${buildPreviousComparison(input.previousReports, agg.totalStreams)}

=== CAMPAIGN KPI TARGETS ===
${buildKpiContext(input.campaignPlan, agg)}

=== INSTRUCTIONS ===
Analyse the data above. Calculate streamsDelta vs previous period (0 if no previous data).
Evaluate each KPI against targets. Generate 3 actionable insights. Produce 3–5 recommended actions sorted by priority.
Write a 2-paragraph narrative summary. Return valid JSON only.`;

  // ─── Call Claude Sonnet ───────────────────────────────────────────────────

  type LLMResult = { text: string; inputTokens: number; outputTokens: number };

  let llmResult: LLMResult;
  try {
    const { result } = await withRetry<LLMResult>(async () => {
      const response = await getAnthropicClient().messages.create({
        model:      "claude-sonnet-4-5",
        max_tokens: 4096,
        stream:     false,
        system:     ANALYTICS_SYSTEM_PROMPT,
        messages:   [{ role: "user", content: userMessage }],
      });

      const block = response.content[0];
      if (!block || block.type !== "text") throw new Error("No text in LLM response");

      return {
        text:         block.text,
        inputTokens:  response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    });
    llmResult = result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // ─── Parse LLM response ───────────────────────────────────────────────────

  let report: AnalyticsReport;
  try {
    const raw = llmResult.text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(raw) as unknown;
    report = AnalyticsReportSchema.parse(parsed);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse LLM response: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ─── Generate HTML report ─────────────────────────────────────────────────

  const htmlReport = buildHtmlReport(report, input.releaseTitle, input.artistName);

  const tokensUsed = llmResult.inputTokens + llmResult.outputTokens;
  const costCents  = estimateCostCents(llmResult.inputTokens, llmResult.outputTokens);
  const durationMs = Date.now() - startMs;

  // ─── Persist snapshot + agent run ────────────────────────────────────────

  if (input.releaseId && input.userId) {
    await persistAnalyticsSnapshot(input);
    if (!options.skipRunLogging) {
      await logAgentRun(input.userId, input.releaseId, input, report, tokensUsed, costCents, durationMs);
    }
  }

  return { ok: true, report, htmlReport, tokensUsed, costCents, durationMs };
}

// =============================================================================
// DB helpers
// =============================================================================

async function persistAnalyticsSnapshot(input: AnalyticsInterpreterInput): Promise<void> {
  try {
    const supabase = supabaseAdmin;

    // Upsert one snapshot per source per day for the end date of the period
    const snapshotDate = input.dateRange.end;
    const upserts = [];

    const sourcePairs: Array<[string, unknown]> = [
      ["spotify",   input.dataSources.spotify],
      ["apple",     input.dataSources.apple],
      ["youtube",   input.dataSources.youtube],
      ["instagram", input.dataSources.instagram],
      ["tiktok",    input.dataSources.tiktok],
    ];

    for (const [source, data] of sourcePairs) {
      if (data) {
        upserts.push({
          release_id:    input.releaseId,
          source,
          data,
          snapshot_date: snapshotDate,
        });
      }
    }

    if (upserts.length) {
      await supabase
        .from("analytics_snapshots")
        .upsert(upserts, { onConflict: "release_id,source,snapshot_date" });
    }

    // Store full report in a dedicated snapshot with source "ai_report"
    // We use the existing data column to store the report JSON.
    // Note: "ai_report" is not in the enum — store the serialised report in
    // the "spotify" snapshot's data as a merged object, or store via agent_runs.output.
    // For now, we persist raw source data and let agent_runs.output hold the full report.
  } catch (err) {
    console.warn("[analytics-interpreter] Failed to persist snapshot:", err);
  }
}

async function logAgentRun(
  userId: string,
  releaseId: string,
  input: AnalyticsInterpreterInput,
  report: AnalyticsReport,
  tokensUsed: number,
  costCents: number,
  durationMs: number
): Promise<void> {
  try {
    const supabase = supabaseAdmin;
    await supabase.from("agent_runs").insert({
      user_id:    userId,
      agent_name: "analytics-interpreter",
      input:      { releaseId, dateRange: input.dateRange, genre: input.genre },
      output:     { report, highlights: report.highlights },
      tokens_used: tokensUsed,
      cost_cents:  costCents,
      duration_ms: durationMs,
      status:      "completed",
      error:       null,
    });
  } catch (err) {
    console.warn("[analytics-interpreter] Failed to log agent run:", err);
  }
}
