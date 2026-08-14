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
  source     text not null default 'live',   -- 'live' | 'import' | 'youtube'
  primary key (user_id, played_at)
);

create index if not exists plays_user_time  on plays (user_id, played_at desc);
create index if not exists plays_user_artist on plays (user_id, artist);

-- ---------- cover art ----------
-- Shared across users and immutable, so it lives here rather than on plays.
-- Imported history carries no images; those are filled by searching Spotify
-- once. Misses are stored as null so a fruitless search isn't repeated.
create table if not exists covers (
  kind       text not null,               -- 'album' | 'artist'
  artist     text not null,
  album      text not null default '',    -- '' for artist covers
  image_url  text,
  fetched_at timestamptz not null default now(),
  primary key (kind, artist, album)
);

-- Row level security: everything goes through the service role on the
-- server, so no anon policies are needed. RLS on = nothing leaks if the
-- publishable key is ever used from the browser.
alter table users enable row level security;
alter table plays enable row level security;
alter table covers enable row level security;

-- ============================================================
--  Reading functions
--
--  p_source: 'all' | 'spotify' (live + import) | 'youtube'
--
--  YouTube Takeout records that something played but never for how long, so
--  youtube rows carry ms_played 0. The >=30s rule therefore cannot apply to
--  them — it would discard every one — and they contribute nothing to the
--  minutes total rather than inventing a duration. p_source exists because
--  the two platforms are not measured the same way and shouldn't be forced
--  into one number without the reader's say-so.
-- ============================================================

-- ---------- ranking: mode 'tracks' | 'artists' ----------
create or replace function top_items(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_mode text default 'tracks',
  p_tz   text default 'Asia/Seoul',
  p_limit int default 250,
  p_source text default 'all'
)
returns table (
  artist   text,
  track    text,
  album    text,
  plays    bigint,
  days     bigint,
  weeks    bigint,
  minutes  bigint,
  first_at timestamptz,
  last_at  timestamptz
)
language sql stable
-- search_path is pinned so the function always resolves `plays` in this
-- schema, whatever the caller's search_path happens to be.
set search_path = public, pg_temp
as $$
  select
    p.artist,
    case when p_mode = 'artists' then null else p.track end as track,
    -- Most recent album this track was played from: singles get re-released
    -- on compilations, and the latest is what artwork search will match.
    case when p_mode = 'artists' then null
         else (array_agg(p.album order by p.played_at desc))[1] end as album,
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
    -- >=30s is the rule stats.fm and .fmbot use; youtube has no duration.
    and (p.ms_played >= 30000 or p.source = 'youtube')
    and (p_source = 'all'
         or (p_source = 'youtube' and p.source =  'youtube')
         or (p_source = 'spotify' and p.source <> 'youtube'))
  group by p.artist, case when p_mode = 'artists' then null else p.track end
  order by plays desc
  limit p_limit;
$$;

-- ---------- distinct item count ----------
-- top_items is capped by p_limit, so counting its rows undercounts as soon as
-- anyone passes the cap. This counts the real thing.
create or replace function item_count(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_mode text default 'tracks',
  p_tz   text default 'Asia/Seoul',
  p_source text default 'all'
)
returns bigint
language sql stable
set search_path = public, pg_temp
as $$
  select case when p_mode = 'artists'
              then count(distinct p.artist)
              else count(distinct (p.artist, p.track))
         end
  from plays p
  where p.user_id = p_user
    and p.played_at >= p_from
    and p.played_at <  p_to
    and (p.ms_played >= 30000 or p.source = 'youtube')
    and (p_source = 'all'
         or (p_source = 'youtube' and p.source =  'youtube')
         or (p_source = 'spotify' and p.source <> 'youtube'));
$$;

-- ---------- months that hold plays: powers the month picker ----------
-- Listening isn't continuous, so this lists the months that actually have
-- something rather than every month between the first and the last.
create or replace function play_months(
  p_user uuid,
  p_tz text default 'Asia/Seoul',
  p_source text default 'all'
)
returns table (ym text, plays bigint)
language sql stable
set search_path = public, pg_temp
as $$
  select to_char(p.played_at at time zone p_tz, 'YYYY-MM') as ym,
         count(*) as plays
  from plays p
  where p.user_id = p_user
    and (p.ms_played >= 30000 or p.source = 'youtube')
    and (p_source = 'all'
         or (p_source = 'youtube' and p.source =  'youtube')
         or (p_source = 'spotify' and p.source <> 'youtube'))
  group by 1
  order by 1 desc;
$$;

-- ---------- daily totals: powers the summary tiles ----------
create or replace function daily_totals(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_tz   text default 'Asia/Seoul',
  p_source text default 'all'
)
returns table (day date, plays bigint, minutes bigint)
language sql stable
set search_path = public, pg_temp
as $$
  select
    (p.played_at at time zone p_tz)::date as day,
    count(*)                              as plays,
    (sum(p.ms_played) / 60000)::bigint    as minutes
  from plays p
  where p.user_id = p_user
    and p.played_at >= p_from
    and p.played_at <  p_to
    and (p.ms_played >= 30000 or p.source = 'youtube')
    and (p_source = 'all'
         or (p_source = 'youtube' and p.source =  'youtube')
         or (p_source = 'spotify' and p.source <> 'youtube'))
  group by 1
  order by 1;
$$;
