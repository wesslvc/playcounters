import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { findGenre } from '@/lib/artwork';
import { familyOfGenres } from '@/lib/genre';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Artists accepted per call; the client asks again for whatever is still missing. */
const MAX_NAMES = 80;
/** Cache misses actually looked up per call, bounding latency. */
const MAX_SEARCH = 16;
/** Lookups in flight at once. Each one is one or two Deezer calls. */
const CONCURRENCY = 3;

/**
 * Set when Deezer starts refusing, so a scroll doesn't throw another burst at
 * a closed door. Per-instance, which is enough to break the feedback loop.
 */
let pausedUntil = 0;

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

/**
 * Resolve genres for a batch of artists, so the list and the charts can color
 * by genre rather than by rank.
 *
 * Cache first, then Deezer, then written back — including the misses, which are
 * a real answer and cost a lookup to learn. The response is keyed by the artist
 * name exactly as it was asked for, so the client can look it up without
 * normalising anything.
 */
export async function POST(req) {
  if (!currentUserId()) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  if (!Array.isArray(body?.artists)) {
    return NextResponse.json({ error: 'artists must be an array' }, { status: 400 });
  }

  const wanted = [...new Set(
    body.artists.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim())
  )].slice(0, MAX_NAMES);

  if (!wanted.length) return NextResponse.json({ genres: {}, pending: 0 });

  const { data: cached, error } = await db
    .from('artist_genres')
    .select('artist, genre, family')
    .in('artist', wanted);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const genres = {};
  const known = new Set();
  for (const row of cached || []) {
    genres[row.artist] = { family: row.family, genre: row.genre };
    known.add(row.artist);
  }
  const misses = wanted.filter((a) => !known.has(a));

  const waitMs = pausedUntil - Date.now();
  if (waitMs > 0) {
    return NextResponse.json({
      genres, pending: misses.length, retryAfter: Math.ceil(waitMs / 1000),
    });
  }

  const searching = misses.slice(0, MAX_SEARCH);
  // Outcome counts, logged once per call. Without them a lookup that quietly
  // finds nothing is indistinguishable from one that never ran — which is
  // exactly how the previous source's silent failure went unnoticed.
  const tally = { search: 0, album: 0, 'no-genre': 0, 'no-albums': 0, unusable: 0, limited: 0, failed: 0 };

  const found = await inBatches(searching, CONCURRENCY, async (artist) => {
    try {
      const { genre: name, stage } = await findGenre(artist);
      const { family, genre } = familyOfGenres(name ? [name] : []);
      tally[stage] = (tally[stage] ?? 0) + 1;
      return { artist, family, genre };
    } catch (e) {
      if (e.rateLimited) {
        tally.limited++;
        pausedUntil = Math.max(pausedUntil, Date.now() + e.retryAfter * 1000);
      } else {
        tally.failed++;
        // A bad response: leave it unresolved rather than caching an 'other'
        // we would never retry.
        console.error('genre lookup failed', artist, e.message);
      }
      return null;
    }
  });

  const resolved = found.filter(Boolean);
  if (resolved.length) {
    const now = new Date().toISOString();
    const { error: upErr } = await db.from('artist_genres').upsert(
      resolved.map((r) => ({ ...r, fetched_at: now })),
      { onConflict: 'artist' }
    );
    if (upErr) console.error('genre cache write failed', upErr.message);
    for (const r of resolved) genres[r.artist] = { family: r.family, genre: r.genre };
  }

  if (searching.length) {
    console.log('genres', JSON.stringify({
      asked: wanted.length, cached: wanted.length - misses.length,
      searched: searching.length, ...tally,
    }));
  }

  const stillPaused = Math.max(0, pausedUntil - Date.now());
  return NextResponse.json({
    genres,
    pending: misses.length - resolved.length,
    ...(stillPaused ? { retryAfter: Math.ceil(stillPaused / 1000) } : {}),
  });
}
