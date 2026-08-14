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

-- Grouping on norm_artist()/norm_track() meant running both over every row on
-- every request. They're immutable, so the results are stored once at write
-- time and indexed instead — 3.8s to 0.46s on ~40k rows.
alter table plays
  add column if not exists artist_key text
    generated always as (norm_artist(artist)) stored,
  add column if not exists track_key text
    generated always as (norm_track(track, artist)) stored;

create index if not exists plays_user_time  on plays (user_id, played_at desc);
create index if not exists plays_user_artist on plays (user_id, artist);
create index if not exists plays_norm_keys  on plays (user_id, artist_key, track_key);
create index if not exists plays_user_time_src on plays (user_id, played_at, source);

-- ---------- cover art ----------
-- Shared across users and immutable, so it lives here rather than on plays.
-- Imported history carries no images; those are filled by searching Spotify
-- once. Misses are stored as null so a fruitless search isn't repeated.
--
-- Tracks are keyed too, not just albums: YouTube history carries no album at
-- all, so those rows have nothing to look up by and would go coverless.
create table if not exists covers (
  kind       text not null,               -- 'album' | 'artist' | 'track'
  artist     text not null,
  name       text not null default '',    -- album, track, or '' for an artist
  image_url  text,
  fetched_at timestamptz not null default now(),
  primary key (kind, artist, name)
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

-- ---------- counted duration ----------
-- YouTube Takeout records that something played but never for how long, so
-- those rows carry ms_played 0. Counting them as zero listening time made the
-- hours figure meaningless once most of the history came from YouTube; a
-- typical track is assumed instead, so 40 plays reads as about 100 minutes.
-- A round number on purpose: it is an assumption, not a measurement.
-- Only imported history carries a measured duration. Live rows store the
-- track's full length because recently-played never says how long it ran,
-- which quietly assumes every play finished; YouTube Takeout gives nothing at
-- all. Both unmeasured sources use the same 2.5 minutes a play, so 40 plays
-- reads as about 100 minutes. A round number on purpose: it is an assumption,
-- not a measurement, and more precision would only look like more truth.
create or replace function play_ms(p_ms integer, p_source text)
returns integer
language sql immutable
set search_path = public, pg_temp
as $$
  select case when p_source = 'import' then coalesce(p_ms, 0) else 150000 end;
$$;

-- ---------- title normalisation ----------
-- The same recording reaches us under different titles: Spotify writes
-- "Lose My Mind (feat. Doja Cat) [From F1(R) The Movie]", YouTube writes
-- "Lose My Mind (feat. Doja Cat)", and the official channel prefixes the
-- artist. Ranking on the raw string splits one song four ways.
--
-- Deliberately narrow. Only qualifiers that leave the recording itself
-- unchanged are dropped -- featured credits, soundtrack attributions,
-- "official video" markers, remaster/edition tags. Remix, live, acoustic,
-- instrumental, slowed, sped up and 8D are different recordings and stay apart.
create or replace function norm_artist(p text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select btrim(regexp_replace(
    regexp_replace(lower(coalesce(p, '')), '\s*-\s*topic$', ''),
    '\s+', ' ', 'g'));
$$;

create or replace function norm_track(p_track text, p_artist text default '')
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  with s0 as (
    -- Unify bracket styles so [From ...] and (From ...) are one shape, and
    -- drop registered marks, which appear inconsistently.
    select regexp_replace(translate(lower(coalesce(p_track, '')), '[]', '()'),
                          '[®™©]', '', 'g') as t,
           norm_artist(p_artist) as a
  ),
  s1 as (
    -- YouTube titles are usually prefixed with the artist.
    select case when a <> '' and t like a || ' - %'
                then substr(t, length(a) + 4)
                else t end as t
    from s0
  ),
  s2 as (
    select regexp_replace(t, '\s*\((feat\.?|ft\.?|featuring|with)\s[^)]*\)', '', 'g') as t
    from s1
  ),
  s3 as (
    select regexp_replace(t, '\s*\(from\s[^)]*\)', '', 'g') as t from s2
  ),
  s4 as (
    select regexp_replace(
      t,
      '\s*\([^)]*(official|music video|lyrics?|visualizer|remaster|deluxe|explicit|clean|bonus|anniversary|edition)[^)]*\)',
      '', 'g') as t
    from s3
  )
  select nullif(btrim(regexp_replace(regexp_replace(t, '\s+', ' ', 'g'),
                                     '[-–—[:space:]]+$', '')), '')
  from s4;
$$;

-- ---------- ranking: mode 'tracks' | 'artists' ----------
create or replace function top_items(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_mode text default 'tracks',
  p_tz   text default 'Asia/Seoul',
  p_limit int default 250,
  p_source text default 'all',
  p_days boolean default false
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
  last_at  timestamptz,
  day_nums integer[]
)
language sql stable
-- search_path is pinned so the function always resolves `plays` in this
-- schema, whatever the caller's search_path happens to be.
set search_path = public, pg_temp
as $$
  select
    -- Rows are grouped on the normalised key, so the label shown is the
    -- variant that actually appears most often.
    mode() within group (order by p.artist)              as artist,
    case when p_mode = 'artists' then null
         else mode() within group (order by p.track) end as track,
    case when p_mode = 'artists' then null
         else (array_agg(p.album order by p.played_at desc)
                 filter (where p.album is not null and p.album <> ''))[1] end as album,
    count(*)                                                as plays,
    count(distinct (p.played_at at time zone p_tz)::date)   as days,
    count(distinct to_char(p.played_at at time zone p_tz, 'IYYY-IW')) as weeks,
    (sum(play_ms(p.ms_played, p.source)) / 60000)::bigint   as minutes,
    min(p.played_at)                                        as first_at,
    max(p.played_at)                                        as last_at,
    -- The days an item actually played. Drawn from the endpoints alone the
    -- span strip fills solid and hides every gap. Only one graph mode needs
    -- it and it is the largest thing in the payload, so it is opt-in.
    case when p_days then
      array_agg(distinct ((p.played_at at time zone p_tz)::date - date '1970-01-01'))
    end                                                     as day_nums
  from plays p
  where p.user_id = p_user
    and p.played_at >= p_from
    and p.played_at <  p_to
    -- >=30s is the rule stats.fm and .fmbot use; youtube has no duration.
    and (p.ms_played >= 30000 or p.source = 'youtube')
    and (p_source = 'all'
         or (p_source = 'youtube' and p.source =  'youtube')
         or (p_source = 'spotify' and p.source <> 'youtube'))
  group by p.artist_key,
           case when p_mode = 'artists' then null else p.track_key end
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
              then count(distinct p.artist_key)
              else count(distinct (p.artist_key, p.track_key))
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

-- ---------- days that hold plays: powers the year/month/day picker ----------
-- Listening isn't continuous, so this lists the days that actually have
-- something. The client derives years and months from the same list, which is
-- what stops the picker ever offering an empty date.
create or replace function play_calendar(
  p_user uuid,
  p_tz text default 'Asia/Seoul',
  p_source text default 'all'
)
returns table (day date, plays bigint)
language sql stable
set search_path = public, pg_temp
as $$
  select (p.played_at at time zone p_tz)::date as day,
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
    (sum(play_ms(p.ms_played, p.source)) / 60000)::bigint as minutes
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
