import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';
const KST = 9 * 3600e3;
const MAX_SERIES = 10;

/** Ranges narrower than this are drawn a day at a time; wider, a month. */
const DAY_BUCKET_LIMIT = 62;

/** The KST calendar day an instant falls on. Ranges are KST-midnight aligned,
    so comparing days is exact rather than approximate. */
const kstDay = (iso) => new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 10);

/**
 * Shape of the leaders over the selected period, for the trend chart.
 *
 * Built from two readers that already take the arguments this needs, rather
 * than from top_trend: that one picks its five by all-time count and has no
 * window, so a track that led only inside the chosen period could never
 * appear — which is exactly the case the period picker exists to show.
 *
 * So the period's real top five come from the ranking itself, and each one's
 * own history supplies the shape. Six round trips where top_trend was one,
 * but the panel is opt-in and the alternative was the wrong five items.
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

  const from = q.get('from') || '1970-01-01T00:00:00Z';
  const to   = q.get('to')   || new Date(Date.now() + 864e5).toISOString();
  // `to` is exclusive, so its own day is the first one left out.
  const firstDay = kstDay(from);
  const lastDayExcl = kstDay(to);

  const { data: top, error } = await db.rpc('top_items', {
    p_user: userId, p_from: from, p_to: to, p_mode: mode, p_tz: TZ,
    p_limit: limit, p_source: src, p_days: false, p_estimate: estimate,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!top?.length) return NextResponse.json({ mode, granularity: 'month', buckets: [], series: [] });

  const histories = await Promise.all(top.map((r) =>
    db.rpc('item_daily', {
      p_user: userId, p_artist: r.artist, p_track: r.track ?? null,
      p_tz: TZ, p_source: src, p_estimate: estimate,
    })
  ));

  const failed = histories.find((h) => h.error);
  if (failed) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  // Only the days inside the window. Clipping here is what makes the running
  // total start from the period rather than carrying history into it.
  const kept = histories.map((h) =>
    (h.data ?? []).filter((d) => d.day >= firstDay && d.day < lastDayExcl));

  const allDays = kept.flat().map((d) => d.day);
  if (!allDays.length) return NextResponse.json({ mode, granularity: 'month', buckets: [], series: [] });

  const span = Math.round(
    (Date.parse(allDays.reduce((a, b) => (b > a ? b : a))) -
     Date.parse(allDays.reduce((a, b) => (b < a ? b : a)))) / 864e5) + 1;
  // A month of data in monthly buckets is one column — useless. Narrow ranges
  // get a column a day instead.
  const granularity = span <= DAY_BUCKET_LIMIT ? 'day' : 'month';
  const bucketOf = (day) => (granularity === 'day' ? day : day.slice(0, 7));

  const series = top.map((r, i) => {
    const byBucket = new Map();
    let total = 0;
    for (const d of kept[i]) {
      const b = bucketOf(d.day);
      const n = Number(d.plays);
      byBucket.set(b, (byBucket.get(b) ?? 0) + n);
      total += n;
    }
    return {
      artist: r.artist,
      track: r.track,
      yt: kept[i].some((d) => d.yt),
      points: [...byBucket].map(([bucket, plays]) => ({ bucket, plays })),
      // Rounded once over the whole period rather than once a bucket: adding up
      // rounded buckets put the same track a play or two clear of the ranking.
      total: Math.round(total),
    };
  }).sort((a, b) => b.total - a.total);

  return NextResponse.json({
    mode,
    granularity,
    buckets: [...new Set(kept.flat().map((d) => bucketOf(d.day)))].sort(),
    series,
  });
}
