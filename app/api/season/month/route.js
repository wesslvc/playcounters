import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { rpcAll } from '@/lib/rpcPage';
import { rankByPlays, pointsForRank } from '@/lib/rank';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';
const KST = 9 * 3600e3;
const MAX_LIMIT = 50000;

/**
 * One Grand Prix's full field, not just the ten who scored.
 *
 * The season endpoint only ever hands back the point-paying top ten — that's
 * all a standings table needs, and returning everyone every month would
 * bloat a career-spanning fetch for a detail almost nobody opens. This is
 * that detail, fetched only when a Grand Prix is actually expanded: every
 * item with a play that month, ranked the same way runGrandPrix ranks the
 * scoring ones (same tie rule — recency before a shared rank), so a row here
 * agrees with the summary above it rather than being a second opinion.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const mode = q.get('mode') === 'artists' ? 'artists' : 'tracks';
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';
  const estimate = q.get('estimate') === '1';

  const year = Number(q.get('year'));
  const month = Number(q.get('month'));
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return NextResponse.json({ error: 'year and month required' }, { status: 400 });
  }

  const from = new Date(Date.UTC(year, month - 1, 1) - KST).toISOString();
  const to = new Date(Date.UTC(year, month, 1) - KST).toISOString();

  const args = { p_user: userId, p_from: from, p_to: to, p_mode: mode, p_tz: TZ, p_source: src, p_estimate: estimate };
  const [field, lead] = await Promise.all([
    rpcAll('top_items', { ...args, p_limit: MAX_LIMIT, p_days: false }, MAX_LIMIT),
    db.rpc('month_leaders', args),
  ]);
  if (field.error) return NextResponse.json({ error: field.error.message }, { status: 500 });

  const { rows, ranks } = rankByPlays(field.data ?? []);
  const items = rows.map((r, i) => ({
    artist: r.artist, track: r.track ?? null,
    artist_key: r.artist_key, track_key: r.track_key ?? null,
    plays: Number(r.plays), rank: ranks[i], points: pointsForRank(ranks[i]),
    yt: r.yt,
  }));

  // The month's last day, or today if the month is still running — the
  // final leader holds the lead up to there, not past it.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const now = new Date(Date.now() + KST);
  const isLive = now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month;
  const endDay = isLive ? Math.min(now.getUTCDate(), lastDay) : lastDay;

  return NextResponse.json({
    year, month, mode, source: src, items,
    // Absent rather than an error when the leader query fails (e.g. the
    // function isn't installed yet): the classification still stands alone.
    leaders: lead.error ? null : leaderStints(lead.data ?? [], items, endDay),
    days: lastDay,
  });
}

/**
 * Day-by-day leaders folded into stints — one entry per spell at the front,
 * the way a race's lap chart is read: who led, from when to when.
 */
function leaderStints(daily, items, endDay) {
  const label = new Map(items.map((t) => [`${t.artist_key}|${t.track_key ?? ''}`, t]));
  const stints = [];
  for (const d of daily) {
    const key = `${d.artist_key}|${d.track_key ?? ''}`;
    const day = Number(String(d.day).slice(8, 10));
    const prev = stints[stints.length - 1];
    if (prev && prev.key === key) {
      prev.plays = Number(d.plays);
      prev.gap = d.runner_up == null ? null : Number(d.plays) - Number(d.runner_up);
      continue;
    }
    if (prev) prev.to = day - 1;
    const t = label.get(key);
    stints.push({
      key, from: day, to: null,
      artist: t?.artist ?? d.artist_key, track: t?.track ?? null,
      plays: Number(d.plays),
      gap: d.runner_up == null ? null : Number(d.plays) - Number(d.runner_up),
    });
  }
  if (stints.length) stints[stints.length - 1].to = endDay;
  return stints;
}
