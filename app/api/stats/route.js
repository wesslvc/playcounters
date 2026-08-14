import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const mode = q.get('mode') === 'artists' ? 'artists' : 'tracks';
  // Spotify and YouTube aren't measured the same way, so they can be read apart.
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';
  const from = q.get('from') || '1970-01-01T00:00:00Z';
  const to   = q.get('to')   || new Date(Date.now() + 864e5).toISOString();

  const asked = Number(q.get('limit'));
  const limit = Number.isFinite(asked) && asked > 0
    ? Math.min(asked, MAX_LIMIT)
    : DEFAULT_LIMIT;

  // The equivalent window immediately before this one, so the client can rank
  // both and show movement. Absent for "전체", which has no before.
  const prevFrom = q.get('prevFrom');
  const prevTo = q.get('prevTo');
  const wantPrev = Boolean(prevFrom && prevTo);

  const [items, daily, total, prev, months, user] = await Promise.all([
    db.rpc('top_items', {
      p_user: userId, p_from: from, p_to: to, p_mode: mode, p_tz: TZ,
      p_limit: limit, p_source: src,
    }),
    db.rpc('daily_totals', { p_user: userId, p_from: from, p_to: to, p_tz: TZ, p_source: src }),
    db.rpc('item_count', { p_user: userId, p_from: from, p_to: to, p_mode: mode, p_tz: TZ, p_source: src }),
    wantPrev
      ? db.rpc('top_items', {
          p_user: userId, p_from: prevFrom, p_to: prevTo,
          p_mode: mode, p_tz: TZ, p_limit: limit, p_source: src,
        })
      : Promise.resolve({ data: null, error: null }),
    db.rpc('play_months', { p_user: userId, p_tz: TZ, p_source: src }),
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
    // Ranking depends on the metric the client is sorting by, so send the raw
    // previous window and let it rank both the same way.
    prev: prev.error ? null : prev.data,
    // Months that actually hold plays, so the picker never offers an empty
    // one. Independent of the selected period.
    months: months.error ? [] : (months.data ?? []),
    summary: {
      plays:   days.reduce((s, d) => s + Number(d.plays), 0),
      minutes: days.reduce((s, d) => s + Number(d.minutes), 0),
      days:    days.length,
      // The real distinct count; `shown` is how much of it the list holds.
      items:   total.error ? rows.length : Number(total.data),
      shown:   rows.length,
    },
  });
}
