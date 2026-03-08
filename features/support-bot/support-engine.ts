/**
 * Support bot engine.
 *
 * Pipeline:
 *   1. Keyword-search help docs for relevant chunks
 *   2. Feed top chunks + conversation history to Claude
 *   3. If frustrated or complex, escalate to a human ticket
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { Resend } from "resend";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://releaseflow.app";

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}
function getResend() {
  return new Resend(process.env.RESEND_API_KEY!);
}

// ─── Product context (fallback when no docs match) ────────────────────────────

const PRODUCT_CONTEXT = `
ReleaseFlow is an AI-powered music release management platform for independent artists.

Key features:
- Artist profiles: add your name, genre, bio, social posts. The AI builds a voice profile.
- Releases: create a release (single/EP/album) with a release date.
- Campaigns: the AI automatically generates a marketing strategy with timeline and KPIs.
- Content generation: approve a campaign and get platform-specific posts for Instagram, TikTok, Twitter, email, and press — all in your artist's voice.
- Playlist pitching: AI generates personalised pitches to Spotify/Apple curators.
- Analytics: weekly reports comparing your stats to genre benchmarks.
- Referrals: share your unique link. When a friend upgrades, you both get 1 free month.
- Plans: Free (1 release/month), Starter ($29/month, 5 releases), Pro ($79/month, unlimited), Label ($199/month, team features).

Common issues:
- "Campaign not generating": ensure your artist has a voice profile and the release date is in the future.
- "Content not showing": content is generated after you approve the campaign — check the campaign status.
- "Billing": manage your subscription at /settings/billing.
- "Referral code": find your unique link at /referrals.
`;

const SYSTEM_PROMPT = `You are a helpful support assistant for ReleaseFlow, an AI-powered music release management platform.

You have access to help documentation and product context provided below. Use it to answer user questions accurately and concisely.

Guidelines:
- Be friendly, concise, and actionable. Max 3 short paragraphs per response.
- If you can solve the problem, do so directly.
- If the question is about billing, direct them to ${APP_URL}/settings/billing.
- If you genuinely cannot help (complex technical issue, account-specific data), say: "I'll escalate this to our team — they'll reply within 24 hours." and include the token ESCALATE in your response on a new line by itself.
- Detect if the user is frustrated (language like "this is broken", "doesn't work", "useless", "waste", "cancel") — if so, be extra empathetic and offer to escalate.`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SupportResponse {
  answer: string;
  escalated: boolean;
  ticketId?: string;
}

// ─── Keyword search for help docs ─────────────────────────────────────────────

async function searchDocs(query: string, limit = 3): Promise<string> {
  const supabase = await createClient();
  // Basic full-text search using PostgreSQL ilike — no pgvector needed
  const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 5);

  if (keywords.length === 0) return "";

  const { data } = await supabase
    .from("support_docs")
    .select("title, content")
    .or(keywords.map((k) => `content.ilike.%${k}%`).join(","))
    .limit(limit);

  if (!data?.length) return "";
  return data.map((d) => `## ${d.title}\n${d.content}`).join("\n\n---\n\n");
}

// ─── Escalation ───────────────────────────────────────────────────────────────

async function escalateToHuman(
  userId: string | null,
  userEmail: string,
  messages: ChatMessage[]
): Promise<string> {
  const supabase = await createClient();
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const { data: ticket } = await supabase
    .from("support_tickets")
    .insert({
      user_id:      userId,
      user_email:   userEmail,
      subject:      lastUserMsg.slice(0, 100),
      messages:     messages,
      status:       "open",
      bot_resolved: false,
    })
    .select("id")
    .single();

  // Notify admin
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && ticket) {
    try {
      await getResend().emails.send({
        from:    process.env.EMAIL_FROM ?? "ReleaseFlow <noreply@releaseflow.app>",
        to:      adminEmail,
        subject: `New support ticket: ${lastUserMsg.slice(0, 60)}`,
        html: `
<p>A new support ticket has been escalated.</p>
<p><strong>User email:</strong> ${userEmail}</p>
<p><strong>Last message:</strong> ${lastUserMsg}</p>
<p><strong>Ticket ID:</strong> ${ticket.id}</p>
<p>Full conversation: ${messages.map((m) => `${m.role}: ${m.content}`).join("\n")}</p>`,
      });
    } catch {
      // non-critical
    }
  }

  return ticket?.id ?? "new";
}

// ─── Main chat function ───────────────────────────────────────────────────────

export async function handleSupportMessage(
  messages: ChatMessage[],
  userId: string | null,
  userEmail: string
): Promise<SupportResponse> {
  const lastMessage = messages[messages.length - 1]?.content ?? "";

  // Search docs for relevant context
  const docContext = await searchDocs(lastMessage);

  const contextSection = [
    docContext ? `<help_docs>\n${docContext}\n</help_docs>` : "",
    `<product_context>\n${PRODUCT_CONTEXT}\n</product_context>`,
  ].filter(Boolean).join("\n\n");

  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001", // fast + cheap for support
    max_tokens: 600,
    system:     `${SYSTEM_PROMPT}\n\n${contextSection}`,
    messages:   messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const answerRaw = response.content[0]?.type === "text" ? response.content[0].text : "";
  const needsEscalation = answerRaw.includes("ESCALATE");
  const answer = answerRaw.replace(/^ESCALATE\s*$/m, "").trim();

  let ticketId: string | undefined;
  if (needsEscalation) {
    ticketId = await escalateToHuman(userId, userEmail, messages);
  }

  return { answer, escalated: needsEscalation, ticketId };
}
