import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { rowKey } from '@/lib/keys';
import { computeRanks, pointsForRank } from '@/lib/rank';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';
const KST = 9 * 3600e3;
/** A month's field of runners, generously sized: what matters is that the
    real top 10 by whichever metric is selected is never cut off, and a
    month is a small enough window that this is cheap either way. */
const MONTH_LIMIT = 200;
const SORT_KEYS = ['plays', 'days', 'weeks', 'minutes'];

/** Same KST-anchored month boundary the client's own range picker uses, so a
    Grand Prix here covers exactly the month the "월" picker would show. */
const monthBounds = (y, m) => ({
  from: new Date(Date.UTC(y, m - 1, 1) - KST).toISOString(),
  to: new Date(Date.UTC(y, m, 1) - KST).toISOString(),
});

/**
 * One month's races, run against whichever metric the dashboard is currently
 * sorted by — the "finishing order" a Grand Prix pays points on on is the
 * same ranking the list itself already shows, not a separate fixed one.
 */
async function runGrandPrix(userId, y, m, mode, src, estimate, sortKey) {
  const { from, to } = monthBounds(y, m);
  const { data, error } = await db.rpc('top_items', {
    p_user: userId, p_from: from, p_to: to, p_mode: mode, p_tz: TZ,
    p_limit: MONTH_LIMIT, p_source: src, p_days: false, p_estimate: estimate,
  });
  if (error) throw new Error(error.message);

  const rows = [...(data ?? [])].sort((a, b) =>
    Number(b[sortKey]) - Number(a[sortKey]) || Number(b.plays) - Number(a.plays));
  const ranks = computeRanks(rows, sortKey);

  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const rank = ranks[i];
    if (rank > 10) break; // ranks only rise from here — nothing past this scores
    const points = pointsForRank(rank);
    if (points <= 0) continue;
    results.push({ ...rows[i], rank, points });
  }
  return results;
}

/**
 * A season standings, F1-style: every month is one Grand Prix, its top ten
 * pay championship points on the FIA's own scale (25-18-15-12-10-8-6-4-2-1),
 * and the year's champion is whoever has the most at the end of it.
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
  const sortKey = SORT_KEYS.includes(q.get('sort')) ? q.get('sort') : 'plays';

  const year = Number(q.get('year'));
  if (!Number.isFinite(year)) return NextResponse.json({ error: 'year required' }, { status: 400 });

  // Months after the current one in the current year haven't happened yet;
  // asking for them just costs an empty round trip.
  const now = new Date(Date.now() + KST);
  const isCurrentYear = year === now.getUTCFullYear();
  const monthCount = isCurrentYear ? now.getUTCMonth() + 1 : 12;

  let races;
  try {
    races = await Promise.all(
      Array.from({ length: monthCount }, (_, i) =>
        runGrandPrix(userId, year, i + 1, mode, src, estimate, sortKey))
    );
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const drivers = new Map();
  const constructors = new Map();

  races.forEach((results, i) => {
    for (const r of results) {
      const key = rowKey(r);
      const d = drivers.get(key) ?? {
        artist: r.artist, track: r.track ?? null, points: 0, wins: 0, podiums: 0, starts: 0,
      };
      d.points += r.points;
      d.starts += 1;
      if (r.rank === 1) d.wins += 1;
      if (r.rank <= 3) d.podiums += 1;
      drivers.set(key, d);

      if (mode === 'tracks') {
        const c = constructors.get(r.artist) ?? {
          artist: r.artist, points: 0, wins: 0, podiums: 0, starts: 0,
        };
        c.points += r.points;
        c.starts += 1;
        if (r.rank === 1) c.wins += 1;
        if (r.rank <= 3) c.podiums += 1;
        constructors.set(r.artist, c);
      }
    }
  });

  // Ties settled the way F1's own standings are: most wins first, then most
  // podiums, before falling back to name so the order is at least stable.
  const byPoints = (a, b) =>
    b.points - a.points || b.wins - a.wins || b.podiums - a.podiums
    || a.artist.localeCompare(b.artist);

  return NextResponse.json({
    year, mode, source: src, sort: sortKey,
    complete: !isCurrentYear,
    racesRun: races.filter((r) => r.length).length,
    months: races.map((results, i) => ({
      month: i + 1,
      top: results.map((r) => ({
        artist: r.artist, track: r.track ?? null, rank: r.rank, points: r.points,
        value: r[sortKey], yt: r.yt,
      })),
    })),
    drivers: [...drivers.values()].sort(byPoints),
    constructors: mode === 'tracks' ? [...constructors.values()].sort(byPoints) : null,
  });
}
