import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { findGenre } from '@/lib/artwork';
import { findGenreMB } from '@/lib/musicbrainz';
import { familyOfGenres } from '@/lib/genre';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Artists accepted per call; the client asks again for whatever is still missing. */
const MAX_NAMES = 80;
/** Cache misses actually looked up per call. MusicBrainz's own pacing (about
    one request a second, and every miss can cost two) is the real ceiling on
    how many of these fit before the function's own time limit. */
const MAX_SEARCH = 12;
/** Lookups in flight at once. MusicBrainz calls all funnel through one
    serialized queue regardless of this, so it only bounds the Deezer
    fallback's concurrency. */
const CONCURRENCY = 3;

/**
 * Set when a source starts refusing, so a scroll doesn't throw another burst
 * at a closed door. Per-instance, which is enough to break the feedback loop.
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
 * MusicBrainz first: it's community-tagged the way Spotify's genres used to
 * be ("k-pop", "city pop", "hyperpop"), where Deezer only offers ~20 broad
 * buckets and files most of East Asia under one of them regardless of what it
 * sounds like. Deezer is asked only when MusicBrainz has nothing at all —
 * still no key needed, and it answers for a fair number of smaller acts
 * MusicBrainz has no genre tags for.
 */
async function resolveGenre(artist) {
  const mb = await findGenreMB(artist);
  if (mb.genre) return { genre: mb.genre, source: 'mb' };
  const dz = await findGenre(artist);
  return { genre: dz.genre, source: dz.genre ? 'dz' : 'none' };
}

/**
 * Resolve genres for a batch of artists, so the list and the charts can show
 * genre as a label. Cache first, then the sources above, then written back —
 * including the misses, which are a real answer and cost a lookup to learn.
 * The response is keyed by the artist name exactly as it was asked for, so
 * the client can look it up without normalising anything.
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
    .select('artist, genre, family, shade')
    .in('artist', wanted);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const genres = {};
  const known = new Set();
  for (const row of cached || []) {
    genres[row.artist] = { family: row.family, genre: row.genre, shade: row.shade };
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
  // Outcome counts, logged once per call — which source actually answered,
  // or why neither did. Without this a lookup that quietly finds nothing is
  // indistinguishable from one that never ran.
  const tally = { mb: 0, dz: 0, none: 0, limited: 0, failed: 0 };

  const found = await inBatches(searching, CONCURRENCY, async (artist) => {
    try {
      const { genre: name, source } = await resolveGenre(artist);
      const { family, genre } = familyOfGenres(name ? [name] : []);
      tally[source]++;
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
    const { data: written, error: upErr } = await db.from('artist_genres').upsert(
      resolved.map((r) => ({ ...r, fetched_at: now })),
      { onConflict: 'artist' }
    ).select('artist, shade');
    if (upErr) console.error('genre cache write failed', upErr.message);
    // The shade is handed out by the database as the row is written.
    const shadeOf = new Map((written ?? []).map((w) => [w.artist, w.shade]));
    for (const r of resolved) genres[r.artist] = { family: r.family, genre: r.genre, shade: shadeOf.get(r.artist) };
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
