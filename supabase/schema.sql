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
    -- The artist is often glued to the title, but not always on the same
    -- side: "Artist - Song" is common, and so is "Song - Artist" (a lot of
    -- topic-channel and single uploads go this way round). Checked both
    -- ways, or a track whose title happens to end the same way a collab's
    -- credit list starts splits into two rows for no audible reason —
    -- exactly what happened to "Lose My Mind - Justin Bieber, Don Toliver"
    -- next to a plain "Lose My Mind" from another source.
    select case
      when a <> '' and t like a || ' - %'   then substr(t, length(a) + 4)
      when a <> '' and t like '% - ' || a   then substr(t, 1, length(t) - length(a) - 3)
      else t
    end as t
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

-- ---------- genres ----------
-- One row per artist, serving every track they appear on. Shared across users
-- and effectively immutable, like covers.
--
-- Spotify used to file genres on the artist and stopped in early 2026 — the
-- field is absent from search results and null from the artist endpoint — so
-- these come from Deezer, which files genre on the album. An artist's genre is
-- the one most of their albums carry.
--
-- `genre` is the name as given ("Rap/Hip Hop"); `family` is the coarse bucket
-- the UI colors by, resolved once here so the client never has to. A lookup
-- that matched nothing is stored too — genre null, family 'other' — so an
-- artist nobody can place is not looked up again on every scroll. To retry
-- those later: delete from artist_genres where genre is null;
create table if not exists artist_genres (
  artist     text primary key,
  genre      text,
  family     text not null default 'other',
  fetched_at timestamptz not null default now()
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
alter table artist_genres enable row level security;
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
-- Live rows: recently-played reports no listening time, and it does log
-- skips and scrubs — one 176-second track showed up nine times in four and
-- a half minutes, entries 7-13 seconds apart. recompute_live_ms bounds each
-- live play by the gap since the previous live play (played_at is when the
-- play ended), capped at the track's own length, so the >=30s rule drops
-- those the same way it drops short plays from an export.
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

-- The track's full length for a live play, kept apart from ms_played so the
-- listened-time bound below can always be recomputed from the original.
alter table plays add column if not exists track_ms integer;

-- Bounds each live play's listened time by the gap since the previous live
-- play — the previous one had to end before this one could — capped at the
-- track's length. Only rows from p_since on are rewritten; the extra day of
-- history read before it is just there to supply their previous play.
create or replace function recompute_live_ms(p_user uuid, p_since timestamptz default '-infinity')
returns bigint
language plpgsql
set search_path = public, pg_temp
as $$
declare
  touched bigint;
begin
  with seq as (
    select p.played_at,
           p.played_at - lag(p.played_at) over (order by p.played_at) as gap
    from plays p
    where p.user_id = p_user and p.source = 'live'
      and p.played_at >= p_since - interval '1 day'
  )
  update plays t
     set ms_played = least(t.track_ms,
                           coalesce(extract(epoch from s.gap) * 1000, t.track_ms))::integer
    from seq s
   where t.user_id = p_user
     and t.source = 'live'
     and t.played_at = s.played_at
     and t.played_at >= p_since
     and t.track_ms is not null;

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
drop function if exists top_items(uuid, timestamptz, timestamptz, text, text, int, text, boolean, boolean);

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
  yt       boolean,
  -- The normalised identity, not just the display label. Every reader that
  -- groups rows across more than one call to this function — the season
  -- standings chief among them, one call per month — needs this: the mode()
  -- label above can pick a different surface variant in different months
  -- even when the underlying recording is the same one, and matching on
  -- that label instead of the key it was chosen from is what let one song
  -- split back into two rows the moment two calls disagreed on wording.
  artist_key text,
  track_key  text
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
    bool_or(p.source = 'youtube')                           as yt,
    p.artist_key                                            as artist_key,
    case when p_mode = 'artists' then null else p.track_key end as track_key
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
  -- Tie-broken on the grouping key itself, not just plays: the API layer now
  -- pages through results past its own row cap with range requests, and a tie
  -- on plays alone would let Postgres hand back a different arrangement
  -- across separate calls, skipping or repeating a row at the page boundary.
  order by plays desc, p.artist_key,
           case when p_mode = 'artists' then null else p.track_key end
  limit p_limit;
$$;

-- ---------- where the shown rows stood in the window before ----------
-- Every item of the previous window ranked on each metric the list sorts by,
-- returned only for the artists on screen. Ranked over the whole window, so a
-- song that was 3,000th last year and 3rd this year shows ▲2997 without the
-- list ever being unfolded that far. Ranks follow the list's own rules: by
-- plays the same total reached later places ahead (a Grand Prix finish);
-- the other metrics tie on their value alone.
create or replace function prev_ranks(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_mode text default 'tracks',
  p_tz   text default 'Asia/Seoul',
  p_source text default 'all',
  p_estimate boolean default false,
  p_artists text[] default '{}'
)
returns table (
  artist_key text,
  track_key  text,
  r_plays    int,
  r_days     int,
  r_weeks    int,
  r_minutes  int
)
language sql stable
set search_path = public, pg_temp
as $$
  select s.artist_key, s.track_key, s.r_plays, s.r_days, s.r_weeks, s.r_minutes
  from (
    select t.artist_key, t.track_key,
           rank() over (order by t.plays desc, t.last_at desc)::int as r_plays,
           rank() over (order by t.days desc)::int                  as r_days,
           rank() over (order by t.weeks desc)::int                 as r_weeks,
           rank() over (order by t.minutes desc)::int               as r_minutes
    from top_items(p_user, p_from, p_to, p_mode, p_tz, 2147483647, p_source, false, p_estimate) t
  ) s
  where s.artist_key = any(p_artists);
$$;

-- ---------- one item's rank, period by period ----------
-- Where a song (or an artist, with p_track_key null) stood in every year and
-- every month it was heard, and where it stood all-time at the end of each
-- month since it first played. Ranked the way the list ranks by plays: the
-- same total reached later places ahead. `items` is how many were ranked.
create or replace function item_ranks(
  p_user uuid,
  p_artist_key text,
  p_track_key text default null,
  p_tz text default 'Asia/Seoul',
  p_source text default 'all',
  p_estimate boolean default false
)
returns table (kind text, period date, rank int, plays numeric, items int)
language sql stable
set search_path = public, pg_temp
set jit = off
as $$
  with p as (
    select p.artist_key as ak,
           case when p_track_key is null then null else p.track_key end as tk,
           date_trunc('month', p.played_at at time zone p_tz)::date as m,
           case when p_estimate then p.est_plays else 1 end as w,
           p.played_at
    from plays p
    where p.user_id = p_user
      and (p.ms_played >= 30000 or p.source = 'youtube')
      and (p_source = 'all'
           or (p_source = 'youtube' and p.source =  'youtube')
           or (p_source = 'spotify' and p.source <> 'youtube'))
  ),
  mi as (select ak, tk, m, sum(w) as n, max(played_at) as last_at from p group by 1, 2, 3),
  -- a period's ranking over rounded totals, as the list shows them
  monthly as (
    select 'month'::text as kind, m as period, ak, tk, round(n) as plays,
           rank() over (partition by m order by round(n) desc, last_at desc)::int as rank,
           count(*) over (partition by m)::int as items
    from mi
  ),
  yi as (select ak, tk, date_trunc('year', m)::date as y, sum(n) as n, max(last_at) as last_at
         from mi group by 1, 2, 3),
  yearly as (
    select 'year'::text, y, ak, tk, round(n),
           rank() over (partition by y order by round(n) desc, last_at desc)::int,
           count(*) over (partition by y)::int
    from yi
  ),
  -- all-time standing at each month's end: every item carried forward from
  -- its first month, so one that went quiet still holds its place
  months as (select distinct m from mi),
  firsts as (select ak, tk, min(m) as m0 from mi group by 1, 2),
  dense as (
    select f.ak, f.tk, mo.m,
           sum(coalesce(mi.n, 0)) over w as cum,
           max(mi.last_at) over w as last_at
    from firsts f
    join months mo on mo.m >= f.m0
    left join mi on mi.ak = f.ak and mi.tk is not distinct from f.tk and mi.m = mo.m
    window w as (partition by f.ak, f.tk order by mo.m)
  ),
  alltime as (
    select 'all'::text, m, ak, tk, round(cum),
           rank() over (partition by m order by round(cum) desc, last_at desc)::int,
           count(*) over (partition by m)::int
    from dense
  )
  select kind, period, rank, plays, items from (
    select * from monthly union all select * from yearly union all select * from alltime
  ) r
  where r.ak = p_artist_key and r.tk is not distinct from p_track_key
  order by kind, period;
$$;

-- ---------- what an artist's plays were, song by song ----------
-- Each song's share of everything heard by that artist — the breakdown
-- behind the 1000 Club's 최애곡 비중. One artist's plays only, read when
-- asked for rather than inside play_records. p_mark is unused, kept so
-- existing callers still resolve.
create or replace function club_songs(
  p_user uuid,
  p_artist_key text,
  p_source text default 'all',
  p_estimate boolean default false,
  p_mark int default 1000
)
returns table (track text, plays numeric, pct numeric)
language sql stable
set search_path = public, pg_temp
as $$
  with p as (
    select p.track, p.track_key as tk,
           case when p_estimate then p.est_plays else 1 end as w
    from plays p
    where p.user_id = p_user and p.artist_key = p_artist_key
      and (p.ms_played >= 30000 or p.source = 'youtube')
      and (p_source = 'all'
           or (p_source = 'youtube' and p.source =  'youtube')
           or (p_source = 'spotify' and p.source <> 'youtube'))
  )
  select mode() within group (order by p.track), round(sum(p.w)),
         round(100.0 * sum(p.w) / (select sum(w) from p), 1)
  from p
  group by p.tk
  order by sum(p.w) desc;
$$;

-- ---------- season races, all months in one pass ----------
-- The championship used to call top_items once per month — an all-time
-- standings is easily a hundred round trips, each shipping up to 200 rows
-- of which ten scored. This buckets by month itself and keeps only each
-- month's top ten, so the whole season is one query and about a thousand
-- rows. Ordering matches the old per-month ranking: plays, then whoever
-- reached that total later placing ahead (last_at desc).
drop function if exists season_races(uuid, timestamptz, timestamptz, text, text, text, boolean);

create or replace function season_races(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_mode text default 'tracks',
  p_tz   text default 'Asia/Seoul',
  p_source text default 'all',
  p_estimate boolean default false
)
returns table (
  yr       int,
  mo       int,
  place    int,
  artist   text,
  track    text,
  plays    bigint,
  last_at  timestamptz,
  yt       boolean,
  artist_key text,
  track_key  text,
  -- Months in the range this item had any counted play at all — the races
  -- it finished, scoring or not — and, for its artist, the same summed over
  -- every one of the artist's tracks (each track is a car). Only the top
  -- ten come back as rows, so neither can be counted from them.
  entries        int,
  artist_entries int
)
language sql stable
set search_path = public, pg_temp
as $$
  with g as (
    select
      extract(year  from p.played_at at time zone p_tz)::int as yr,
      extract(month from p.played_at at time zone p_tz)::int as mo,
      mode() within group (order by p.artist)              as artist,
      case when p_mode = 'artists' then null
           else mode() within group (order by p.track) end as track,
      (case when p_estimate then round(sum(p.est_plays))
            else count(*) end)::bigint                     as plays,
      max(p.played_at)                                     as last_at,
      bool_or(p.source = 'youtube')                        as yt,
      p.artist_key                                         as artist_key,
      case when p_mode = 'artists' then null else p.track_key end as track_key
    from plays p
    where p.user_id = p_user
      and p.played_at >= p_from
      and p.played_at <  p_to
      and (p.ms_played >= 30000 or p.source = 'youtube')
      and (p_source = 'all'
           or (p_source = 'youtube' and p.source =  'youtube')
           or (p_source = 'spotify' and p.source <> 'youtube'))
    group by 1, 2, p.artist_key,
             case when p_mode = 'artists' then null else p.track_key end
  ),
  ranked as (
    select g.*,
           rank() over (partition by g.yr, g.mo
                        order by g.plays desc, g.last_at desc)::int as place,
           count(*) over (partition by g.artist_key, g.track_key)::int as entries
    from g
  ),
  a as (
    select artist_key, count(*)::int as artist_entries
    from g
    group by artist_key
  )
  select r.yr, r.mo, r.place, r.artist, r.track, r.plays, r.last_at, r.yt,
         r.artist_key, r.track_key, r.entries, a.artist_entries
  from ranked r
  join a on a.artist_key = r.artist_key
  where r.place <= 10
  -- Fully ordered, ties included, because the API pages through this with
  -- range requests and needs the same arrangement on every call.
  order by r.yr, r.mo, r.place, r.artist_key, r.track_key;
$$;

-- ---------- race leader, day by day ----------
-- Who led a month's running total at the end of each day it had plays —
-- the Grand Prix's lap-leader chart. Same tie rule as the race result:
-- equal totals go to whoever reached that total later. One row per day
-- with plays; a day without plays keeps the previous day's leader.
drop function if exists month_leaders(uuid, timestamptz, timestamptz, text, text, text, boolean);

create or replace function month_leaders(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_mode text default 'tracks',
  p_tz   text default 'Asia/Seoul',
  p_source text default 'all',
  p_estimate boolean default false
)
returns table (
  day        date,
  artist_key text,
  track_key  text,
  plays      numeric,
  runner_up  numeric
)
language sql stable
set search_path = public, pg_temp
as $$
  with d as (
    select
      (p.played_at at time zone p_tz)::date                       as day,
      p.artist_key                                                as ak,
      case when p_mode = 'artists' then null else p.track_key end as tk,
      (case when p_estimate then sum(p.est_plays)
            else count(*) end)::numeric                           as plays,
      max(p.played_at)                                            as last_at
    from plays p
    where p.user_id = p_user
      and p.played_at >= p_from
      and p.played_at <  p_to
      and (p.ms_played >= 30000 or p.source = 'youtube')
      and (p_source = 'all'
           or (p_source = 'youtube' and p.source =  'youtube')
           or (p_source = 'spotify' and p.source <> 'youtube'))
    group by 1, 2, 3
  ),
  c as (
    select day, ak, tk,
           sum(plays) over w     as cum,
           max(last_at) over w   as last_at
    from d
    window w as (partition by ak, tk order by day)
  ),
  days as (select distinct day from d)
  select dd.day, l.ak, l.tk, l.cum, l.second
  from days dd
  cross join lateral (
    select x.ak, x.tk, x.cum,
           lead(x.cum) over (order by x.cum desc, x.last_at desc, x.ak, x.tk) as second
    from (
      select distinct on (c.ak, c.tk) c.ak, c.tk, c.cum, c.last_at
      from c
      where c.day <= dd.day
      order by c.ak, c.tk, c.day desc
    ) x
    order by x.cum desc, x.last_at desc, x.ak, x.tk
    limit 1
  ) l
  order by dd.day;
$$;

-- ---------- merging duplicates ----------
-- The same artist can arrive under two names (빈지노 / Beenzino — YouTube and
-- Spotify name them differently), and the same song under two titles. An
-- alias maps a variant's key onto the key it should count as. plays'
-- artist_key/track_key were generated columns; they're kept by a trigger
-- now, which applies the aliases, so every query reading the keys sees a
-- merge without being rewritten.
create table if not exists artist_aliases (
  alias_key     text primary key,
  canonical_key text not null
);
create table if not exists track_aliases (
  artist_key    text not null,   -- the canonical artist's key
  alias_key     text not null,
  canonical_key text not null,
  primary key (artist_key, alias_key)
);
alter table artist_aliases enable row level security;
alter table track_aliases  enable row level security;

create or replace function resolve_artist_key(p_artist text)
returns text
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce((select canonical_key from artist_aliases where alias_key = norm_artist(p_artist)),
                  norm_artist(p_artist));
$$;

create or replace function resolve_track_key(p_track text, p_artist text)
returns text
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce((select canonical_key from track_aliases
                    where artist_key = resolve_artist_key(p_artist)
                      and alias_key  = norm_track(p_track, p_artist)),
                  norm_track(p_track, p_artist));
$$;

alter table plays alter column artist_key drop expression if exists;
alter table plays alter column track_key  drop expression if exists;

create or replace function plays_set_keys()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.artist_key := resolve_artist_key(new.artist);
  new.track_key  := resolve_track_key(new.track, new.artist);
  return new;
end;
$$;

drop trigger if exists plays_set_keys on plays;
create trigger plays_set_keys
  before insert or update of artist, track on plays
  for each row execute function plays_set_keys();

-- Count every play under p_from_key as p_into_key from now on, past plays
-- included. Returns how many plays moved.
create or replace function merge_artist(p_from_key text, p_into_key text)
returns bigint
language plpgsql
set search_path = public, pg_temp
as $$
declare
  n bigint;
begin
  if p_from_key = p_into_key then return 0; end if;
  insert into artist_aliases values (p_from_key, p_into_key)
    on conflict (alias_key) do update set canonical_key = excluded.canonical_key;
  update artist_aliases set canonical_key = p_into_key where canonical_key = p_from_key;
  insert into track_aliases (artist_key, alias_key, canonical_key)
    select p_into_key, alias_key, canonical_key from track_aliases where artist_key = p_from_key
    on conflict do nothing;
  delete from track_aliases where artist_key = p_from_key;
  update plays set artist = artist where artist_key = p_from_key;
  get diagnostics n = row_count;
  delete from track_credits where artist_key = p_from_key;
  return n;
end;
$$;

-- Same for one song of one artist: plays under p_from_key count as
-- p_into_key. Returns how many plays moved.
create or replace function merge_track(p_artist_key text, p_from_key text, p_into_key text)
returns bigint
language plpgsql
set search_path = public, pg_temp
as $$
declare
  n bigint;
begin
  if p_from_key = p_into_key then return 0; end if;
  insert into track_aliases values (p_artist_key, p_from_key, p_into_key)
    on conflict (artist_key, alias_key) do update set canonical_key = excluded.canonical_key;
  update track_aliases set canonical_key = p_into_key
   where artist_key = p_artist_key and canonical_key = p_from_key;
  update plays set track = track where artist_key = p_artist_key and track_key = p_from_key;
  get diagnostics n = row_count;
  delete from track_credits where artist_key = p_artist_key and track_key = p_from_key;
  return n;
end;
$$;

-- ---------- track credits ----------
-- Every credited artist on a track, for display. plays.artist stays the main
-- artist alone — it's what rows group and color by — so a feature doesn't
-- split one song into two or shift its points to someone else. Shared across
-- users: credits are a fact about the recording, not about a listener.
-- source: 'spotify' (from a live sync, exact), 'deezer' (looked up by name),
-- or 'none' (looked up, nothing usable found; retried after a while).
create table if not exists track_credits (
  artist_key text not null,
  track_key  text not null,
  artists    text[] not null,
  source     text not null,
  updated_at timestamptz not null default now(),
  primary key (artist_key, track_key)
);
alter table track_credits enable row level security;
-- Each credited artist's key, in the same order as artists — what the
-- championship credits points to.
alter table track_credits add column if not exists artist_keys text[];
update track_credits set artist_keys = array(select resolve_artist_key(x) from unnest(artists) x)
 where artist_keys is null;

-- Keys are computed with the same functions plays' keys are, aliases
-- included, so a credit always lands on the key its plays group under. Spotify's own
-- credits are never overwritten by a name lookup.
-- Names never to credit on a given artist's tracks, as a case-insensitive
-- pattern — a band's own members listed as contributors on every song
-- (AKMU's 이찬혁 and 이수현), say. Applied to every lookup and sync; a hand
-- edit (edit_track_credits) is not filtered.
create table if not exists credit_exclusions (
  artist_key text not null,
  pattern    text not null,
  primary key (artist_key, pattern)
);
alter table credit_exclusions enable row level security;

create or replace function save_track_credits(p_items jsonb, p_source text)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into track_credits (artist_key, track_key, artists, artist_keys, source)
  select distinct on (ak, tk) ak, tk, kept,
         array(select resolve_artist_key(x) from unnest(kept) x), p_source
  from (
    select ak, tk,
           array(select n from unnest(artists) with ordinality as u(n, o)
                  where not exists (select 1 from credit_exclusions e
                                     where e.artist_key = y.ak and lower(n) ~ e.pattern)
                  order by o) as kept
    from (
      select resolve_artist_key(i->>'artist')                  as ak,
             resolve_track_key(i->>'track', i->>'artist')      as tk,
             array(select jsonb_array_elements_text(i->'artists')) as artists
      from jsonb_array_elements(p_items) i
      where coalesce(i->>'artist', '') <> '' and coalesce(i->>'track', '') <> ''
    ) y
  ) x
  order by ak, tk
  on conflict (artist_key, track_key) do update
    set artists = excluded.artists, artist_keys = excluded.artist_keys,
        source = excluded.source, updated_at = now()
    where track_credits.source <> 'manual'
      and (track_credits.source <> 'spotify' or excluded.source = 'spotify');
$$;

-- Hand-correct one track's credits: drop the names in p_remove (matched
-- case-insensitively), add the names in p_add. Saved as 'manual', which no
-- sync or lookup ever overwrites. Starts from the main artist alone when
-- nothing was stored yet.
create or replace function edit_track_credits(
  p_artist_key text, p_track_key text,
  p_remove text[] default '{}', p_add text[] default '{}'
)
returns text[]
language plpgsql
set search_path = public, pg_temp
as $$
declare
  cur text[];
  res text[];
begin
  select artists into cur from track_credits
   where artist_key = p_artist_key and track_key = p_track_key;
  if cur is null or cardinality(cur) = 0 then
    select array[mode() within group (order by artist)] into cur
      from plays where artist_key = p_artist_key and track_key = p_track_key;
  end if;
  select array_agg(a order by ord) into res
    from (
      select a, min(ord) as ord
      from unnest(coalesce(cur, '{}') || coalesce(p_add, '{}')) with ordinality as u(a, ord)
      where lower(a) <> all (select lower(x) from unnest(coalesce(p_remove, '{}')) x)
      group by a
    ) d;
  insert into track_credits (artist_key, track_key, artists, artist_keys, source)
  values (p_artist_key, p_track_key, coalesce(res, '{}'),
          array(select resolve_artist_key(x) from unnest(coalesce(res, '{}')) x), 'manual')
  on conflict (artist_key, track_key) do update
    set artists = excluded.artists, artist_keys = excluded.artist_keys,
        source = 'manual', updated_at = now();
  return res;
end;
$$;

-- Most-played tracks with no stored credits yet, for the sync to fill in a
-- batch at a time — so the championship can credit features on tracks
-- nobody has opened since credits started being kept.
create or replace function tracks_missing_credits(p_limit int default 20)
returns table (artist text, track text)
language sql stable
set search_path = public, pg_temp
as $$
  select mode() within group (order by p.artist), mode() within group (order by p.track)
  from plays p
  left join track_credits c on c.artist_key = p.artist_key and c.track_key = p.track_key
  where c.artist_key is null
  group by p.artist_key, p.track_key
  order by count(*) desc
  limit p_limit;
$$;

-- Some sources put every artist into the one artist string ("Don Toliver,
-- Doja Cat"), which then counted as an artist of its own: its own row, its
-- own color, its own constructor. Wherever such a combined name starts with
-- an artist that also appears on their own, it's merged into that artist
-- and the full list is kept as the tracks' credits. Requiring the first name
-- to exist alone is what keeps "Tyler, The Creator" or "Earth, Wind & Fire"
-- intact. Safe to run again; the scheduled sync runs it.
create or replace function split_combined_artists()
returns table (from_key text, into_key text, moved bigint)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r record;
  items jsonb;
  sep constant text := '\s*(,|&|\s(x|feat\.?|ft\.?|with)\s)\s*';
begin
  for r in
    select k.artist_key as combo,
           btrim((regexp_split_to_array(k.artist_key, sep))[1]) as first
    from (select distinct artist_key from plays) k
    where k.artist_key ~ sep
  loop
    continue when r.first = '' or r.first = r.combo
      or not exists (select 1 from plays where artist_key = r.first);
    select jsonb_agg(jsonb_build_object(
             'artist', x.artist, 'track', x.track,
             'artists', to_jsonb(array(
               select btrim(n) from unnest(regexp_split_to_array(x.artist, sep, 'i')) n
                where btrim(n) <> ''))))
      into items
      from (select distinct on (track_key) artist, track from plays where artist_key = r.combo) x;
    from_key := r.combo;
    into_key := r.first;
    moved := merge_artist(r.combo, r.first);
    if items is not null then perform save_track_credits(items, 'split'); end if;
    return next;
  end loop;
end;
$$;

-- Duplicates with a recognisable shape, merged automatically:
--  * an artist written "한글 Latin" (데이먼스 이어 Damons year) where the
--    Latin part is also an artist on its own;
--  * a song whose longer title only adds its other-language title, the same
--    title again, or its credits — "Next Stop (정거장)", "Rescue (RESCUE)",
--    "Monster (Shawn Mendes & Justin Bieber)", "CRG feat. Dave".
-- Anything marked as a version — remix, live, acoustic, inst, sped up — is
-- a different recording and stays apart. Safe to run again; the scheduled
-- sync runs it.
create or replace function merge_obvious_duplicates()
returns table (kind text, artist_key text, from_key text, into_key text, moved bigint)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r record;
  ver constant text := '(remix|ver\.?|version|inst|instrumental|live|acoustic|stripped|sped|slowed|reverb|8d|edit|mix|demo|preview|karaoke|cover|remaster|어쿠스틱|라이브|리믹스|버전|반주)';
begin
  for r in
    select k.artist_key as combo,
           btrim(substring(k.artist_key from '^[^a-z0-9(]*[가-힣][^a-z0-9(]*\s+([a-z0-9].*)$')) as latin
    from (select distinct p.artist_key from plays p) k
    where k.artist_key ~ '^[^a-z0-9(]*[가-힣][^a-z0-9(]*\s+[a-z0-9]'
  loop
    continue when r.latin is null or r.latin = '' or r.latin = r.combo
      or not exists (select 1 from plays p where p.artist_key = r.latin);
    kind := 'artist'; artist_key := r.latin; from_key := r.combo; into_key := r.latin;
    moved := merge_artist(r.combo, r.latin);
    return next;
  end loop;

  for r in
    with t as (select distinct p.artist_key, p.track_key from plays p)
    select a.artist_key as ak, a.track_key as short, b.track_key as long,
           substr(b.track_key, length(a.track_key) + 1) as tail
    from t a
    join t b on b.artist_key = a.artist_key
            and length(a.track_key) >= 2
            and b.track_key like a.track_key || ' %'
    order by length(a.track_key)
  loop
    continue when r.tail ~* ver;
    continue when not (
         r.tail ~ '^ \(.*[가-힣ぁ-んァ-ン一-龥]'
      or left(r.tail, length(r.short) + 2) = ' (' || r.short
      or r.tail ~ '^ \(?(feat\.?|ft\.?|featuring|starring|with)\s'
      or position(r.ak in r.tail) > 0);
    continue when not exists (select 1 from plays p where p.artist_key = r.ak and p.track_key = r.long);
    kind := 'track'; artist_key := r.ak; from_key := r.long; into_key := r.short;
    moved := merge_track(r.ak, r.long, r.short);
    return next;
  end loop;
end;
$$;

-- Each artist's shade within their genre's color sector (0-8), handed out
-- in rotation as artists are first given a genre and never changed after —
-- artists first seen together get different shades, and colors don't move
-- with listening. Re-assigned only if an artist's genre family changes.
alter table artist_genres add column if not exists shade int;

create or replace function artist_genres_shade()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.shade is null or tg_op = 'INSERT' or new.family is distinct from old.family then
    new.shade := (select count(*) from artist_genres
                   where family = new.family and artist <> new.artist) % 9;
  end if;
  return new;
end;
$$;

drop trigger if exists artist_genres_shade on artist_genres;
create trigger artist_genres_shade
  before insert or update of family on artist_genres
  for each row execute function artist_genres_shade();

update artist_genres g set shade = s.n
  from (select artist,
               ((row_number() over (partition by family order by fetched_at, artist)) - 1) % 9 as n
          from artist_genres) s
 where g.artist = s.artist and g.shade is null;

drop function if exists artist_color_slots(uuid);

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

-- ---------- prior existence, for "NEW" ----------
-- Whether an item was ever played before a cutoff, regardless of how many
-- times or how long ago. The list's NEW badge used to mean only "missing from
-- the immediately preceding equivalent window," which mislabelled anything
-- that had simply gone quiet for a while — a track last played a year ago and
-- picked up again this month is not new. This is what lets the client tell
-- the two apart.
--
-- Grouped and named exactly as top_items does, so the identity matches: the
-- client keys everything by this same (artist, track) display pair.
create or replace function prior_items(
  p_user uuid,
  p_before timestamptz,
  p_mode text default 'tracks',
  p_tz text default 'Asia/Seoul',
  p_source text default 'all'
)
returns table (artist text, track text)
language sql stable
set search_path = public, pg_temp
as $$
  select
    mode() within group (order by p.artist)              as artist,
    case when p_mode = 'artists' then null
         else mode() within group (order by p.track) end as track
  from plays p
  where p.user_id = p_user
    and p.played_at < p_before
    and (p.ms_played >= 30000 or p.source = 'youtube')
    and (p_source = 'all'
         or (p_source = 'youtube' and p.source =  'youtube')
         or (p_source = 'spotify' and p.source <> 'youtube'))
  group by p.artist_key,
           case when p_mode = 'artists' then null else p.track_key end
  -- A stable order, not just a correct one: pagination reads this back a
  -- page at a time via range, and without an explicit order Postgres is free
  -- to hand back a different arrangement on each call, which would skip or
  -- repeat rows across pages.
  order by p.artist_key,
           case when p_mode = 'artists' then null else p.track_key end;
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

-- ---------- first play ever: powers the all-time championship ----------
-- Just the earliest timestamp, so the season API knows where a career-long
-- standings run has to start without paging through the whole calendar just
-- to find one edge of it.
create or replace function first_play_at(p_user uuid)
returns timestamptz
language sql stable
set search_path = public, pg_temp
as $$
  select min(played_at) from plays where user_id = p_user;
$$;

-- ---------- daily totals: powers the summary tiles ----------
-- These three readers return their figures unrounded, and every caller rounds
-- once at the end.
--
-- They used to round inside each bucket, and the callers added the rounded
-- values up: per month in the trend chart, per day in the detail sheet. An
-- estimate of 1.87 plays an entry rounds up on most days, so two hundred days
-- of it drifted 18 plays clear of the truth, and the same track came out as
-- 793, 794 and 811 depending on which screen asked. Minutes had the same shape
-- of error, integer division truncating in every bucket.
--
-- A bar is drawn from a fraction perfectly well; the few places a single
-- bucket's count is written out round it there.
drop function if exists daily_totals(uuid, timestamptz, timestamptz, text, text, boolean);

create function daily_totals(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_tz   text default 'Asia/Seoul',
  p_source text default 'all',
  p_estimate boolean default false
)
returns table (day date, plays numeric, minutes numeric, yt boolean)
language sql stable
set search_path = public, pg_temp
as $$
  select
    (p.played_at at time zone p_tz)::date as day,
    case when p_estimate then sum(p.est_plays) else count(*)::numeric end as plays,
    sum(case when p_estimate and p.source = 'youtube' and p.est_ms > 0
             then p.est_ms
             else play_ms(p.ms_played, p.source) end) / 60000.0 as minutes,
    bool_or(p.source = 'youtube') as yt
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
-- title variant that was merged into that row. Spans the whole history rather
-- than the selected period -- the sheet is about the item, not the window.
drop function if exists item_daily(uuid, text, text, text, text, boolean);
drop function if exists item_daily(uuid, text, text, text, text, boolean, text, text);

-- Matched on the stored keys when the caller has them — a row from the
-- championship can carry a label (one month's spelling) whose own
-- normalisation is not the merged key — else on the label run through the
-- same alias resolution the keys were written with.
create function item_daily(
  p_user uuid,
  p_artist text,
  p_track text default null,
  p_tz text default 'Asia/Seoul',
  p_source text default 'all',
  p_estimate boolean default false,
  p_artist_key text default null,
  p_track_key text default null
)
returns table (day date, plays numeric, minutes numeric, yt boolean)
language sql stable
set search_path = public, pg_temp
as $$
  select (p.played_at at time zone p_tz)::date,
         case when p_estimate then sum(p.est_plays) else count(*)::numeric end,
         sum(case when p_estimate and p.source = 'youtube' and p.est_ms > 0
                  then p.est_ms
                  else play_ms(p.ms_played, p.source) end) / 60000.0,
         bool_or(p.source = 'youtube')
  from plays p
  where p.user_id = p_user
    and p.artist_key = coalesce(p_artist_key, resolve_artist_key(p_artist))
    and (p_track is null
         or p.track_key = coalesce(p_track_key, resolve_track_key(p_track, p_artist)))
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
-- bucket -- deciding it per bucket split one song into two lines wherever the
-- most common spelling changed part-way through.
drop function if exists top_trend(uuid, text, text, text, integer, boolean);

create function top_trend(
  p_user uuid,
  p_mode text default 'tracks',
  p_tz text default 'Asia/Seoul',
  p_source text default 'all',
  p_limit integer default 5,
  p_estimate boolean default false
)
returns table (artist text, track text, bucket date, plays numeric, yt boolean)
language sql stable
set search_path = public, pg_temp
as $$
  with kept as (
    select p.artist_key, case when p_mode = 'artists' then null else p.track_key end as tk,
           case when p_estimate then sum(p.est_plays) else count(*)::numeric end as n
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
         case when p_estimate then sum(p.est_plays) else count(*)::numeric end,
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

-- ---------- records (Awards) ----------
-- Every all-time record in one pass, top three holders per category, as one
-- jsonb object keyed by category. Counted on recorded plays (>=30s, YouTube
-- exempt), the same plays the ranking counts, so a record never disagrees
-- with the list it came from. Each holder:
--   {artist, track, artist_key, track_key, value, from, to}
-- `from`/`to` are the dates the record was set over (or on).
drop function if exists play_records(uuid, text, text);

create or replace function play_records(
  p_user uuid,
  p_tz text default 'Asia/Seoul',
  p_source text default 'all',
  p_estimate boolean default false
)
returns jsonb
language sql stable
set search_path = public, pg_temp
-- A single big analytic query: JIT compilation alone cost seconds here.
set jit = off
as $$
  with p as (
    select (p.played_at at time zone p_tz)::date as day, p.played_at,
           p.artist, p.track, p.artist_key as ak, p.track_key as tk,
           -- what one logged play is worth: 1, or the YouTube estimate,
           -- the same weighting the ranking uses
           case when p_estimate then p.est_plays else 1 end as w
    from plays p
    where p.user_id = p_user
      and (p.ms_played >= 30000 or p.source = 'youtube')
      and (p_source = 'all'
           or (p_source = 'youtube' and p.source =  'youtube')
           or (p_source = 'spotify' and p.source <> 'youtube'))
  ),
  -- track-days and artist-days: everything below is built on these
  d as (select ak, tk, day, sum(w) as n from p group by 1, 2, 3),
  ad as (select ak, day, sum(w) as n from p group by 1, 2),
  lab as (
    select ak, tk,
           mode() within group (order by artist) as artist,
           mode() within group (order by track)  as track,
           sum(w) as plays, count(distinct day)::int as days,
           min(day) as first_day, max(day) as last_day
    from p group by ak, tk
  ),
  alab as (
    select ak, mode() within group (order by artist) as artist,
           sum(w) as plays, count(distinct tk)::int as tracks,
           min(day) as first_day
    from p group by ak
  ),
  cum as (
    select ak, tk, day, n,
           sum(n) over w as c, sum(n) over w - n as before,
           lag(day) over (partition by ak, tk order by day) as prev_day
    from d window w as (partition by ak, tk order by day)
  ),
  -- every play in order, with the running total before and after it —
  -- what "0–100" is timed on, to the minute
  pc as (
    select ak, tk, played_at,
           sum(w) over t as c, sum(w) over t - w as before,
           min(played_at) over (partition by ak, tk) as first_at
    from p window t as (partition by ak, tk order by played_at rows unbounded preceding)
  ),
  apc as (
    select ak, played_at,
           sum(w) over t as c, sum(w) over t - w as before,
           min(played_at) over (partition by ak) as first_at
    from p window t as (partition by ak order by played_at rows unbounded preceding)
  ),
  runs as (
    select ak, tk, count(*)::int as len, min(day) as d_from, max(day) as d_to
    from (select ak, tk, day,
                 day - (row_number() over (partition by ak, tk order by day))::int as g
          from d) s
    group by ak, tk, g
  ),
  aruns as (
    select ak, count(*)::int as len, min(day) as d_from, max(day) as d_to
    from (select ak, day, day - (row_number() over (partition by ak order by day))::int as g
          from ad) s
    group by ak, g
  ),
  -- the day's and the week's number one (ties all count)
  dtop as (
    select ak, tk, day from (
      select ak, tk, day, rank() over (partition by day order by n desc) as r from d
    ) s where r = 1
  ),
  wk as (
    select ak, tk, (day - ((extract(isodow from day)::int) - 1)) as wk, sum(n) as n
    from d group by 1, 2, 3
  ),
  wtop as (
    select ak, tk, wk from (
      select ak, tk, wk, rank() over (partition by wk order by n desc) as r from wk
    ) s where r = 1
  ),
  wruns as (
    select ak, tk, count(*)::int as len, min(wk) as d_from, max(wk) + 6 as d_to
    from (select ak, tk, wk,
                 (wk - date '2000-01-03') / 7
                 - row_number() over (partition by ak, tk order by wk) as g
          from wtop) s
    group by ak, tk, g
  ),
  mo as (
    select ak, tk, (day - (extract(day from day)::int - 1)) as m, sum(n) as n
    from d group by 1, 2, 3
  ),
  mshare as (
    select mo.ak, mo.tk, mo.m, mo.n, t.total,
           round(100.0 * mo.n / t.total, 1) as pct
    from mo join (select m, sum(n) as total from mo group by m) t using (m)
    where t.total >= 100
  ),
  -- one row per holder and category, before keeping the top three
  cand as (
    -- 최단기간 50회 / 100회: days from the first play to the one that got there
    -- Purple Sector (0–50) and Fastest Lap (0–100): hours from the first
    -- play to the one that reached the mark
    select 'fastest_50' as cat, ak, tk,
           round((extract(epoch from played_at - first_at) / 3600)::numeric, 2) as v,
           (first_at at time zone p_tz)::date as d_from, (played_at at time zone p_tz)::date as d_to,
           false as hi
    from pc where before < 50 and c >= 50
    union all
    select 'fastest_100', ak, tk,
           round((extract(epoch from played_at - first_at) / 3600)::numeric, 2),
           (first_at at time zone p_tz)::date, (played_at at time zone p_tz)::date, false
    from pc where before < 100 and c >= 100
    union all
    select * from (
      select distinct on (ak, tk) 'most_in_day', ak, tk, round(n), day, day, true
      from d order by ak, tk, n desc, day
    ) x
    union all
    select * from (
      select distinct on (ak, tk) 'longest_streak', ak, tk, len::numeric, d_from, d_to, true
      from runs order by ak, tk, len desc, d_to desc
    ) x
    union all
    select 'most_days', ak, tk, days, first_day, last_day, true from lab
    union all
    select 'daily_no1', ak, tk, count(*), min(day), max(day), true from dtop group by ak, tk
    union all
    select 'weekly_no1', ak, tk, count(*), min(wk), max(wk) + 6, true from wtop group by ak, tk
    union all
    select * from (
      select distinct on (ak, tk) 'weekly_no1_run', ak, tk, len::numeric, d_from, d_to, true
      from wruns order by ak, tk, len desc, d_to desc
    ) x
    union all
    select * from (
      select distinct on (ak, tk) 'month_share', ak, tk, pct, m,
             (m + interval '1 month' - interval '1 day')::date, true
      from mshare order by ak, tk, pct desc
    ) x
    union all
    select 'longevity', ak, tk, (last_day - first_day + 1), first_day, last_day, true
    from lab where plays >= 20
    union all
    -- 최장 공백 후 복귀: the longest silence a track came back from, counted
    -- only when it came back for real (five more plays at least)
    select * from (
      select distinct on (c.ak, c.tk) 'comeback', c.ak, c.tk, (c.day - c.prev_day - 1)::numeric,
             c.prev_day, c.day, true
      from cum c join lab l using (ak, tk)
      where c.prev_day is not null and l.plays - c.before >= 5
      order by c.ak, c.tk, c.day - c.prev_day desc
    ) x
    union all
    select 'debut_day', c.ak, c.tk, round(c.n), c.day, c.day, true
    from cum c join lab l using (ak, tk) where c.day = l.first_day
    union all
    -- the 100 Club: every song past a hundred plays, with the hours it took
    -- from its first play; the page orders them by the day they got there
    select 'club100', ak, tk, round((extract(epoch from played_at - first_at) / 3600)::numeric, 2),
           (first_at at time zone p_tz)::date, (played_at at time zone p_tz)::date, false
    from pc where before < 100 and c >= 100
    union all
    -- over each 100 Club song's first hundred plays: the days it took, and
    -- how much it has been heard since
    select 'club100_days', x.ak, x.tk, count(distinct p.day)::numeric, min(p.day), (x.at at time zone p_tz)::date, false
    from (select ak, tk, played_at as at from pc where before < 100 and c >= 100) x
    join p on p.ak = x.ak and p.tk = x.tk and p.played_at <= x.at
    group by x.ak, x.tk, x.at
    union all
    select 'club100_since', x.ak, x.tk, round(l.plays - x.c), (x.at at time zone p_tz)::date, l.last_day, true
    from (select ak, tk, played_at as at, c from pc where before < 100 and c >= 100) x
    join lab l using (ak, tk)
  ),
  acand as (
    select 'artist_fastest_500' as cat, ak,
           round((extract(epoch from played_at - first_at) / 3600)::numeric, 2) as v,
           (first_at at time zone p_tz)::date as d_from, (played_at at time zone p_tz)::date as d_to,
           false as hi
    from apc where before < 500 and c >= 500
    union all
    select 'artist_fastest_1000', ak,
           round((extract(epoch from played_at - first_at) / 3600)::numeric, 2),
           (first_at at time zone p_tz)::date, (played_at at time zone p_tz)::date, false
    from apc where before < 1000 and c >= 1000
    union all
    select 'artist_fastest_100', ak,
           round((extract(epoch from played_at - first_at) / 3600)::numeric, 2),
           (first_at at time zone p_tz)::date, (played_at at time zone p_tz)::date, false
    from apc where before < 100 and c >= 100
    union all
    -- between two milestones: from the play that crossed the first to the one that crossed the second
    select 'artist_100_1000', b.ak,
           round((extract(epoch from b.played_at - a.played_at) / 3600)::numeric, 2),
           (a.played_at at time zone p_tz)::date, (b.played_at at time zone p_tz)::date, false
    from apc a join apc b using (ak)
    where a.before < 100 and a.c >= 100 and b.before < 1000 and b.c >= 1000
    union all
    select 'artist_500_1000', b.ak,
           round((extract(epoch from b.played_at - a.played_at) / 3600)::numeric, 2),
           (a.played_at at time zone p_tz)::date, (b.played_at at time zone p_tz)::date, false
    from apc a join apc b using (ak)
    where a.before < 500 and a.c >= 500 and b.before < 1000 and b.c >= 1000
    union all
    select * from (
      select distinct on (ak) 'artist_most_in_day', ak, round(n), day, day, true
      from ad order by ak, n desc, day
    ) x
    union all
    select * from (
      select distinct on (ak) 'artist_streak', ak, len::numeric, d_from, d_to, true
      from aruns order by ak, len desc, d_to desc
    ) x
    union all
    select 'artist_tracks', ak, tracks, first_day, null, true from alab
    union all
    -- the 1000 Club's other records, over each member's first thousand plays
    -- (x: the play that crossed 1000)
    select 'club_days', x.ak, count(distinct p.day)::numeric, min(p.day), (x.at at time zone p_tz)::date, false
    from (select ak, played_at as at from apc where before < 1000 and c >= 1000) x
    join p on p.ak = x.ak and p.played_at <= x.at
    group by x.ak, x.at
    union all
    select 'club_tracks', x.ak, count(distinct p.tk)::numeric, min(p.day), (x.at at time zone p_tz)::date, true
    from (select ak, played_at as at from apc where before < 1000 and c >= 1000) x
    join p on p.ak = x.ak and p.played_at <= x.at
    group by x.ak, x.at
    union all
    -- the top song's share of everything heard by that artist, not just the
    -- first thousand
    select 'club_top_share', s.ak, round(100.0 * max(s.n) / max(s.total), 1), min(s.d_from), max(s.d_to), true
    from (select p.ak, p.tk, sum(p.w) as n, min(p.day) as d_from, max(p.day) as d_to, max(a.plays) as total
          from (select distinct ak from apc where before < 1000 and c >= 1000) x
          join p on p.ak = x.ak
          join alab a on a.ak = x.ak
          group by p.ak, p.tk) s
    group by s.ak
    union all
    select 'club_since', x.ak, round(a.plays - x.c), (x.at at time zone p_tz)::date,
           (select max(day) from ad where ad.ak = x.ak), true
    from (select ak, played_at as at, c from apc where before < 1000 and c >= 1000) x
    join alab a using (ak)
  ),
  top3 as (
    select cat, ak, tk, v, d_from, d_to,
           row_number() over (partition by cat
                              order by case when hi then -v else v end, d_to, ak, tk) as r
    from cand
  ),
  atop3 as (
    select cat, ak, v, d_from, d_to,
           row_number() over (partition by cat
                              order by case when hi then -v else v end, d_to, ak) as r
    from acand
  ),
  holders as (
    select t.cat, t.r, jsonb_build_object(
             'artist', l.artist, 'track', l.track, 'artist_key', t.ak, 'track_key', t.tk,
             'value', t.v, 'from', t.d_from, 'to', t.d_to,
             'plays', case when t.cat = 'club100' then round(l.plays) end) as j
    -- the 100 Club's records list every member, not just the top three
    from top3 t join lab l using (ak, tk)
    where t.r <= 3 or t.cat in ('club100', 'fastest_100', 'club100_days', 'club100_since')
    union all
    select t.cat, t.r, jsonb_build_object(
             'artist', l.artist, 'track', null, 'artist_key', t.ak, 'track_key', null,
             'value', t.v, 'from', t.d_from, 'to', t.d_to, 'plays', round(l.plays),
             -- the 1000 Club's entry: the minute the thousandth play landed
             'reached_at', case when (t.cat in ('artist_fastest_1000', 'artist_100_1000', 'artist_500_1000') or t.cat like 'club\_%') then
               (select to_char(a.played_at at time zone p_tz, 'YYYY-MM-DD"T"HH24:MI')
                from apc a where a.ak = t.ak and a.before < 1000 and a.c >= 1000 limit 1) end)
    -- the 1000 Club lists every artist that got there, not just the top three
    from atop3 t join alab l using (ak)
    where t.r <= 3 or (t.cat in ('artist_fastest_1000', 'artist_100_1000', 'artist_500_1000') or t.cat like 'club\_%')
  ),
  -- the listener's own records, one holder each
  me as (
    select jsonb_build_object(
      'busiest_day', (select jsonb_build_object('value', round(n), 'from', day, 'to', day)
                      from (select day, sum(n) as n from ad group by day) s
                      order by n desc, day limit 1),
      'listening_streak', (select jsonb_build_object('value', count(*), 'from', min(day), 'to', max(day))
                           from (select day, day - (row_number() over (order by day))::int as g
                                 from (select distinct day from ad) u) s
                           group by g order by count(*) desc, max(day) desc limit 1),
      'tracks', (select count(*) from lab),
      'artists', (select count(*) from alab),
      'plays', (select round(coalesce(sum(plays), 0)) from lab),
      'first_day', (select min(day) from ad)
    ) as j
  )
  select coalesce(
           (select jsonb_object_agg(cat, list)
            from (select cat, jsonb_agg(j order by r) as list from holders group by cat) g),
           '{}'::jsonb)
         || jsonb_build_object('me', (select j from me));
$$;

-- ---------- debuts in a window ----------
-- Tracks (or artists) heard for the very first time inside [p_from, p_to),
-- with how much they played there — a Replay's "new this quarter". `total`
-- is how many debuted altogether, repeated on every row.
create or replace function window_debuts(
  p_user uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_mode text default 'tracks',
  p_tz   text default 'Asia/Seoul',
  p_source text default 'all',
  p_limit int default 10
)
returns table (
  artist text, track text, artist_key text, track_key text,
  plays bigint, first_at timestamptz, total bigint
)
language sql stable
set search_path = public, pg_temp
as $$
  with g as (
    select p.artist_key as ak,
           case when p_mode = 'artists' then null else p.track_key end as tk,
           min(p.played_at) as first_at,
           count(*) filter (where p.played_at >= p_from and p.played_at < p_to) as plays,
           mode() within group (order by p.artist) as artist,
           case when p_mode = 'artists' then null
                else mode() within group (order by p.track) end as track
    from plays p
    where p.user_id = p_user
      and p.played_at < p_to
      and (p.ms_played >= 30000 or p.source = 'youtube')
      and (p_source = 'all'
           or (p_source = 'youtube' and p.source =  'youtube')
           or (p_source = 'spotify' and p.source <> 'youtube'))
    group by 1, 2
  )
  select artist, track, ak, tk, plays, first_at, count(*) over ()
  from g
  where first_at >= p_from
  order by plays desc, first_at, ak, tk
  limit p_limit;
$$;

-- ---------- race radio notes ----------
-- Answers worth keeping between visits — the one question the radio puts to
-- GPT-6 Astra (the constructors' title), so it's asked once a day, not per view.
create table if not exists radio_notes (
  key        text primary key,
  body       jsonb not null,
  created_at timestamptz not null default now()
);
alter table radio_notes enable row level security;
