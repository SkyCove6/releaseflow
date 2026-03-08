/**
 * Release Agent
 *
 * Generates a deterministic 6-week rollout plan for a music release.
 * The output is intentionally structured (tasks + owners + acceptance) so it
 * can be executed downstream by the rollout automation chain.
 */

export interface PlanTask {
  day: number;
  title: string;
  owner: "artist" | "label" | "distribution" | "marketing";
  category: "pre-release" | "creative" | "content" | "distribution" | "analytics";
  effort: "low" | "medium" | "high";
  acceptanceCriteria: string[];
  artifacts: string[];
}

export interface ReleaseAgentInput {
  releaseId: string;
  releaseTitle: string;
  releaseType: "single" | "ep" | "album";
  releaseDate?: string;
  artistName: string;
  genre: string;
  description?: string;
}

export interface ReleasePlan {
  releaseId: string;
  releaseTitle: string;
  rolloutWeeks: 6;
  releaseDate: string;
  tasks: PlanTask[];
  artifacts: string[];
  owners: Array<{
    role: PlanTask["owner"];
    ownerName: string;
  }>;
  acceptanceChecklist: string[];
  immutableVersion: string;
  generatedAt: string;
}

const ARTIFACT_SET = [
  "Cover art package",
  "Metadata pack",
  "Playlist target list",
  "Content brief",
  "Posting calendar",
  "Analytics scorecard",
];

const BASELINE_TASKS: Omit<PlanTask, "day">[] = [
  {
    title: "Validate release metadata",
    owner: "distribution",
    category: "pre-release",
    effort: "low",
    acceptanceCriteria: [
      "Title, artist, release date, and UPC/ISRC references are captured",
      "Cover and credit metadata are normalized",
    ],
    artifacts: ["Metadata pack", "Artist profile snapshot"],
  },
  {
    title: "Finalize audience positioning",
    owner: "marketing",
    category: "pre-release",
    effort: "medium",
    acceptanceCriteria: [
      "Target audience segments are defined",
      "Tone-of-voice and call-to-action are approved",
    ],
    artifacts: ["Audience matrix", "Voice brief"],
  },
  {
    title: "Draft campaign content templates",
    owner: "marketing",
    category: "creative",
    effort: "medium",
    acceptanceCriteria: [
      "Minimum 6 social assets planned",
      "At least 1 press angle drafted",
    ],
    artifacts: ["Content brief", "Posting calendar"],
  },
  {
    title: "Prepare submission artifacts",
    owner: "distribution",
    category: "distribution",
    effort: "medium",
    acceptanceCriteria: [
      "Playlist and editorial target list completed",
      "Distribution checklist approved by owner",
    ],
    artifacts: ["Playlist target list", "Metadata pack"],
  },
  {
    title: "Run playlist pitch pass",
    owner: "marketing",
    category: "distribution",
    effort: "medium",
    acceptanceCriteria: [
      "Draft playlist pitches generated",
      "Pitch package includes links, context, and rationale",
    ],
    artifacts: ["Playlist pitch pack"],
  },
  {
    title: "Execute launch-day amplification",
    owner: "artist",
    category: "content",
    effort: "high",
    acceptanceCriteria: [
      "All day-of posts scheduled",
      "Email/press angle queued",
      "Initial response loop tracked",
    ],
    artifacts: ["Analytics scorecard", "Cover art package"],
  },
  {
    title: "Collect and assess week-one results",
    owner: "marketing",
    category: "analytics",
    effort: "low",
    acceptanceCriteria: [
      "Engagement by source captured",
      "Top-level insights exported",
    ],
    artifacts: ["Analytics scorecard", "Performance report"],
  },
];

function parseDate(releaseDate?: string): string {
  if (!releaseDate) {
    const fallback = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    return fallback.toISOString().slice(0, 10);
  }

  const normalized = Date.parse(releaseDate);
  if (Number.isNaN(normalized)) {
    const fallback = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    return fallback.toISOString().slice(0, 10);
  }

  return new Date(normalized).toISOString().slice(0, 10);
}

function rolloutWeeksForType(): 6 {
  return 6;
}

function stableHash(input: string): number {
  let value = 0;
  for (let i = 0; i < input.length; i += 1) {
    value = (value << 5) - value + input.charCodeAt(i);
    value |= 0;
  }
  return Math.abs(value);
}

export async function buildReleasePlan(input: ReleaseAgentInput): Promise<ReleasePlan> {
  const releaseDate = parseDate(input.releaseDate);
  const rolloutWeeks = rolloutWeeksForType();

  const totalTasks = rolloutWeeks + BASELINE_TASKS.length;
  const tasks: PlanTask[] = BASELINE_TASKS.map((template, index) => ({
    ...template,
    day: ((index % rolloutWeeks) + 1),
  })).concat(
    Array.from({ length: rolloutWeeks }, (_, weekOffset) => ({
      day: weekOffset + 1,
      title: `Rolling review and execution checkpoints (week ${weekOffset + 1})`,
      owner: "label" as const,
      category: "analytics" as const,
      effort: "low" as const,
      acceptanceCriteria: [
        "No missed day-of milestones",
        "All dependent tasks either completed or explicitly deferred",
      ],
      artifacts: ["Posting calendar"],
    }))
  ).slice(0, totalTasks);

  const owners: ReleasePlan["owners"] = [
    { role: "artist", ownerName: input.artistName },
    { role: "label", ownerName: "ReleaseOps" },
    { role: "distribution", ownerName: "Distribution Team" },
    { role: "marketing", ownerName: "Marketing Team" },
  ];

  const immutableVersion = `plan_${rolloutWeeks}w_${stableHash(`${input.releaseId}-${input.releaseTitle}`)}`;

  return {
    releaseId: input.releaseId,
    releaseTitle: input.releaseTitle,
    rolloutWeeks,
    releaseDate,
    tasks,
    artifacts: ARTIFACT_SET,
    owners,
    acceptanceChecklist: [
      `Publish at least 80% of planned content pieces within launch window`,
      "Keep weekly KPI checkpoints and post each checkpoint in notes",
      "Collect pitch outcomes and attach response status",
    ],
    immutableVersion,
    generatedAt: new Date().toISOString(),
  };
}
