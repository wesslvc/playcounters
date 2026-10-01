import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { normRowKey } from '@/lib/keys';
import { pointsForRank } from '@/lib/rank';
import { rpcAll } from '@/lib/rpcPage';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';
const KST = 9 * 3600e3;
/** Ten scoring rows a month, for a career of any realistic length. */
const MAX_ROWS = 20000;
/** Same KST-anchored month boundary the client's own range picker uses, so a
    Grand Prix here covers exactly the month the "월" picker would show. */
const monthStart = (y, m) => new Date(Date.UTC(y, m - 1, 1) - KST).toISOString();

/**
 * Every month's race, always on plays — a Grand Prix result has to be one
 * fixed thing to be comparable across a season and across years, the way a
 * lap time is always seconds and never whichever unit a viewer prefers. The
 * ranked list elsewhere in the app can be sorted by days or minutes instead;
 * the championship is deliberately not one of the places that choice reaches.
 *
 * One query for the whole span rather than one per month: an all-time
 * standings is a hundred-odd months, and a round trip apiece was most of
 * what made this page slow. season_races does the month bucketing, the
 * ranking (plays, then whoever got there later), and keeps only the top ten
 * of each; all that's left here is attaching the points.
 */
async function runGrandPrix(userId, months, mode, src, estimate) {
  const first = months[0];
  const last = months[months.length - 1];
  const { data, error } = await rpcAll('season_races', {
    p_user: userId,
    p_from: monthStart(first.y, first.m),
    p_to: monthStart(last.y, last.m + 1),
    p_mode: mode, p_tz: TZ, p_source: src, p_estimate: estimate,
  }, MAX_ROWS);
  if (error) throw new Error(error.message);

  const byMonth = new Map();
  for (const r of data) {
    const key = `${r.yr}-${r.mo}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push({ ...r, rank: r.place, points: pointsForRank(r.place) });
  }
  return months.map(({ y, m }) => byMonth.get(`${y}-${m}`) ?? []);
}

/**
 * Every (year, month) a Grand Prix should run for.
 *
 * A single year is exactly the months already elapsed — nothing past "now"
 * has happened yet, so asking for it would just be an empty round trip. The
 * all-time list is the same idea stretched across a whole career: it starts
 * at whichever month the very first recorded play falls in, so a listener
 * whose history starts mid-2019 doesn't get five empty years counted against
 * nothing.
 */
async function racesToRun(userId, year) {
  const now = new Date(Date.now() + KST);
  if (year != null) {
    const isCurrentYear = year === now.getUTCFullYear();
    const monthCount = isCurrentYear ? now.getUTCMonth() + 1 : 12;
    return {
      months: Array.from({ length: monthCount }, (_, i) => ({ y: year, m: i + 1 })),
      complete: !isCurrentYear,
    };
  }

  const { data: firstAt, error } = await db.rpc('first_play_at', { p_user: userId });
  if (error) throw new Error(error.message);
  if (!firstAt) return { months: [], complete: false };

  const start = new Date(new Date(firstAt).getTime() + KST);
  const startY = start.getUTCFullYear();
  const startM = start.getUTCMonth() + 1;
  const endY = now.getUTCFullYear();
  const endM = now.getUTCMonth() + 1;

  const months = [];
  for (let y = startY; y <= endY; y++) {
    for (let m = (y === startY ? startM : 1); m <= (y === endY ? endM : 12); m++) {
      months.push({ y, m });
    }
  }
  // Always "in progress": a career total has no natural finish line while
  // the listener keeps listening, unlike one calendar year.
  return { months, complete: false };
}

/**
 * A season standings, F1-style: every month is one Grand Prix, its top ten
 * by play count pay championship points on the FIA's own scale
 * (25-18-15-12-10-8-6-4-2-1). One calendar year's standings crown that
 * year's champion; the all-time standings (no year given) are every Grand
 * Prix ever run, added up — a driver's career total rather than a season.
 *
 * Drivers are whatever the list itself is ranking — tracks or artists,
 * whichever mode is selected. Constructors exist only in track mode: they
 * regroup each track's points onto its artist, so an artist with several
 * charting songs can lead the constructors' championship even when no
 * single track of theirs leads the drivers' one. That is a different
 * question from switching to artist mode, which would rank artists by their
 * own play counts directly rather than by their tracks' race results — the
 * two are independent standings on purpose.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const mode = q.get('mode') === 'artists' ? 'artists' : 'tracks';
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';
  const estimate = q.get('estimate') === '1';

  const allTime = q.get('all') === '1';
  let year = null;
  if (!allTime) {
    year = Number(q.get('year'));
    if (!Number.isFinite(year)) return NextResponse.json({ error: 'year required' }, { status: 400 });
  }

  let months, complete, races, calibrated;
  try {
    ({ months, complete } = await racesToRun(userId, year));
    [races, calibrated] = await Promise.all([
      months.length ? runGrandPrix(userId, months, mode, src, estimate) : [],
      db.rpc('has_youtube_estimate', { p_user: userId }),
    ]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  // The month still under way is a race in progress: it's shown (as a live,
  // provisional classification) but scores nothing until it's over — the
  // same way a Grand Prix pays no points from the middle of the race.
  const now = new Date(Date.now() + KST);
  const liveIdx = months.findIndex(({ y, m }) =>
    y === now.getUTCFullYear() && m === now.getUTCMonth() + 1);

  const drivers = new Map();
  const constructors = new Map();

  races.forEach((results, i) => {
    if (i === liveIdx) return;
    for (const r of results) {
      // Grouped on the normalised key, not the display label — top_items
      // picks its label per call, and two different months can genuinely
      // disagree on wording for the same recording. Keying on that label
      // instead of the key it came from is exactly what split "Lose My
      // Mind" back into two rows the moment two months' mode() picks
      // didn't match, even though the ranked list (one query, one label)
      // never showed a split at all.
      const key = normRowKey(r);
      const d = drivers.get(key) ?? {
        artist: r.artist, track: r.track ?? null,
        artist_key: r.artist_key, track_key: r.track_key ?? null,
        points: 0, wins: 0, podiums: 0, starts: 0,
      };
      d.points += r.points;
      d.starts += 1;
      if (r.rank === 1) d.wins += 1;
      if (r.rank <= 3) d.podiums += 1;
      drivers.set(key, d);

      if (mode === 'tracks') {
        const ckey = r.artist_key;
        const c = constructors.get(ckey) ?? {
          artist: r.artist, artist_key: r.artist_key,
          points: 0, wins: 0, podiums: 0, starts: 0,
        };
        c.points += r.points;
        c.starts += 1;
        if (r.rank === 1) c.wins += 1;
        if (r.rank <= 3) c.podiums += 1;
        constructors.set(ckey, c);
      }
    }
  });

  // Ties settled the way F1's own standings are: most wins first, then most
  // podiums, before falling back to name so the order is at least stable.
  const byPoints = (a, b) =>
    b.points - a.points || b.wins - a.wins || b.podiums - a.podiums
    || a.artist.localeCompare(b.artist);

  return NextResponse.json({
    year, allTime, mode, source: src,
    complete,
    // Whether a Recap calibration exists, so the page only offers the
    // estimate toggle when there is something real behind it — same rule
    // the main dashboard uses.
    calibrated: calibrated.error ? false : Boolean(calibrated.data),
    estimate: estimate && !calibrated.error && Boolean(calibrated.data),
    racesRun: races.filter((r, i) => r.length && i !== liveIdx).length,
    months: races.map((results, i) => ({
      year: months[i].y, month: months[i].m, live: i === liveIdx,
      top: results.map((r) => ({
        artist: r.artist, track: r.track ?? null,
        artist_key: r.artist_key, track_key: r.track_key ?? null,
        rank: r.rank, points: r.points, plays: r.plays, yt: r.yt,
      })),
    })),
    drivers: [...drivers.values()].sort(byPoints),
    constructors: mode === 'tracks' ? [...constructors.values()].sort(byPoints) : null,
  });
}
