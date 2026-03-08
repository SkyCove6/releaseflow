-- =============================================================================
-- ReleaseFlow — Initial Schema
-- Migration: 0001_initial_schema
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm"; -- fast text search on names

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type plan_tier        as enum ('free', 'starter', 'pro', 'label');
create type release_type     as enum ('single', 'ep', 'album');
create type release_status   as enum ('draft', 'planned', 'active', 'completed');
create type campaign_status  as enum ('draft', 'active', 'paused', 'completed', 'cancelled');
create type platform         as enum ('instagram', 'tiktok', 'twitter', 'youtube', 'email', 'press');
create type content_type     as enum ('post', 'story', 'reel', 'thread', 'newsletter', 'press_release', 'pitch');
create type content_status   as enum ('draft', 'approved', 'scheduled', 'published', 'failed');
create type pitch_status     as enum ('drafted', 'sent', 'accepted', 'rejected', 'no_response');
create type analytics_source as enum ('spotify', 'apple', 'youtube', 'instagram', 'tiktok');
create type agent_status     as enum ('running', 'completed', 'failed');

-- ---------------------------------------------------------------------------
-- Table: users
-- Extends auth.users with application-level profile data.
-- ---------------------------------------------------------------------------
create table public.users (
  id                 uuid        primary key references auth.users(id) on delete cascade,
  email              text        not null,
  name               text,
  stripe_customer_id text        unique,
  plan_tier          plan_tier   not null default 'free',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.users is 'Application-level user profiles, linked 1:1 to auth.users.';

-- ---------------------------------------------------------------------------
-- Table: artists
-- ---------------------------------------------------------------------------
create table public.artists (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references public.users(id) on delete cascade,
  name          text        not null,
  genre         text,
  spotify_id    text,
  apple_id      text,
  voice_profile jsonb       not null default '{}',
  image_url     text,
  bio           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on column public.artists.voice_profile is
  'Structured tone/style config used by AI agents when generating copy for this artist.';

-- ---------------------------------------------------------------------------
-- Table: releases
-- ---------------------------------------------------------------------------
create table public.releases (
  id          uuid           primary key default gen_random_uuid(),
  artist_id   uuid           not null references public.artists(id) on delete cascade,
  title       text           not null,
  type        release_type   not null default 'single',
  release_date date,
  upc         text,
  isrc        text,
  artwork_url text,
  status      release_status not null default 'draft',
  metadata    jsonb          not null default '{}',
  created_at  timestamptz    not null default now(),
  updated_at  timestamptz    not null default now()
);
comment on column public.releases.metadata is
  'Flexible bag for DSP-specific metadata, credits, notes, etc.';

-- ---------------------------------------------------------------------------
-- Table: campaigns
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id           uuid            primary key default gen_random_uuid(),
  release_id   uuid            not null references public.releases(id) on delete cascade,
  strategy     jsonb           not null default '{}',
  timeline     jsonb           not null default '{}',
  budget_cents integer         not null default 0 check (budget_cents >= 0),
  status       campaign_status not null default 'draft',
  kpi_targets  jsonb           not null default '{}',
  created_at   timestamptz     not null default now(),
  updated_at   timestamptz     not null default now()
);

-- ---------------------------------------------------------------------------
-- Table: content_items
-- ---------------------------------------------------------------------------
create table public.content_items (
  id                 uuid           primary key default gen_random_uuid(),
  campaign_id        uuid           not null references public.campaigns(id) on delete cascade,
  platform           platform       not null,
  content_type       content_type   not null,
  body               text           not null default '',
  variants           jsonb          not null default '[]',
  status             content_status not null default 'draft',
  scheduled_at       timestamptz,
  published_at       timestamptz,
  external_id        text,
  engagement_metrics jsonb          not null default '{}',
  created_at         timestamptz    not null default now(),
  updated_at         timestamptz    not null default now()
);
comment on column public.content_items.variants is
  'Array of A/B variant bodies, e.g. [{\"label\":\"v1\",\"body\":\"...\"}].';
comment on column public.content_items.engagement_metrics is
  'Platform-returned metrics snapshot, e.g. {\"likes\":0, \"plays\":0}.';

-- ---------------------------------------------------------------------------
-- Table: playlist_pitches
-- ---------------------------------------------------------------------------
create table public.playlist_pitches (
  id             uuid         primary key default gen_random_uuid(),
  release_id     uuid         not null references public.releases(id) on delete cascade,
  playlist_name  text         not null,
  playlist_url   text,
  curator_email  text,
  pitch_body     text         not null default '',
  status         pitch_status not null default 'drafted',
  sent_at        timestamptz,
  response_at    timestamptz,
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now()
);

-- ---------------------------------------------------------------------------
-- Table: analytics_snapshots
-- ---------------------------------------------------------------------------
create table public.analytics_snapshots (
  id            uuid             primary key default gen_random_uuid(),
  release_id    uuid             not null references public.releases(id) on delete cascade,
  source        analytics_source not null,
  data          jsonb            not null default '{}',
  snapshot_date date             not null,
  created_at    timestamptz      not null default now(),

  -- One snapshot per release / source / day
  unique (release_id, source, snapshot_date)
);

-- ---------------------------------------------------------------------------
-- Table: agent_runs
-- Not scoped to a single user — used for observability / cost tracking.
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id          uuid         primary key default gen_random_uuid(),
  user_id     uuid         references public.users(id) on delete set null,
  agent_name  text         not null,
  input       jsonb        not null default '{}',
  output      jsonb        not null default '{}',
  tokens_used integer,
  cost_cents  integer,
  duration_ms integer,
  status      agent_status not null default 'running',
  error       text,
  created_at  timestamptz  not null default now()
);
comment on table public.agent_runs is
  'Audit log of every AI agent invocation for cost tracking and debugging.';

-- ---------------------------------------------------------------------------
-- updated_at trigger (shared)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.users
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.artists
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.releases
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.content_items
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.playlist_pitches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create user profile on auth.users insert
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- INDEXES
-- =============================================================================

-- users
create index idx_users_stripe_customer on public.users (stripe_customer_id)
  where stripe_customer_id is not null;
create index idx_users_plan_tier       on public.users (plan_tier);

-- artists
create index idx_artists_user_id    on public.artists (user_id);
create index idx_artists_spotify_id on public.artists (spotify_id) where spotify_id is not null;
create index idx_artists_name_trgm  on public.artists using gin (name gin_trgm_ops);

-- releases
create index idx_releases_artist_id    on public.releases (artist_id);
create index idx_releases_status       on public.releases (status);
create index idx_releases_release_date on public.releases (release_date);
create index idx_releases_upc          on public.releases (upc) where upc is not null;

-- campaigns
create index idx_campaigns_release_id on public.campaigns (release_id);
create index idx_campaigns_status     on public.campaigns (status);

-- content_items
create index idx_content_items_campaign_id  on public.content_items (campaign_id);
create index idx_content_items_status       on public.content_items (status);
create index idx_content_items_scheduled_at on public.content_items (scheduled_at)
  where scheduled_at is not null;
create index idx_content_items_platform     on public.content_items (platform);

-- playlist_pitches
create index idx_pitches_release_id on public.playlist_pitches (release_id);
create index idx_pitches_status     on public.playlist_pitches (status);

-- analytics_snapshots
create index idx_analytics_release_source on public.analytics_snapshots (release_id, source);
create index idx_analytics_snapshot_date  on public.analytics_snapshots (snapshot_date);

-- agent_runs
create index idx_agent_runs_user_id    on public.agent_runs (user_id) where user_id is not null;
create index idx_agent_runs_agent_name on public.agent_runs (agent_name);
create index idx_agent_runs_status     on public.agent_runs (status);
create index idx_agent_runs_created_at on public.agent_runs (created_at);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.users              enable row level security;
alter table public.artists            enable row level security;
alter table public.releases           enable row level security;
alter table public.campaigns          enable row level security;
alter table public.content_items      enable row level security;
alter table public.playlist_pitches   enable row level security;
alter table public.analytics_snapshots enable row level security;
alter table public.agent_runs         enable row level security;

-- ── users ────────────────────────────────────────────────────────────────────
create policy "users: own row only"
  on public.users for all
  using  (id = auth.uid())
  with check (id = auth.uid());

-- ── artists ──────────────────────────────────────────────────────────────────
create policy "artists: own rows only"
  on public.artists for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── releases ─────────────────────────────────────────────────────────────────
-- Users reach releases through their artists.
create policy "releases: via artist ownership"
  on public.releases for all
  using (
    exists (
      select 1 from public.artists a
      where a.id = public.releases.artist_id
        and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.artists a
      where a.id = public.releases.artist_id
        and a.user_id = auth.uid()
    )
  );

-- ── campaigns ────────────────────────────────────────────────────────────────
create policy "campaigns: via release → artist ownership"
  on public.campaigns for all
  using (
    exists (
      select 1
      from public.releases r
      join public.artists  a on a.id = r.artist_id
      where r.id = public.campaigns.release_id
        and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.releases r
      join public.artists  a on a.id = r.artist_id
      where r.id = public.campaigns.release_id
        and a.user_id = auth.uid()
    )
  );

-- ── content_items ────────────────────────────────────────────────────────────
create policy "content_items: via campaign → release → artist ownership"
  on public.content_items for all
  using (
    exists (
      select 1
      from public.campaigns    c
      join public.releases     r on r.id = c.release_id
      join public.artists      a on a.id = r.artist_id
      where c.id = public.content_items.campaign_id
        and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.campaigns    c
      join public.releases     r on r.id = c.release_id
      join public.artists      a on a.id = r.artist_id
      where c.id = public.content_items.campaign_id
        and a.user_id = auth.uid()
    )
  );

-- ── playlist_pitches ─────────────────────────────────────────────────────────
create policy "pitches: via release → artist ownership"
  on public.playlist_pitches for all
  using (
    exists (
      select 1
      from public.releases r
      join public.artists  a on a.id = r.artist_id
      where r.id = public.playlist_pitches.release_id
        and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.releases r
      join public.artists  a on a.id = r.artist_id
      where r.id = public.playlist_pitches.release_id
        and a.user_id = auth.uid()
    )
  );

-- ── analytics_snapshots ──────────────────────────────────────────────────────
create policy "analytics: via release → artist ownership"
  on public.analytics_snapshots for all
  using (
    exists (
      select 1
      from public.releases r
      join public.artists  a on a.id = r.artist_id
      where r.id = public.analytics_snapshots.release_id
        and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.releases r
      join public.artists  a on a.id = r.artist_id
      where r.id = public.analytics_snapshots.release_id
        and a.user_id = auth.uid()
    )
  );

-- ── agent_runs ───────────────────────────────────────────────────────────────
create policy "agent_runs: own rows only"
  on public.agent_runs for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
