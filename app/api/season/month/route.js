import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/db';
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

  const { data, error } = await rpcAll('top_items', {
    p_user: userId, p_from: from, p_to: to, p_mode: mode, p_tz: TZ,
    p_limit: MAX_LIMIT, p_source: src, p_days: false, p_estimate: estimate,
  }, MAX_LIMIT);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { rows, ranks } = rankByPlays(data ?? []);
  const items = rows.map((r, i) => ({
    artist: r.artist, track: r.track ?? null, plays: Number(r.plays),
    rank: ranks[i], points: pointsForRank(ranks[i]),
    yt: r.yt,
  }));

  return NextResponse.json({ year, month, mode, source: src, items });
}
