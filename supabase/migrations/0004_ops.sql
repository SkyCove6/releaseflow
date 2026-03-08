-- =============================================================================
-- ReleaseFlow — Operations Automation Schema
-- Migration: 0004_ops
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: churn_interventions
-- Tracks risk scores and outreach for at-risk users
-- ---------------------------------------------------------------------------
create table public.churn_interventions (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.users(id) on delete cascade,
  risk_score      integer     not null check (risk_score between 0 and 100),
  risk_factors    jsonb       not null default '[]',
  tier            text        not null check (tier in ('low','medium','high')),
  action_taken    text        not null,  -- 'tip_email' | 'checkin_email' | 'discount_offer'
  email_sent_at   timestamptz,
  outcome         text,                  -- 'converted' | 'churned' | 'pending'
  created_at      timestamptz not null default now()
);

create index idx_churn_interventions_user on public.churn_interventions(user_id, created_at desc);
create index idx_churn_interventions_tier on public.churn_interventions(tier, created_at desc);

-- ---------------------------------------------------------------------------
-- Table: support_docs
-- Help doc chunks for RAG-based support bot
-- ---------------------------------------------------------------------------
create table public.support_docs (
  id          uuid        primary key default gen_random_uuid(),
  title       text        not null,
  content     text        not null,
  category    text,
  embedding   vector(1536),   -- requires pgvector; falls back to keyword search if absent
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_support_docs_category on public.support_docs(category);

-- ---------------------------------------------------------------------------
-- Table: support_tickets
-- Escalated support conversations
-- ---------------------------------------------------------------------------
create table public.support_tickets (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        references public.users(id) on delete set null,
  user_email   text,
  subject      text        not null,
  messages     jsonb       not null default '[]',
  status       text        not null default 'open' check (status in ('open','resolved','escalated')),
  bot_resolved boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_support_tickets_user   on public.support_tickets(user_id, created_at desc);
create index idx_support_tickets_status on public.support_tickets(status, created_at desc);

create trigger support_tickets_updated_at
  before update on public.support_tickets
  for each row execute procedure moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- Table: agent_alerts
-- Critical failure log sent to admin
-- ---------------------------------------------------------------------------
create table public.agent_alerts (
  id           uuid        primary key default gen_random_uuid(),
  agent_name   text        not null,
  failure_count integer    not null,
  last_error   text,
  notified_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------

alter table public.churn_interventions enable row level security;
-- Admin only — accessed via service role in server functions; no user-visible policy needed

alter table public.support_docs enable row level security;
create policy "support_docs: public read"
  on public.support_docs for select
  using (true);

alter table public.support_tickets enable row level security;
create policy "support_tickets: own"
  on public.support_tickets for all
  using (user_id = auth.uid());

alter table public.agent_alerts enable row level security;
-- Admin only via service role
