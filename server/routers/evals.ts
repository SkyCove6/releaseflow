import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { runEval } from "@/lib/eval/evaluator";
import { generateOptimizationReport, runABTest } from "@/lib/eval/optimizer";
import { EVALUABLE_AGENTS } from "@/lib/eval/rubrics";
import type { EvalDataPoint } from "@/lib/eval/types";

const DateRangeSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const evalsRouter = createTRPCRouter({

  /** Run a full evaluation for one agent over a date range. */
  runEval: protectedProcedure
    .input(z.object({
      agentName:  z.enum(EVALUABLE_AGENTS as [string, ...string[]]),
      dateRange:  DateRangeSchema,
      sampleSize: z.number().int().min(1).max(20).default(5),
    }))
    .mutation(async ({ input }) => {
      const report = await runEval(input.agentName, {
        start:      input.dateRange.start,
        end:        input.dateRange.end,
        sampleSize: input.sampleSize,
        persist:    true,
      });
      return report;
    }),

  /** Generate optimization suggestions from an existing eval report. */
  optimize: protectedProcedure
    .input(z.object({
      agentName:  z.string(),
      dateRange:  DateRangeSchema,
      sampleSize: z.number().int().min(1).max(10).default(3),
    }))
    .mutation(async ({ input }) => {
      const report = await runEval(input.agentName, {
        start:      input.dateRange.start,
        end:        input.dateRange.end,
        sampleSize: input.sampleSize,
        persist:    false,
      });
      const optimization = await generateOptimizationReport(report);
      return optimization;
    }),

  /** Run an A/B prompt test. */
  abTest: protectedProcedure
    .input(z.object({
      agentName:   z.string(),
      oldPrompt:   z.string().min(10),
      newPrompt:   z.string().min(10),
      userMessage: z.string().min(10),
      maxTokens:   z.number().int().min(256).max(4096).default(1024),
    }))
    .mutation(async ({ input }) => {
      const result = await runABTest(input);
      return result;
    }),

  /** Historical weekly stats for Recharts (pulls from agent_runs + eval_results). */
  historicalData: protectedProcedure
    .input(z.object({
      agentNames: z.array(z.string()).min(1).max(6),
      weeks:      z.number().int().min(1).max(52).default(8),
    }))
    .query(async ({ ctx, input }) => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - input.weeks * 7);

      const { data: runs, error } = await ctx.supabase
        .from("agent_runs")
        .select("agent_name, tokens_used, cost_cents, duration_ms, status, created_at")
        .in("agent_name", input.agentNames)
        .gte("created_at", cutoff.toISOString())
        .order("created_at", { ascending: true });

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      const { data: evalRows } = await ctx.supabase
        .from("eval_results")
        .select("agent_name, total_score, created_at")
        .in("agent_name", input.agentNames)
        .gte("created_at", cutoff.toISOString());

      // Group by ISO week + agent
      function isoWeek(dateStr: string): string {
        const d = new Date(dateStr);
        const jan1 = new Date(d.getFullYear(), 0, 1);
        const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
        return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
      }

      type WeekAgentKey = string;
      const runBuckets: Record<WeekAgentKey, { success: number; total: number; costSum: number; durationSum: number }> = {};
      const qualBuckets: Record<WeekAgentKey, { scoreSum: number; count: number }> = {};

      for (const r of runs ?? []) {
        const key = `${isoWeek(r.created_at)}::${r.agent_name}`;
        if (!runBuckets[key]) runBuckets[key] = { success: 0, total: 0, costSum: 0, durationSum: 0 };
        runBuckets[key]!.total += 1;
        if (r.status === "completed") {
          runBuckets[key]!.success += 1;
          runBuckets[key]!.costSum += r.cost_cents ?? 0;
          runBuckets[key]!.durationSum += r.duration_ms ?? 0;
        }
      }

      for (const e of evalRows ?? []) {
        const key = `${isoWeek(e.created_at)}::${e.agent_name}`;
        if (!qualBuckets[key]) qualBuckets[key] = { scoreSum: 0, count: 0 };
        qualBuckets[key]!.scoreSum += e.total_score as number;
        qualBuckets[key]!.count += 1;
      }

      const dataPoints: EvalDataPoint[] = Object.entries(runBuckets).map(([key, bucket]) => {
        const [week, agentName] = key.split("::") as [string, string];
        const qb = qualBuckets[key];
        return {
          week,
          agentName,
          avgQuality:   qb ? Math.round((qb.scoreSum / qb.count) * 10) / 10 : null,
          avgCostCents: bucket.total > 0 ? Math.round(bucket.costSum / bucket.total) : 0,
          successRate:  bucket.total > 0 ? Math.round((bucket.success / bucket.total) * 100) / 100 : 0,
          runCount:     bucket.total,
        };
      });

      return dataPoints.sort((a, b) => a.week.localeCompare(b.week));
    }),

  /** Per-agent run statistics summary for the dashboard header cards. */
  agentSummaries: protectedProcedure
    .input(z.object({
      dateRange: DateRangeSchema,
    }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("agent_runs")
        .select("agent_name, tokens_used, cost_cents, duration_ms, status")
        .gte("created_at", input.dateRange.start)
        .lte("created_at", input.dateRange.end + "T23:59:59Z");

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      const byAgent: Record<string, { total: number; success: number; cost: number; tokens: number }> = {};
      for (const r of data ?? []) {
        if (!byAgent[r.agent_name]) byAgent[r.agent_name] = { total: 0, success: 0, cost: 0, tokens: 0 };
        byAgent[r.agent_name]!.total += 1;
        if (r.status === "completed") {
          byAgent[r.agent_name]!.success += 1;
          byAgent[r.agent_name]!.cost += r.cost_cents ?? 0;
          byAgent[r.agent_name]!.tokens += r.tokens_used ?? 0;
        }
      }

      return Object.entries(byAgent).map(([agentName, s]) => ({
        agentName,
        totalRuns:     s.total,
        successRate:   s.total > 0 ? s.success / s.total : 0,
        totalCostCents: s.cost,
        totalTokens:   s.tokens,
      }));
    }),

  /** Evaluable agent names list (for the UI dropdown). */
  evaluableAgents: protectedProcedure.query(() => EVALUABLE_AGENTS),
});
