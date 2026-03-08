import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { generateVoiceProfile } from "@/inngest/functions/generate-voice-profile";
import { generateCampaign } from "@/inngest/functions/generate-campaign";
import { generateContent } from "@/inngest/functions/generate-content";
import { onReleasePublished } from "@/inngest/functions/on-release-published";
import { generatePitches } from "@/inngest/functions/generate-pitches";
import { generateAnalyticsReport } from "@/inngest/functions/generate-analytics-report";
import { weeklyAnalyticsTrigger } from "@/inngest/functions/weekly-analytics-trigger";
import { onboardingEmails } from "@/inngest/functions/onboarding-emails";
import { weeklyBlogGenerator } from "@/inngest/functions/blog-generator";
import { churnPrevention } from "@/inngest/functions/churn-prevention";
import { pipelineStallAlert } from "@/inngest/functions/pipeline-stall-alert";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    generateVoiceProfile,
    generateCampaign,
    generateContent,
    onReleasePublished,
    generatePitches,
    generateAnalyticsReport,
    weeklyAnalyticsTrigger,
    pipelineStallAlert,
    onboardingEmails,
    weeklyBlogGenerator,
    churnPrevention,
  ],
});
