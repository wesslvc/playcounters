import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/db';
import { rpcAll } from '@/lib/rpcPage';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';
const MAX_LIMIT = 50000;

/**
 * Just the calendar — every day that holds a play, independent of mode
 * (tracks/artists never changes which days have plays) and of any selected
 * period. Pages the same as /api/stats does for the same reason: it spans
 * all of history, so a long-running listener can pass any realistic
 * single-response cap, and a truncated year would silently vanish from
 * whatever picker reads this.
 *
 * Its own route rather than reusing /api/stats: a page that only wants the
 * year list — the championship page, so far — has no use for a period's
 * top items or daily totals, and asking for those anyway just to throw them
 * away is wasted computation on every load.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';

  const { data, error } = await rpcAll(
    'play_calendar', { p_user: userId, p_tz: TZ, p_source: src }, MAX_LIMIT
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ calendar: data ?? [] });
}
