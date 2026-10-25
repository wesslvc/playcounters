import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { genresFor } from '@/lib/families';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';

/**
 * Every all-time record, top three holders per category (play_records).
 * One query over the whole history; the Grand Prix records are worked out
 * on the page from the championship data it already loads.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';

  const { data, error } = await db.rpc('play_records', { p_user: userId, p_tz: TZ, p_source: src });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const records = data ?? {};
  const names = Object.entries(records)
    .filter(([k]) => k !== 'me')
    .flatMap(([, list]) => (Array.isArray(list) ? list.map((h) => h.artist) : []));
  return NextResponse.json({ records, genres: await genresFor(names) });
}
