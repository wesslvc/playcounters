import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';

const KST = 9 * 3600e3;

/** GET /api/day?d=YYYY-MM-DD — that day's most played songs, for the listening calendar. */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const d = q.get('d') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return NextResponse.json({ error: 'd required' }, { status: 400 });
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';
  const from = Date.parse(`${d}T00:00:00Z`) - KST;
  const { data, error } = await db.rpc('top_items', {
    p_user: userId, p_from: new Date(from).toISOString(), p_to: new Date(from + 864e5).toISOString(),
    p_mode: 'tracks', p_tz: 'Asia/Seoul', p_limit: 5, p_source: src, p_days: false, p_estimate: q.get('estimate') === '1',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ day: d, items: (data ?? []).map((r) => ({ ...r, plays: Number(r.plays) })) });
}
