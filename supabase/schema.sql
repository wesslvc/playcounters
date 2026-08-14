-- ============================================================
--  Scrobble dashboard — schema
--  Run this once in Supabase → SQL Editor.
-- ============================================================

create extension if not exists "pgcrypto";

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

-- What one logged play is worth once the YouTube estimate is applied, and how
-- long it ran. Both are 1 and 0 until apply_youtube_estimate writes them, which
-- is what makes the estimate flag a no-op for anyone who never calibrated.
alter table plays
  add column if not exists est_plays numeric not null default 1,
  add column if not exists est_ms    numeric not null default 0;

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

-- ---------- YouTube calibration ----------
-- Takeout logs one entry per listening session however many times a track
-- actually repeated inside it, so its play counts run far below the truth.
-- YouTube Music Recap does not: it reports total listening time for a year, and
-- the minutes for the handful of tracks it names. Those figures are the only
-- outside measurement of what the export lost, so they are stored and the
-- missing plays are worked back from them.
--
-- One row per calibrated window: what Recap said the year came to, and the
-- average track length it implies.
create table if not exists yt_estimate (
  user_id       uuid not null references users(id) on delete cascade,
  window_start  date not null,
  window_end    date not null,          -- exclusive
  total_minutes integer not null,
  avg_track_min numeric not null default 2.85,
  created_at    timestamptz not null default now(),
  primary key (user_id, window_start)
);

-- What one track really came to over one window, as the listener knows it --
-- either from a Recap card naming its minutes, or from remembering the month
-- ("that March I played it about fifty times"). A remembered count is the
-- measurement, so it can be stated directly rather than derived from minutes
-- through a track length nobody has.
--
-- The window is the anchor's own, not borrowed from yt_estimate: most of what
-- is worth anchoring falls outside any Recap year.
create table if not exists yt_anchor (
  user_id      uuid not null references users(id) on delete cascade,
  window_start date not null,
  window_end   date not null,          -- exclusive
  artist_key   text not null,
  track_key    text not null,
  plays        numeric,                -- either this...
  minutes      integer,                -- ...or this; the other follows
  track_min    numeric,                -- the track's real length, if known
  primary key (user_id, window_start, artist_key, track_key),
  constraint yt_anchor_has_a_measurement
    check (plays is not null or minutes is not null)
);

-- Row level security: everything goes through the service role on the
-- server, so no anon policies are needed. RLS on = nothing leaks if the
-- publishable key is ever used from the browser.
alter table users enable row level security;
alter table plays enable row level security;
alter table covers enable row level security;
alter table yt_estimate enable row level security;
alter table yt_anchor enable row level security;

-- ============================================================
--  Reading functions
--
--  p_source: 'all' | 'spotify' (live + import) | 'youtube'
--
--  p_estimate: whether to read YouTube's calibrated figures or its raw ones.
--
--  YouTube Takeout records that something played but never for how long, and
--  logs one entry per session however many times a track repeated inside it.
--  Both gaps are filled after an import rather than at read time —
--  recompute_youtube_ms for the duration, apply_youtube_estimate for the
--  count — so the readers below stay plain aggregation. The >=30s rule still
--  can't apply to youtube rows, since a Takeout row's duration is inferred
--  rather than measured. p_source exists because the two platforms are not
--  measured the same way and shouldn't be forced into one number without the
--  reader's say-so.
-- ============================================================

-- ---------- counted duration ----------
-- Takeout records when each track started and nothing else, but the next
-- entry's start time is when this one stopped — so the gap between consecutive
-- plays recovers the duration the export withholds. recompute_youtube_ms fills
-- it in after an import; past a ten-minute gap the session simply ended and a
-- typical track length stands in.
-- Live rows carry the track's own length. recently-played only surfaces a
-- play once it has run past 30 seconds, so these are never skips, and a real
-- duration keeps per-track variation that an average would flatten. It still
-- assumes the play finished, so it is an upper bound, not a measurement.
--
-- YouTube rows once carried a flat 2.5 minutes here. They no longer need to:
-- recompute_youtube_ms writes a real gap-derived duration into ms_played after
-- every import, so every source now reads the same way.
create or replace function play_ms(p_ms integer, p_source text)
returns integer
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_ms, 0);
$$;

-- Fills in the durations Takeout withholds. The next entry's start time is when
-- this one stopped; past a ten-minute gap the session simply ended and a
-- typical track length stands in. Run once after an import completes, since it
-- needs the whole history in place to see the gaps.
create or replace function recompute_youtube_ms(p_user uuid)
returns bigint
language plpgsql
set search_path = public, pg_temp
as $$
declare
  touched bigint;
begin
  with seq as (
    select p.user_id, p.played_at,
           lead(p.played_at) over (partition by p.user_id order by p.played_at)
             - p.played_at as gap
    from plays p
    where p.user_id = p_user and p.source = 'youtube'
  )
  update plays t
     set ms_played = case
           when s.gap is null or s.gap > interval '10 minutes' then 150000
           else greatest(0, least(600000, extract(epoch from s.gap) * 1000))::integer
         end
    from seq s
   where t.user_id = s.user_id
     and t.played_at = s.played_at
     and t.source = 'youtube';

  get diagnostics touched = row_count;
  return touched;
end;
$$;

-- ---------- the YouTube estimate ----------
-- Takeout logs one entry per listening session however many times a track
-- repeated inside it, so its play counts are floors rather than counts. The
-- estimate only ever raises a figure it has a measurement for:
--
--  * An anchored track gets its plays back. Recap put Lose My Mind at 1,272
--    minutes for the year; at 3.22 minutes a play that is 395 plays where the
--    export logged 138 entries.
--
--  * Everything else keeps the count it already had. Those counts are floors
--    too -- the same collapsing happened to them -- but nothing measures by how
--    much, and a guess dressed as a correction is worse than the floor.
--
-- An earlier revision treated Recap's yearly total as a budget for play counts,
-- dividing what the anchors left over among the rest. That deflated every track
-- Recap never named, on the strength of a number that does not measure what it
-- was being asked to measure: listening time over an average track length is
-- not a play count, since a logged entry that ran forty seconds is one entry
-- either way. So the total now rises by exactly what was recovered, and every
-- untouched track keeps its place.
--
-- Minutes are the one figure Recap does measure directly, so unanchored
-- durations are scaled by how far the gap heuristic ran from it -- about 21%
-- high on this history. One ratio across all of them, which leaves their
-- proportions to each other exactly as they were.
--
-- Both halves are written onto each play: est_plays is what that one logged
-- entry stood for, est_ms how long it ran. Storing the duration per play rather
-- than multiplying by an average afterwards is what lets an anchored track
-- report back exactly the minutes it was given.
--
-- What this cannot do is recover loops for a track nobody anchored. No
-- measurement could: a song looped for forty minutes and a song played once
-- before walking away leave the same single entry and the same forty-minute
-- gap.
--
-- Returns the duration bias measured against Recap.
create or replace function apply_youtube_estimate(p_user uuid)
returns numeric
language plpgsql
set search_path = public, pg_temp
as $$
declare
  bias numeric;
begin
  -- Reset, so a re-run is not cumulative. This is also the resting state: one
  -- play per entry and the recorded duration, i.e. exactly the raw figures.
  update plays set est_plays = 1, est_ms = ms_played
   where user_id = p_user and source = 'youtube';

  if not exists (select 1 from yt_anchor where user_id = p_user)
     and not exists (select 1 from yt_estimate where user_id = p_user) then
    return 1;
  end if;

  --------------------------------------------------------------- anchors
  -- Each anchor states what one track really came to over its own window,
  -- either as a play count or as minutes. Whichever was given, the other
  -- follows from the track's length, and both are spread evenly across the
  -- entries the export did log for that track in that window.
  with target as (
    select a.*,
           coalesce(a.track_min,
                    (select y.avg_track_min from yt_estimate y
                      where y.user_id = a.user_id
                        and a.window_start >= y.window_start
                        and a.window_start <  y.window_end
                      limit 1),
                    2.85) as len
    from yt_anchor a
    where a.user_id = p_user
  ),
  counted as (
    select t.*, count(p.*) as entries,
           coalesce(t.plays, t.minutes / nullif(t.len, 0))     as want_plays,
           coalesce(t.minutes, t.plays * t.len)                as want_min
    from target t
    join plays p
      on p.user_id = p_user and p.source = 'youtube'
     and p.artist_key = t.artist_key and p.track_key = t.track_key
     and p.played_at >= t.window_start and p.played_at < t.window_end
    group by t.user_id, t.window_start, t.window_end, t.artist_key, t.track_key,
             t.minutes, t.track_min, t.plays, t.len
  )
  update plays p
     set est_plays = greatest(0.01, c.want_plays / c.entries),
         est_ms    = c.want_min * 60000 / c.entries
    from counted c
   where p.user_id = p_user and p.source = 'youtube'
     and p.artist_key = c.artist_key and p.track_key = c.track_key
     and p.played_at >= c.window_start and p.played_at < c.window_end;

  ---------------------------------------------------- duration correction
  -- Recap's yearly total, less what the anchors inside it already claim,
  -- against what the gap heuristic made of the remaining entries. It measures
  -- the heuristic rather than the year, so it applies wherever the heuristic
  -- was used -- inside a Recap window or not.
  select coalesce(
           (select sum(y.total_minutes) from yt_estimate y where y.user_id = p_user)
           - coalesce((select sum(coalesce(a.minutes, a.plays * coalesce(a.track_min, 2.85)))
                         from yt_anchor a
                        where a.user_id = p_user
                          and exists (select 1 from yt_estimate y
                                       where y.user_id = p_user
                                         and a.window_start >= y.window_start
                                         and a.window_start <  y.window_end)), 0),
           0)
         * 60000.0
         / nullif(sum(p.ms_played), 0)
    into bias
  from plays p
  join yt_estimate y
    on y.user_id = p_user
   and p.played_at >= y.window_start and p.played_at < y.window_end
  where p.user_id = p_user and p.source = 'youtube'
    and not exists (select 1 from yt_anchor a
                     where a.user_id = p_user
                       and a.artist_key = p.artist_key and a.track_key = p.track_key
                       and p.played_at >= a.window_start and p.played_at < a.window_end);

  bias := coalesce(bias, 1);

  -- Play counts are untouched here: an unanchored track keeps the count it
  -- already had.
  update plays p
     set est_ms = p.ms_played * bias
   where p.user_id = p_user and p.source = 'youtube'
     and not exists (select 1 from yt_anchor a
                      where a.user_id = p_user
                        and a.artist_key = p.artist_key and a.track_key = p.track_key
                        and p.played_at >= a.window_start and p.played_at < a.window_end);

  ------------------------------------------ anchored tracks, unmeasured months
  -- A month that no anchor and no Recap window reaches is still the same song
  -- listened to much the same way, so it takes that track's own measured worth
  -- per entry rather than falling back to one play per entry. Only where the
  -- anchored sample is big enough to mean something: a rate read off a handful
  -- would be multiplied across a whole untouched stretch.
  --
  -- Kept out of the measured windows deliberately. A track anchored only in
  -- April has a rate, and letting a stray entry of it inside the Recap year
  -- pick that rate up overwrote minutes the duration correction had already
  -- balanced against Recap's total, pushing the year past it.
  with rate as (
    select p.artist_key, p.track_key,
           sum(p.est_plays) / count(*) as plays_per_entry,
           sum(p.est_ms)    / count(*) as ms_per_entry
    from plays p
    where p.user_id = p_user and p.source = 'youtube'
      and exists (select 1 from yt_anchor a
                   where a.user_id = p_user
                     and a.artist_key = p.artist_key and a.track_key = p.track_key
                     and p.played_at >= a.window_start and p.played_at < a.window_end)
    group by 1, 2
    having count(*) >= 10
  )
  update plays p
     set est_plays = greatest(0.01, r.plays_per_entry),
         est_ms    = r.ms_per_entry
    from rate r
   where p.user_id = p_user and p.source = 'youtube'
     and p.artist_key = r.artist_key and p.track_key = r.track_key
     and not exists (select 1 from yt_anchor a
                      where a.user_id = p_user
                        and a.artist_key = p.artist_key and a.track_key = p.track_key
                        and p.played_at >= a.window_start and p.played_at < a.window_end)
     and not exists (select 1 from yt_estimate y
                      where y.user_id = p_user
                        and p.played_at >= y.window_start
                        and p.played_at <  y.window_end);

  return bias;
end;
$$;

-- Whether this user has a calibration at all. The dashboard only offers the
-- estimate when there is something real behind it.
create or replace function has_youtube_estimate(p_user uuid)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from yt_estimate where user_id = p_user);
$$;

-- ---------- ranking: mode 'tracks' | 'artists' ----------
-- p_estimate swaps counted plays for calibrated ones. Every reader also returns
-- `yt`, saying whether YouTube plays went into that number — without it the
-- client would have to mark a Spotify-only row as an estimate or leave a
-- reconstructed one unmarked.
-- Earlier signatures, retired: PostgREST resolves by named argument, and
-- leaving two candidates that differ only by p_estimate invites the wrong one.
drop function if exists top_items(uuid, timestamptz, timestamptz, text, text, int, text);
drop function if exists top_items(uuid, timestamptz, timestamptz, text, text, int, text, boolean);

create or replace function top_items(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_mode text default 'tracks',
  p_tz   text default 'Asia/Seoul',
  p_limit int default 250,
  p_source text default 'all',
  p_days boolean default false,
  p_estimate boolean default false
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
  day_nums integer[],
  yt       boolean
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
    (case when p_estimate then round(sum(p.est_plays))
          else count(*) end)::bigint                        as plays,
    count(distinct (p.played_at at time zone p_tz)::date)   as days,
    count(distinct to_char(p.played_at at time zone p_tz, 'IYYY-IW')) as weeks,
    (sum(case when p_estimate and p.source = 'youtube' and p.est_ms > 0
              then p.est_ms
              else play_ms(p.ms_played, p.source) end) / 60000)::bigint as minutes,
    min(p.played_at)                                        as first_at,
    max(p.played_at)                                        as last_at,
    -- The days an item actually played. Drawn from the endpoints alone the
    -- span strip fills solid and hides every gap. Only one graph mode needs
    -- it and it is the largest thing in the payload, so it is opt-in.
    case when p_days then
      array_agg(distinct ((p.played_at at time zone p_tz)::date - date '1970-01-01'))
    end                                                     as day_nums,
    bool_or(p.source = 'youtube')                           as yt
  from plays p
  where p.user_id = p_user
    and p.played_at >= p_from
    and p.played_at <  p_to
    -- >=30s is the rule stats.fm and .fmbot use. YouTube is exempt: Takeout
    -- already collapses repeats, so filtering it further compounds an
    -- undercount with another one.
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
drop function if exists daily_totals(uuid, timestamptz, timestamptz, text, text);

create or replace function daily_totals(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_tz   text default 'Asia/Seoul',
  p_source text default 'all',
  p_estimate boolean default false
)
returns table (day date, plays bigint, minutes bigint, yt boolean)
language sql stable
set search_path = public, pg_temp
as $$
  select
    (p.played_at at time zone p_tz)::date as day,
    (case when p_estimate then round(sum(p.est_plays))
          else count(*) end)::bigint      as plays,
    (sum(case when p_estimate and p.source = 'youtube' and p.est_ms > 0
              then p.est_ms
              else play_ms(p.ms_played, p.source) end) / 60000)::bigint as minutes,
    bool_or(p.source = 'youtube')         as yt
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

-- ---------- one item's own history: powers the detail sheet ----------
-- Resolved through the same normalisation the ranking uses, so it covers every
-- title variant that was merged into that row.
drop function if exists item_daily(uuid, text, text, text, text);

create or replace function item_daily(
  p_user uuid,
  p_artist text,
  p_track text default null,
  p_tz text default 'Asia/Seoul',
  p_source text default 'all',
  p_estimate boolean default false
)
returns table (day date, plays bigint, minutes bigint, yt boolean)
language sql stable
set search_path = public, pg_temp
as $$
  select (p.played_at at time zone p_tz)::date,
         (case when p_estimate then round(sum(p.est_plays))
               else count(*) end)::bigint,
         (sum(case when p_estimate and p.source = 'youtube' and p.est_ms > 0
                   then p.est_ms
                   else play_ms(p.ms_played, p.source) end) / 60000)::bigint,
         bool_or(p.source = 'youtube')
  from plays p
  where p.user_id = p_user
    and p.artist_key = norm_artist(p_artist)
    and (p_track is null or p.track_key = norm_track(p_track, p_artist))
    and (p.ms_played >= 30000 or p.source = 'youtube')
    and (p_source = 'all'
         or (p_source = 'youtube' and p.source =  'youtube')
         or (p_source = 'spotify' and p.source <> 'youtube'))
  group by 1
  order by 1;
$$;

-- ---------- monthly shape of the leaders: powers the trend chart ----------
-- Spans the whole history rather than the selected window: the point is
-- watching the top few rise and fall against each other, which one month can't
-- show. The label is decided once per item in `labelled` rather than per
-- bucket — deciding it per bucket split one song into two lines wherever the
-- most common spelling changed part-way through.
drop function if exists top_trend(uuid, text, text, text, integer);

create or replace function top_trend(
  p_user uuid,
  p_mode text default 'tracks',
  p_tz text default 'Asia/Seoul',
  p_source text default 'all',
  p_limit integer default 5,
  p_estimate boolean default false
)
returns table (artist text, track text, bucket date, plays bigint, yt boolean)
language sql stable
set search_path = public, pg_temp
as $$
  with kept as (
    select p.artist_key, case when p_mode = 'artists' then null else p.track_key end as tk,
           (case when p_estimate then round(sum(p.est_plays))
                 else count(*) end)::bigint as n
    from plays p
    where p.user_id = p_user
      and (p.ms_played >= 30000 or p.source = 'youtube')
      and (p_source = 'all'
           or (p_source = 'youtube' and p.source =  'youtube')
           or (p_source = 'spotify' and p.source <> 'youtube'))
    group by 1, 2 order by n desc limit p_limit
  ),
  labelled as (
    select p.artist_key, case when p_mode = 'artists' then null else p.track_key end as tk,
           mode() within group (order by p.artist) as artist,
           case when p_mode = 'artists' then null
                else mode() within group (order by p.track) end as track
    from plays p
    join kept k on k.artist_key = p.artist_key
               and (p_mode = 'artists' or k.tk = p.track_key)
    where p.user_id = p_user
      and (p.ms_played >= 30000 or p.source = 'youtube')
      and (p_source = 'all'
           or (p_source = 'youtube' and p.source =  'youtube')
           or (p_source = 'spotify' and p.source <> 'youtube'))
    group by 1, 2
  )
  select l.artist, l.track,
         date_trunc('month', p.played_at at time zone p_tz)::date,
         (case when p_estimate then round(sum(p.est_plays))
               else count(*) end)::bigint,
         bool_or(p.source = 'youtube')
  from plays p
  join labelled l on l.artist_key = p.artist_key
                 and (p_mode = 'artists' or l.tk = p.track_key)
  where p.user_id = p_user
    and (p.ms_played >= 30000 or p.source = 'youtube')
    and (p_source = 'all'
         or (p_source = 'youtube' and p.source =  'youtube')
         or (p_source = 'spotify' and p.source <> 'youtube'))
  group by l.artist, l.track, 3
  order by 3;
$$;
