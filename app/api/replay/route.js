import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { rpcAll } from '@/lib/rpcPage';
import { genresFor } from '@/lib/families';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';
const KST = 9 * 3600e3;
const DAY = 864e5;

/** KST midnight on the first of a month, as an instant. Months past 12 roll over. */
const monthStart = (y, m) => Date.UTC(y, m - 1, 1) - KST;
const iso = (ms) => new Date(ms).toISOString();

/**
 * One quarter's Replay: the top songs, artists and albums of those three
 * months, what was new, and each month's number one — everything the page
 * draws, in one round trip. `q` is 1–4.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get('year'));
  const q = Number(sp.get('q'));
  if (!Number.isInteger(year) || ![1, 2, 3, 4].includes(q)) {
    return NextResponse.json({ error: 'year and q required' }, { status: 400 });
  }
  const src = ['spotify', 'youtube'].includes(sp.get('source')) ? sp.get('source') : 'all';
  const estimate = sp.get('estimate') === '1';

  const m0 = (q - 1) * 3 + 1;
  const from = monthStart(year, m0);
  const to = monthStart(year, m0 + 3);
  const prevFrom = monthStart(year, m0 - 3);
  const live = Date.now() < to;
  const base = { p_user: userId, p_tz: TZ, p_source: src };
  const top = (a, b, mode, limit) => db.rpc('top_items', {
    ...base, p_from: iso(a), p_to: iso(b), p_mode: mode, p_limit: limit, p_days: false, p_estimate: estimate,
  });

  const [tracks, artists, prev, daily, debuts, debutArtists, artistCount, trackCount, ...months] = await Promise.all([
    top(from, to, 'tracks', 100),
    top(from, to, 'artists', 25),
    top(prevFrom, from, 'tracks', 200),
    rpcAll('daily_totals', { ...base, p_from: iso(from), p_to: iso(to), p_estimate: estimate }, 200),
    db.rpc('window_debuts', { ...base, p_from: iso(from), p_to: iso(to), p_mode: 'tracks', p_limit: 5 }),
    db.rpc('window_debuts', { ...base, p_from: iso(from), p_to: iso(to), p_mode: 'artists', p_limit: 3 }),
    db.rpc('item_count', { ...base, p_from: iso(from), p_to: iso(to), p_mode: 'artists' }),
    db.rpc('item_count', { ...base, p_from: iso(from), p_to: iso(to), p_mode: 'tracks' }),
    ...[0, 1, 2].map((i) => top(monthStart(year, m0 + i), monthStart(year, m0 + i + 1), 'tracks', 1)),
  ]);
  const failed = [tracks, artists, daily].find((r) => r.error);
  if (failed) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const days = daily.data ?? [];
  const trackRows = tracks.data ?? [];

  // Albums, rebuilt from the quarter's top hundred songs: close enough for
  // a top five, and no extra query.
  const albums = new Map();
  for (const t of trackRows) {
    if (!t.album) continue;
    const k = `${t.artist_key}\u0000${t.album.toLowerCase()}`;
    const a = albums.get(k) ?? { album: t.album, artist: t.artist, artist_key: t.artist_key, plays: 0, tracks: 0, cover: t };
    a.plays += Number(t.plays);
    a.tracks += 1;
    albums.set(k, a);
  }

  const prevRank = {};
  (prev.data ?? []).forEach((r, i) => { prevRank[`${r.artist_key}\u0000${r.track_key}`] = i + 1; });

  const busiest = days.reduce((a, b) => (!a || Number(b.plays) > Number(a.plays) ? b : a), null);
  // Days the quarter has had so far — the denominator for "들은 날".
  const fromIdx = Math.round((from + KST) / DAY);
  const span = live
    ? Math.floor((Date.now() + KST) / DAY) - fromIdx + 1
    : Math.round((to - from) / DAY);

  const genres = await genresFor([
    ...trackRows.slice(0, 25).map((r) => r.artist),
    ...(artists.data ?? []).map((r) => r.artist),
  ]);

  return NextResponse.json({
    year, q, live, from: iso(from), to: iso(to), estimate,
    genres,
    tracks: trackRows,
    artists: artists.data ?? [],
    albums: [...albums.values()].sort((a, b) => b.plays - a.plays).slice(0, 5)
      .map(({ cover, ...a }) => ({ ...a, track: cover.track })),
    prevRank,
    months: months.map((r, i) => ({ month: m0 + i, top: r.data?.[0] ?? null })),
    debuts: {
      total: Number(debuts.data?.[0]?.total ?? 0),
      top: debuts.data ?? [],
      artists: Number(debutArtists.data?.[0]?.total ?? 0),
      topArtists: debutArtists.data ?? [],
    },
    summary: {
      plays: Math.round(days.reduce((s, d) => s + Number(d.plays), 0)),
      minutes: Math.round(days.reduce((s, d) => s + Number(d.minutes), 0)),
      days: days.length,
      span: Math.max(1, span),
      tracks: trackCount.error ? trackRows.length : Number(trackCount.data),
      artists: artistCount.error ? null : Number(artistCount.data),
      busiest: busiest ? { day: busiest.day, plays: Math.round(Number(busiest.plays)) } : null,
    },
  });
}
