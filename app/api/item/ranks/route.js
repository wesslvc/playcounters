import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';

/**
 * One item's rank history: every year and month it was heard, and its
 * all-time standing at the end of each month (item_ranks). Kept apart from
 * /api/item so the sheet's counts don't wait on a ranking of everything.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const artistKey = q.get('artist_key');
  if (!artistKey) return NextResponse.json({ error: 'artist_key required' }, { status: 400 });
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';

  const { data, error } = await db.rpc('item_ranks', {
    p_user: userId, p_artist_key: artistKey, p_track_key: q.get('track_key') || null,
    p_tz: TZ, p_source: src, p_estimate: q.get('estimate') === '1',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const by = { year: [], month: [], all: [] };
  for (const r of data ?? []) {
    by[r.kind]?.push({ period: r.period, rank: r.rank, plays: Number(r.plays), items: r.items });
  }
  return NextResponse.json(by);
}
