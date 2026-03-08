/**
 * Weekly SEO blog post generator.
 *
 * Runs every Monday at 08:00 UTC. Picks a music-marketing topic that hasn't
 * been covered recently, generates a ~1 500-word HTML post via Claude, then
 * persists it to `blog_posts` with status "published".
 *
 * Triggered by: cron  0 8 * * 1
 */

import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "@/inngest/client";
import { supabaseAdmin } from "@/lib/supabase-admin";

// ─── Topic bank ───────────────────────────────────────────────────────────────

const TOPIC_POOL = [
  "How to write a playlist pitch that actually gets accepted",
  "The 3-week pre-release timeline every indie artist needs",
  "TikTok vs Instagram Reels: which drives more streams in 2025?",
  "How to get your music featured in editorial playlists",
  "Building an engaged email list as an independent artist",
  "Spotify for Artists: the metrics that actually matter",
  "How to write a music press release that journalists open",
  "Genre-bending in music marketing: how to position a hybrid sound",
  "The anatomy of a high-converting artist bio",
  "Release strategies for EPs vs albums: what the data says",
  "How to use social proof to grow Spotify streams organically",
  "Music marketing on a $0 budget: a practical guide",
  "Why your release week strategy matters more than the release itself",
  "How to pitch your music to sync licensing supervisors",
  "Building a pre-save campaign that converts",
  "The role of AI in modern music marketing",
  "How to turn casual listeners into superfans",
  "Music metadata explained: why it matters for discovery",
  "Collaborating with other artists to grow your audience",
  "How to use YouTube Shorts for music discovery",
];

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

// ─── Slug helper ──────────────────────────────────────────────────────────────

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

// ─── Inngest function ─────────────────────────────────────────────────────────

export const weeklyBlogGenerator = inngest.createFunction(
  {
    id:      "weekly-blog-generator",
    name:    "Weekly SEO Blog Generator",
    retries: 1,
  },
  { cron: "0 8 * * 1" },
  async ({ step, logger }) => {
    // Step 1: Pick a topic not recently published
    const topic = await step.run("pick-topic", async () => {
      const supabase = supabaseAdmin;
      const { data: recent } = await supabase
        .from("blog_posts")
        .select("title")
        .order("published_at", { ascending: false })
        .limit(10);

      const recentTitles = new Set((recent ?? []).map((r) => r.title));
      const available = TOPIC_POOL.filter((t) => !recentTitles.has(t));
      const pool = available.length > 0 ? available : TOPIC_POOL;
      return pool[Math.floor(Math.random() * pool.length)]!;
    });

    logger.info("Generating blog post", { topic });

    // Step 2: Generate content with Claude
    const generated = await step.run("generate-content", async () => {
      const anthropic = getAnthropicClient();

      const systemPrompt = `You are an expert music marketing content writer for ReleaseFlow, an AI-powered music release management platform.

Write authoritative, practical blog posts for independent musicians. Your style is:
- Direct and actionable — every paragraph teaches something concrete
- Conversational but professional
- Data-informed where possible (use plausible industry figures)
- Optimised for search (use the target keyword naturally throughout)

Output a JSON object with these exact fields:
{
  "title": "The exact article title",
  "excerpt": "A 1–2 sentence meta description (150 chars max)",
  "seo_tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "content_html": "Full article as valid HTML using <h2>, <h3>, <p>, <ul>, <ol>, <strong>, <em> tags. No <html>/<body>/<head> wrappers. Approx 1500 words."
}`;

      const response = await anthropic.messages.create({
        model:      "claude-sonnet-4-5",
        max_tokens: 4096,
        messages: [
          {
            role:    "user",
            content: `Write a comprehensive blog post about: "${topic}"\n\nTarget audience: independent musicians trying to grow their streaming numbers and fan base. Include practical tips they can use immediately.`,
          },
        ],
        system: systemPrompt,
      });

      const raw = response.content[0];
      if (!raw || raw.type !== "text") throw new Error("No text content from Claude");

      // Extract JSON — Claude may wrap it in ```json fences
      const jsonMatch = raw.text.match(/```json\s*([\s\S]*?)```/) ??
                        raw.text.match(/(\{[\s\S]*\})/);
      if (!jsonMatch?.[1]) throw new Error("Could not parse JSON from Claude response");

      const parsed = JSON.parse(jsonMatch[1]) as {
        title: string;
        excerpt: string;
        seo_tags: string[];
        content_html: string;
      };

      return {
        ...parsed,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      };
    });

    // Step 3: Persist to DB
    await step.run("persist-post", async () => {
      const supabase = supabaseAdmin;
      const slug = toSlug(generated.title);
      const now  = new Date().toISOString();

      const { error } = await supabase.from("blog_posts").insert({
        slug,
        title:        generated.title,
        excerpt:      generated.excerpt,
        content_html: generated.content_html,
        seo_tags:     generated.seo_tags,
        status:       "published",
        published_at: now,
      });

      if (error) throw new Error(`DB insert failed: ${error.message}`);
      logger.info("Blog post published", { slug, title: generated.title });
      return { slug };
    });

    return {
      topic,
      title:      generated.title,
      tokensUsed: generated.tokensUsed,
    };
  }
);
