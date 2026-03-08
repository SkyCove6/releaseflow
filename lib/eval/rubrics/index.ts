import type { AgentRubric } from "../types";
import { campaignStrategistRubric } from "./campaign-strategist";
import { contentWriterRubric }       from "./content-writer";
import { playlistPitcherRubric }     from "./playlist-pitcher";
import { analyticsInterpreterRubric } from "./analytics-interpreter";

export {
  campaignStrategistRubric,
  contentWriterRubric,
  playlistPitcherRubric,
  analyticsInterpreterRubric,
};

const RUBRIC_MAP: Record<string, AgentRubric> = {
  "campaign-strategist":  campaignStrategistRubric,
  "content-writer":       contentWriterRubric,
  "playlist-pitcher":     playlistPitcherRubric,
  "analytics-interpreter": analyticsInterpreterRubric,
};

export function getAgentRubric(agentName: string): AgentRubric | null {
  return RUBRIC_MAP[agentName] ?? null;
}

export const EVALUABLE_AGENTS = Object.keys(RUBRIC_MAP) as Array<keyof typeof RUBRIC_MAP>;
