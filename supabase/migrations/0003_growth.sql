-- ---------------------------------------------------------------------------
-- Migration 0003 — Growth engine tables
-- Adds: referral_codes, referral_conversions, blog_posts, eval_results
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Referral codes (one per user, auto-generated on first request)
-- ---------------------------------------------------------------------------

create table public.referral_codes (
  id          uuid         primary key default gen_random_uuid(),
  user_id     uuid         not null references public.users(id) on delete cascade,
  code        text         not null unique,
  used_count  integer      not null default 0,
  created_at  timestamptz  not null default now(),
  unique (user_id)   -- one code per user
);

create index idx_referral_codes_user on public.referral_codes(user_id);
create index idx_referral_codes_code on public.referral_codes(code);

-- ---------------------------------------------------------------------------
-- Referral conversions (tracked when a referred user pays)
-- ---------------------------------------------------------------------------

create table public.referral_conversions (
  id            uuid        primary key default gen_random_uuid(),
  referrer_id   uuid        not null references public.users(id) on delete cascade,
  referee_id    uuid        not null references public.users(id) on delete cascade,
  referral_code text        not null,
  status        text        not null default 'pending'
                            check (status in ('pending', 'credited', 'voided')),
  credited_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (referee_id)   -- each user can only be referred once
);

create index idx_referral_conversions_referrer on public.referral_conversions(referrer_id);
create index idx_referral_conversions_referee  on public.referral_conversions(referee_id);

-- ---------------------------------------------------------------------------
-- Blog posts (auto-generated + manually edited, publicly readable)
-- ---------------------------------------------------------------------------

create table public.blog_posts (
  id           uuid        primary key default gen_random_uuid(),
  slug         text        not null unique,
  title        text        not null,
  excerpt      text,
  content_html text        not null default '',
  seo_tags     text[]      not null default '{}',
  status       text        not null default 'draft'
               check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_blog_posts_slug   on public.blog_posts(slug);
create index idx_blog_posts_status on public.blog_posts(status, published_at desc);

-- Updated-at trigger
create trigger blog_posts_updated_at
  before update on public.blog_posts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Eval results (quality scores from Claude-as-judge)
-- Linked to the original agent_run that was scored.
-- ---------------------------------------------------------------------------

create table public.eval_results (
  id              uuid        primary key default gen_random_uuid(),
  agent_run_id    uuid        not null references public.agent_runs(id) on delete cascade,
  agent_name      text        not null,
  dimension_scores jsonb      not null default '{}',   -- { "dimension": score }
  total_score     numeric(4,2) not null,               -- weighted 1–10
  feedback        text,
  eval_model      text        not null default 'claude-sonnet-4-5',
  created_at      timestamptz not null default now()
);

create index idx_eval_results_agent     on public.eval_results(agent_name, created_at desc);
create index idx_eval_results_run       on public.eval_results(agent_run_id);

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------

-- referral_codes: users see and manage their own
alter table public.referral_codes enable row level security;

create policy "referral_codes: own"
  on public.referral_codes for all
  using (user_id = auth.uid());

-- referral_conversions: referrer can see their conversions
alter table public.referral_conversions enable row level security;

create policy "referral_conversions: referrer read"
  on public.referral_conversions for select
  using (referrer_id = auth.uid());

-- blog_posts: public read for published; no user writes (service role only)
alter table public.blog_posts enable row level security;

create policy "blog_posts: public read"
  on public.blog_posts for select
  using (status = 'published');

-- eval_results: users see evals for their own agent runs
alter table public.eval_results enable row level security;

create policy "eval_results: own agent runs"
  on public.eval_results for select
  using (
    exists (
      select 1 from public.agent_runs ar
      where ar.id = public.eval_results.agent_run_id
        and ar.user_id = auth.uid()
    )
  );
