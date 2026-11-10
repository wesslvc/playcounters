import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/clock?from&to — when the listening happens: plays in every
 * weekday x hour cell (1 = Monday, hours 0–23 Seoul time), and each hour's
 * most played song.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';
  const { data, error } = await db.rpc('play_clock', {
    p_user: userId,
    p_from: q.get('from') || '1970-01-01T00:00:00Z',
    p_to: q.get('to') || new Date(Date.now() + 864e5).toISOString(),
    p_tz: 'Asia/Seoul', p_source: src, p_estimate: q.get('estimate') === '1',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? { grid: [], tops: [] });
}
