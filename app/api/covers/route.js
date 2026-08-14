import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { findArtwork } from '@/lib/artwork';
import { coverKey, coverTargetFor } from '@/lib/keys';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Keys accepted per call; the client asks again for whatever is still missing. */
const MAX_KEYS = 80;
/** Cache misses actually searched per call, bounding both latency and rate limit. */
const MAX_SEARCH = 24;
/** Searches in flight at once. */
const CONCURRENCY = 4;

/**
 * Kept from the Spotify era and still worth having: if the source ever starts
 * refusing, stop searching until the window passes and say so, rather than
 * having each scroll throw another burst at a closed door. Per-instance, which
 * is enough to break the feedback loop.
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
 * Resolve artwork for a batch of list rows.
 *
 * Cache first: imported history has no images, so misses are filled by name
 * search and written back — nulls included, so something Spotify cannot find
 * is not searched again on every scroll.
 *
 * The client sends whole rows and the target is derived here through the same
 * shared helper it uses, so the keys in the response are the keys it will
 * look up.
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

  const mode = body?.mode === 'artists' ? 'artists' : 'tracks';
  if (!Array.isArray(body?.items)) {
    return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
  }

  const wanted = [...new Map(
    body.items
      .filter((i) => i?.artist)
      .map((i) => coverTargetFor(mode, i))
      .filter((t) => t.kind === 'artist' || t.name)
      .map((t) => [coverKey(t), t])
  ).values()].slice(0, MAX_KEYS);

  if (!wanted.length) return NextResponse.json({ covers: {}, pending: 0 });

  // Composite `in` isn't expressible through PostgREST, so filter by artist
  // and narrow the rest in memory — the over-fetch is a handful of rows.
  const { data: cached, error } = await db
    .from('covers')
    .select('kind, artist, name, image_url')
    .in('artist', [...new Set(wanted.map((w) => w.artist))]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const known = new Map((cached || []).map((c) => [coverKey(c), c.image_url]));
  const covers = {};
  const misses = [];

  for (const w of wanted) {
    const key = coverKey(w);
    if (known.has(key)) covers[key] = known.get(key);
    else misses.push(w);
  }

  const waitMs = pausedUntil - Date.now();
  if (waitMs > 0) {
    return NextResponse.json({
      covers, pending: misses.length, retryAfter: Math.ceil(waitMs / 1000),
    });
  }

  const searching = misses.slice(0, MAX_SEARCH);
  // Outcome counts, logged once per call. Without them a search that quietly
  // matches nothing is indistinguishable from one that never ran.
  const tally = { strict: 0, loose: 0, rejected: 0, 'no-candidates': 0, unusable: 0, limited: 0, failed: 0 };

  const found = await inBatches(searching, CONCURRENCY, async (w) => {
    try {
      const { url, stage } = await findArtwork(w.kind, w.artist, w.name);
      tally[stage] = (tally[stage] ?? 0) + 1;
      return { ...w, image_url: url };
    } catch (e) {
      if (e.rateLimited) {
        tally.limited++;
        pausedUntil = Math.max(pausedUntil, Date.now() + e.retryAfter * 1000);
      } else {
        tally.failed++;
        // A bad response: leave it unresolved rather than caching a null we
        // would never retry.
        console.error('cover search failed', w.kind, w.artist, w.name, e.message);
      }
      return null;
    }
  });

  const resolved = found.filter(Boolean);
  if (resolved.length) {
    const now = new Date().toISOString();
    const { error: upErr } = await db.from('covers').upsert(
      resolved.map((r) => ({
        kind: r.kind, artist: r.artist, name: r.name,
        image_url: r.image_url, fetched_at: now,
      })),
      { onConflict: 'kind,artist,name' }
    );
    if (upErr) console.error('cover cache write failed', upErr.message);
    for (const r of resolved) covers[coverKey(r)] = r.image_url;
  }

  if (searching.length) {
    console.log('covers', JSON.stringify({
      asked: wanted.length, cached: wanted.length - misses.length,
      searched: searching.length, ...tally,
    }));
  }

  const stillPaused = Math.max(0, pausedUntil - Date.now());
  return NextResponse.json({
    covers,
    pending: misses.length - resolved.length,
    ...(stillPaused ? { retryAfter: Math.ceil(stillPaused / 1000) } : {}),
  });
}
