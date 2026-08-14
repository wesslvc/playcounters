import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';

export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const mode = q.get('mode') === 'artists' ? 'artists' : 'tracks';
  const from = q.get('from') || '1970-01-01T00:00:00Z';
  const to   = q.get('to')   || new Date(Date.now() + 864e5).toISOString();

  const [items, daily, user] = await Promise.all([
    db.rpc('top_items', {
      p_user: userId, p_from: from, p_to: to, p_mode: mode, p_tz: TZ, p_limit: 250,
    }),
    db.rpc('daily_totals', { p_user: userId, p_from: from, p_to: to, p_tz: TZ }),
    db.from('users').select('display_name, avatar_url, last_synced_at').eq('id', userId).single(),
  ]);

  if (items.error)  return NextResponse.json({ error: items.error.message }, { status: 500 });
  if (daily.error)  return NextResponse.json({ error: daily.error.message }, { status: 500 });

  const rows = items.data || [];
  const days = daily.data || [];

  return NextResponse.json({
    user: user.data ?? null,
    items: rows,
    daily: days,
    summary: {
      plays:   days.reduce((s, d) => s + Number(d.plays), 0),
      minutes: days.reduce((s, d) => s + Number(d.minutes), 0),
      days:    days.length,
      items:   rows.length,
    },
  });
}
