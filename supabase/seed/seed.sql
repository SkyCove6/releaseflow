-- =============================================================================
-- ReleaseFlow — Seed Data (development / testing only)
-- =============================================================================
-- These UUIDs are fixed so seeds are idempotent.
-- In production, auth users are created through Supabase Auth, which triggers
-- the handle_new_user() function to populate public.users automatically.
-- For local dev, we insert directly because seed runs outside Auth flow.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed users (bypass trigger — insert directly)
-- ---------------------------------------------------------------------------
-- User A — Alice Bloom (pro plan)
insert into public.users (id, email, name, plan_tier, created_at)
values (
  'a0000000-0000-0000-0000-000000000001',
  'alice@releaseflow.dev',
  'Alice Bloom',
  'pro',
  now() - interval '30 days'
)
on conflict (id) do nothing;

-- User B — Bob Strand (starter plan)
insert into public.users (id, email, name, plan_tier, created_at)
values (
  'b0000000-0000-0000-0000-000000000002',
  'bob@releaseflow.dev',
  'Bob Strand',
  'starter',
  now() - interval '14 days'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Seed artists
-- ---------------------------------------------------------------------------
-- Alice's artist
insert into public.artists (id, user_id, name, genre, spotify_id, voice_profile, bio, created_at)
values (
  'a1000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'Luna Veil',
  'Indie Pop',
  '4Z8W4fkeT4SnZI3MRCtyrt',
  '{
    "tone": "dreamy",
    "keywords": ["ethereal", "bittersweet", "night"],
    "avoid": ["aggressive", "commercial"],
    "emoji_style": "minimal"
  }',
  'Luna Veil is a London-based indie-pop artist known for her layered harmonies and cinematic production.',
  now() - interval '28 days'
)
on conflict (id) do nothing;

-- Bob's artist
insert into public.artists (id, user_id, name, genre, spotify_id, voice_profile, bio, created_at)
values (
  'b1000000-0000-0000-0000-000000000002',
  'b0000000-0000-0000-0000-000000000002',
  'CREST',
  'Electronic / House',
  '6sFIWsNpZYqfjUpaCgueju',
  '{
    "tone": "energetic",
    "keywords": ["peak-time", "warehouse", "movement"],
    "avoid": ["melancholic", "quiet"],
    "emoji_style": "bold"
  }',
  'CREST is a Berlin-based electronic producer and DJ, blending house, techno and ambient textures.',
  now() - interval '12 days'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Seed releases
-- ---------------------------------------------------------------------------
-- Luna Veil — "Still Water" (upcoming single)
insert into public.releases (id, artist_id, title, type, release_date, upc, isrc, status, metadata, created_at)
values (
  'a2000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'Still Water',
  'single',
  (current_date + interval '21 days')::date,
  '012345678901',
  'GBARL2500001',
  'planned',
  '{
    "bpm": 92,
    "key": "D minor",
    "mood": ["reflective", "hopeful"],
    "credits": {
      "producer": "Luna Veil",
      "mixing": "James Holt",
      "mastering": "Abbey Road Studios"
    }
  }',
  now() - interval '10 days'
)
on conflict (id) do nothing;

-- CREST — "Submerge EP" (in-progress EP)
insert into public.releases (id, artist_id, title, type, release_date, status, metadata, created_at)
values (
  'b2000000-0000-0000-0000-000000000002',
  'b1000000-0000-0000-0000-000000000002',
  'Submerge EP',
  'ep',
  (current_date + interval '42 days')::date,
  'active',
  '{
    "track_count": 4,
    "bpm_range": [126, 134],
    "credits": {
      "producer": "CREST",
      "mastering": "Calyx Mastering"
    }
  }',
  now() - interval '5 days'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Seed campaigns
-- ---------------------------------------------------------------------------
-- Campaign for Still Water
insert into public.campaigns (id, release_id, budget_cents, status, strategy, timeline, kpi_targets, created_at)
values (
  'a3000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  150000, -- £1,500
  'active',
  '{
    "approach": "organic-first",
    "focus_platforms": ["instagram", "tiktok", "press"],
    "key_message": "A meditation on stillness in a noisy world"
  }',
  '{
    "pre_release_weeks": 3,
    "milestones": [
      {"week": -3, "task": "Announce on socials"},
      {"week": -2, "task": "Release lyric video"},
      {"week": -1, "task": "Playlist pitching"},
      {"week":  0, "task": "Release day push"},
      {"week":  1, "task": "Press & blog outreach"}
    ]
  }',
  '{
    "spotify_streams_day1": 5000,
    "instagram_reach": 20000,
    "playlist_adds": 10
  }',
  now() - interval '8 days'
)
on conflict (id) do nothing;

-- Campaign for Submerge EP
insert into public.campaigns (id, release_id, budget_cents, status, strategy, timeline, kpi_targets, created_at)
values (
  'b3000000-0000-0000-0000-000000000002',
  'b2000000-0000-0000-0000-000000000002',
  300000, -- £3,000
  'draft',
  '{
    "approach": "club-promo + online",
    "focus_platforms": ["instagram", "youtube"],
    "key_message": "Dive deep. Dance deeper."
  }',
  '{
    "pre_release_weeks": 4,
    "milestones": [
      {"week": -4, "task": "Teaser clips on IG Reels"},
      {"week": -2, "task": "Album artwork reveal"},
      {"week": -1, "task": "Submit to dance blogs"},
      {"week":  0, "task": "Release + DJ promo packs"}
    ]
  }',
  '{
    "spotify_streams_day1": 8000,
    "youtube_views_week1": 15000
  }',
  now() - interval '3 days'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Seed content_items
-- ---------------------------------------------------------------------------
insert into public.content_items (campaign_id, platform, content_type, body, status, created_at)
values
  (
    'a3000000-0000-0000-0000-000000000001',
    'instagram',
    'post',
    'Something still is coming. 🌊 "Still Water" — out in 3 weeks. Pre-save link in bio.',
    'approved',
    now() - interval '7 days'
  ),
  (
    'a3000000-0000-0000-0000-000000000001',
    'tiktok',
    'reel',
    'POV: you find the song you didn''t know you needed. 🎵 #StillWater #LunaVeil #IndiePop',
    'draft',
    now() - interval '6 days'
  ),
  (
    'a3000000-0000-0000-0000-000000000001',
    'press',
    'press_release',
    'FOR IMMEDIATE RELEASE — Luna Veil announces new single "Still Water", a meditation on finding calm amid chaos, out [DATE] on all platforms.',
    'draft',
    now() - interval '5 days'
  );

-- ---------------------------------------------------------------------------
-- Seed playlist_pitches
-- ---------------------------------------------------------------------------
insert into public.playlist_pitches (release_id, playlist_name, playlist_url, curator_email, pitch_body, status, created_at)
values
  (
    'a2000000-0000-0000-0000-000000000001',
    'Indie Chill Vibes',
    'https://open.spotify.com/playlist/example1',
    'curator@indiechill.example',
    'Hi! I''d love to pitch "Still Water" by Luna Veil for Indie Chill Vibes. It''s a dreamy indie-pop track built around layered vocals and a 92bpm pulse — sits perfectly next to your current adds.',
    'drafted',
    now() - interval '4 days'
  ),
  (
    'a2000000-0000-0000-0000-000000000001',
    'New Music Friday UK',
    'https://open.spotify.com/playlist/example2',
    null,
    '',
    'drafted',
    now() - interval '2 days'
  );

-- ---------------------------------------------------------------------------
-- Seed analytics_snapshots (past 7 days for Still Water)
-- ---------------------------------------------------------------------------
insert into public.analytics_snapshots (release_id, source, data, snapshot_date)
select
  'a2000000-0000-0000-0000-000000000001'::uuid,
  'spotify'::analytics_source,
  json_build_object(
    'streams',       (100 + (gs * 80))::int,
    'listeners',     (60  + (gs * 50))::int,
    'saves',         (5   + (gs * 4))::int,
    'playlist_adds', (gs / 2)::int
  )::jsonb,
  (current_date - (7 - gs) * interval '1 day')::date
from generate_series(1, 7) as gs
on conflict (release_id, source, snapshot_date) do nothing;

insert into public.analytics_snapshots (release_id, source, data, snapshot_date)
select
  'a2000000-0000-0000-0000-000000000001'::uuid,
  'instagram'::analytics_source,
  json_build_object(
    'impressions', (500 + (gs * 200))::int,
    'reach',       (300 + (gs * 150))::int,
    'profile_visits', (20 + (gs * 15))::int
  )::jsonb,
  (current_date - (7 - gs) * interval '1 day')::date
from generate_series(1, 7) as gs
on conflict (release_id, source, snapshot_date) do nothing;

-- ---------------------------------------------------------------------------
-- Seed agent_runs (sample AI invocations)
-- ---------------------------------------------------------------------------
insert into public.agent_runs (user_id, agent_name, input, output, tokens_used, cost_cents, duration_ms, status)
values
  (
    'a0000000-0000-0000-0000-000000000001',
    'release-agent',
    '{"releaseTitle":"Still Water","artistName":"Luna Veil","genre":"Indie Pop","releaseDate":"2026-03-25"}',
    '{"pressRelease":"...","socialCopy":{"twitter":"...","instagram":"..."}, "playlistPitch":"..."}',
    1240,
    2,
    1830,
    'completed'
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    'release-agent',
    '{"releaseTitle":"Submerge EP","artistName":"CREST","genre":"Electronic / House","releaseDate":"2026-04-15"}',
    '{"pressRelease":"...","socialCopy":{"twitter":"...","instagram":"..."},"playlistPitch":"..."}',
    1380,
    3,
    2100,
    'completed'
  );
