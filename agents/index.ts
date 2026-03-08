/**
 * AI Agent modules for ReleaseFlow.
 *
 * Each agent is a self-contained module that wraps an LLM interaction
 * for a specific domain task (e.g. generating press releases, writing
 * social copy, analysing release metadata).
 */

export {
  buildReleasePlan,
  type ReleaseAgentInput,
  type ReleasePlan,
  type PlanTask,
} from "./release-agent";
export {
  buildVoiceProfile,
  VoiceProfileSchema,
  VoiceProfilerInputSchema,
  type VoiceProfile,
  type VoiceProfilerInput,
  type VoiceProfilerResult,
} from "./voice-profiler";
export {
  pitchPlaylists,
  PlaylistPitcherInputSchema,
  AudioFeaturesSchema,
  type PlaylistPitcherInput,
  type PlaylistPitcherOutput,
  type PlaylistPitcherResult,
} from "./playlist-pitcher";
export {
  interpretAnalytics,
  AnalyticsInterpreterInputSchema,
  AnalyticsReportSchema,
  type AnalyticsInterpreterInput,
  type AnalyticsReport,
  type AnalyticsInterpreterResult,
  type SpotifyAnalytics,
  type AppleAnalytics,
  type YouTubeAnalytics,
  type InstagramInsights,
  type TikTokAnalytics,
  type CampaignPlan,
} from "./analytics-interpreter";
