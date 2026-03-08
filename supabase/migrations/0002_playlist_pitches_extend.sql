-- =============================================================================
-- ReleaseFlow — Extend playlist_pitches for Playlist Pitch Agent
-- Migration: 0002_playlist_pitches_extend
-- =============================================================================

-- Add columns produced by the Playlist Pitch Agent
alter table public.playlist_pitches
  add column if not exists spotify_playlist_id  text,
  add column if not exists follower_count        integer,
  add column if not exists fit_score             smallint check (fit_score between 0 and 100),
  add column if not exists pitch_subject         text,
  add column if not exists submithub_url         text,
  add column if not exists follow_up_date        date,
  add column if not exists follow_up_body        text,
  add column if not exists comparable_tracks     jsonb not null default '[]',
  add column if not exists audio_feature_notes   text,
  add column if not exists updated_at            timestamptz not null default now();

-- updated_at trigger
create trigger set_updated_at before update on public.playlist_pitches
  for each row execute function public.set_updated_at();

-- Index for fit score ordering (agent fetches top-N pitches)
create index if not exists idx_pitches_fit_score
  on public.playlist_pitches (release_id, fit_score desc);

-- Index for follow-up scheduling
create index if not exists idx_pitches_follow_up_date
  on public.playlist_pitches (follow_up_date)
  where follow_up_date is not null and status = 'sent';
