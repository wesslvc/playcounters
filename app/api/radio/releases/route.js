import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { refreshReleases, loadReleases } from '@/lib/releases';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

const DAY = 864e5;

/** The artists one person has played most over the last two months. */
async function topArtists(userId) {
  const now = Date.now();
  const { data, error } = await db.rpc('top_items', {
    p_user: userId, p_from: new Date(now - 60 * DAY).toISOString(), p_to: new Date(now + 60e3).toISOString(),
    p_mode: 'artists', p_tz: 'Asia/Seoul', p_limit: 15, p_source: 'all', p_estimate: false,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.artist).filter(Boolean);
}

/**
 * Looks up the release radar again. Vercel's cron calls it every few days
 * with `Authorization: Bearer $CRON_SECRET` and every user is done in turn;
 * a signed-in user may ask for their own, at most once every twelve hours.
 */
export async function GET(req) {
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'no key' }, { status: 503 });
  const auth = req.headers.get('authorization');
  const cron = Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`;
  let ids;
  if (cron) {
    const { data, error } = await db.from('users').select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    ids = (data ?? []).map((u) => u.id);
  } else {
    const me = currentUserId();
    if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const kept = await loadReleases(me);
    if (kept && Date.now() - Date.parse(kept.at) < 12 * 3600e3) return NextResponse.json({ ok: true, fresh: true, items: kept.items.length });
    ids = [me];
  }

  const report = [];
  for (const id of ids) {
    try {
      const artists = await topArtists(id);
      if (!artists.length) continue;
      const body = await refreshReleases(id, artists);
      report.push({ user: id, artists: artists.length, items: body.items.length });
    } catch (e) {
      console.error('releases failed for', id, e.message);
      report.push({ user: id, error: e.message });
    }
  }
  console.log('releases', JSON.stringify(report));
  return NextResponse.json({ ok: true, report });
}
