import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { artistsRouter } from "@/server/routers/artists";
import { artistRouter } from "@/server/routers/artist";
import { releasesRouter } from "@/server/routers/releases";
import { releaseRouter } from "@/server/routers/release";
import { campaignRouter } from "@/server/routers/campaign";
import { contentRouter } from "@/server/routers/content";
import { analyticsRouter } from "@/server/routers/analytics";
import { planRouter } from "@/server/routers/plan";
import { agentsRouter } from "@/server/routers/agents";
import { referralsRouter } from "@/server/routers/referrals";
import { evalsRouter } from "@/server/routers/evals";
import { adminRouter } from "@/server/routers/admin";
import { supportRouter } from "@/server/routers/support";
import { workflowRouter } from "@/server/routers/workflow";

export const appRouter = createTRPCRouter({
  artists: artistsRouter,
  artist: artistRouter,
  releases: releasesRouter,
  release: releaseRouter,
  campaign: campaignRouter,
  content: contentRouter,
  analytics: analyticsRouter,
  plan: planRouter,
  agents: agentsRouter,
  referrals: referralsRouter,
  evals: evalsRouter,
  admin: adminRouter,
  support: supportRouter,
  workflow: workflowRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
