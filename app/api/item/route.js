import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';

/** ISO week label for a YYYY-MM-DD string, matching the ranking's "들은 주". */
function isoWeek(day) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return `${d.getUTCFullYear()}-${Math.ceil(((d.getTime() - jan1) / 864e5 + 1) / 7)}`;
}

/**
 * One item's own history — every day it played, plus the totals derived from
 * it. Resolved through the same normalisation the ranking uses, so it covers
 * every title variant that was merged into that row.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const artist = q.get('artist');
  if (!artist) return NextResponse.json({ error: 'artist required' }, { status: 400 });
  const track = q.get('track') || null;
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';
  const estimate = q.get('estimate') === '1';

  const { data, error } = await db.rpc('item_daily', {
    p_user: userId, p_artist: artist, p_track: track, p_tz: TZ, p_source: src,
    p_estimate: estimate,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const days = data ?? [];
  return NextResponse.json({
    artist,
    track,
    daily: days,
    estimate,
    summary: {
      // YouTube plays in the mix mean the figures carry an estimate.
      yt:      days.some((d) => d.yt),
      plays:   days.reduce((s, d) => s + Number(d.plays), 0),
      minutes: days.reduce((s, d) => s + Number(d.minutes), 0),
      days:    days.length,
      weeks:   new Set(days.map((d) => isoWeek(d.day))).size,
      first:   days[0]?.day ?? null,
      last:    days[days.length - 1]?.day ?? null,
    },
  });
}
