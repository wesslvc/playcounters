import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { rowKey } from '@/lib/keys';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';
const MAX_SERIES = 10;

/**
 * Monthly shape of the leaders, for the trend chart.
 *
 * Always spans the whole history rather than the selected window — the point
 * is watching the top few rise and fall against each other, which a single
 * month cannot show.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const mode = q.get('mode') === 'artists' ? 'artists' : 'tracks';
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';
  const asked = Number(q.get('limit'));
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_SERIES) : 5;
  // Must match the ranking below it, or the same five items come out ordered
  // differently in the two places.
  const estimate = q.get('estimate') === '1';

  const { data, error } = await db.rpc('top_trend', {
    p_user: userId, p_mode: mode, p_tz: TZ, p_source: src, p_limit: limit,
    p_estimate: estimate,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Pivot to one entry per item so the chart doesn't have to regroup it.
  const byItem = new Map();
  for (const r of data ?? []) {
    const key = rowKey(r);
    if (!byItem.has(key)) {
      byItem.set(key, { artist: r.artist, track: r.track, points: [], yt: false });
    }
    const s = byItem.get(key);
    s.points.push({ month: r.bucket, plays: Number(r.plays) });
    s.yt = s.yt || Boolean(r.yt);
  }

  const series = [...byItem.values()]
    .map((s) => ({ ...s, total: s.points.reduce((t, p) => t + p.plays, 0) }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({
    mode,
    months: [...new Set((data ?? []).map((r) => r.bucket))].sort(),
    series,
  });
}
