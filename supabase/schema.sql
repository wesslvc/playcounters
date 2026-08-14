-- ============================================================
--  Scrobble dashboard — schema
--  Run this once in Supabase → SQL Editor.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- users ----------
create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  spotify_id     text unique not null,
  display_name   text,
  avatar_url     text,
  refresh_token  text not null,
  last_synced_at timestamptz,
  last_played_at timestamptz,          -- cursor for /api/sync
  created_at     timestamptz not null default now()
);

-- ---------- plays ----------
create table if not exists plays (
  user_id    uuid not null references users(id) on delete cascade,
  played_at  timestamptz not null,
  track      text not null,
  artist     text not null,
  album      text,
  ms_played  integer not null default 0,
  source     text not null default 'live',   -- 'live' | 'import'
  primary key (user_id, played_at)
);

create index if not exists plays_user_time  on plays (user_id, played_at desc);
create index if not exists plays_user_artist on plays (user_id, artist);

-- Row level security: everything goes through the service role on the
-- server, so no anon policies are needed. RLS on = nothing leaks if the
-- publishable key is ever used from the browser.
alter table users enable row level security;
alter table plays enable row level security;

-- ============================================================
--  Ranking function
--  mode: 'tracks' | 'artists'
--  Returns plays, distinct days, distinct ISO weeks, minutes.
-- ============================================================
create or replace function top_items(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_mode text default 'tracks',
  p_tz   text default 'Asia/Seoul',
  p_limit int default 250
)
returns table (
  artist   text,
  track    text,
  plays    bigint,
  days     bigint,
  weeks    bigint,
  minutes  bigint,
  first_at timestamptz,
  last_at  timestamptz
)
language sql stable as $$
  select
    p.artist,
    case when p_mode = 'artists' then null else p.track end as track,
    count(*)                                                as plays,
    count(distinct (p.played_at at time zone p_tz)::date)   as days,
    count(distinct to_char(p.played_at at time zone p_tz, 'IYYY-IW')) as weeks,
    (sum(p.ms_played) / 60000)::bigint                      as minutes,
    min(p.played_at)                                        as first_at,
    max(p.played_at)                                        as last_at
  from plays p
  where p.user_id = p_user
    and p.played_at >= p_from
    and p.played_at <  p_to
    and p.ms_played >= 30000          -- same rule stats.fm and .fmbot use
  group by p.artist, case when p_mode = 'artists' then null else p.track end
  order by plays desc
  limit p_limit;
$$;

-- ============================================================
--  Daily totals — powers the activity strip
-- ============================================================
create or replace function daily_totals(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_tz   text default 'Asia/Seoul'
)
returns table (day date, plays bigint, minutes bigint)
language sql stable as $$
  select
    (played_at at time zone p_tz)::date as day,
    count(*)                            as plays,
    (sum(ms_played) / 60000)::bigint    as minutes
  from plays
  where user_id = p_user
    and played_at >= p_from
    and played_at <  p_to
    and ms_played >= 30000
  group by 1
  order by 1;
$$;
