import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { findCredits } from '@/lib/credits';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Keys accepted per call; the client asks again for whatever is still missing. */
const MAX_KEYS = 80;
/** Cache misses looked up per call — each is two Deezer requests. */
const MAX_SEARCH = 12;
const CONCURRENCY = 3;
/** A lookup that found nothing is tried again after this long. */
const RECHECK_MS = 14 * 864e5;

let pausedUntil = 0;

const keyOf = (r) => `${r.artist_key}\u0000${r.track_key ?? ''}`;

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

/**
 * Credited artists for a batch of track rows, the same way covers work:
 * cache first, then a bounded number of name lookups written back —
 * misses included, so a track nobody can find isn't searched on every load.
 * Responds with { credits: { key: [names] }, pending, retryAfter? }.
 */
export async function POST(req) {
  if (!currentUserId()) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!Array.isArray(body?.items)) {
    return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
  }

  const wanted = [...new Map(
    body.items
      .filter((i) => i?.artist && i?.track && i?.artist_key && i?.track_key)
      .map((i) => [keyOf(i), i])
  ).values()].slice(0, MAX_KEYS);
  if (!wanted.length) return NextResponse.json({ credits: {}, pending: 0 });

  // Composite `in` isn't expressible through PostgREST, so filter on one
  // column and narrow the rest in memory.
  const { data: cached, error } = await db
    .from('track_credits')
    .select('artist_key, track_key, artists, source, updated_at')
    .in('track_key', [...new Set(wanted.map((w) => w.track_key))]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const known = new Map((cached ?? []).map((c) => [keyOf(c), c]));
  const credits = {};
  const misses = [];
  for (const w of wanted) {
    const c = known.get(keyOf(w));
    const stale = c?.source === 'none' && Date.now() - new Date(c.updated_at).getTime() > RECHECK_MS;
    if (c && !stale) credits[keyOf(w)] = c.artists;
    else misses.push(w);
  }

  if (!misses.length) return NextResponse.json({ credits, pending: 0 });
  if (Date.now() < pausedUntil) {
    return NextResponse.json({ credits, pending: misses.length, retryAfter: Math.ceil((pausedUntil - Date.now()) / 1000) });
  }

  const looked = await inBatches(misses.slice(0, MAX_SEARCH), CONCURRENCY, async (w) => {
    try {
      return { w, ok: true, artists: await findCredits(w.artist, w.track) };
    } catch (e) {
      if (e.rateLimited) pausedUntil = Date.now() + (e.retryAfter ?? 5) * 1000;
      return { w, ok: false };
    }
  });

  const done = looked.filter((l) => l.ok);
  const found = done.filter((l) => l.artists?.length);
  const none = done.filter((l) => !l.artists?.length);
  const toItem = (l) => ({ artist: l.w.artist, track: l.w.track, artists: l.artists ?? [] });
  await Promise.all([
    found.length && db.rpc('save_track_credits', { p_items: found.map(toItem), p_source: 'deezer' }),
    none.length && db.rpc('save_track_credits', { p_items: none.map(toItem), p_source: 'none' }),
  ]);
  for (const l of done) credits[keyOf(l.w)] = l.artists ?? [];

  const pending = misses.length - done.length;
  return NextResponse.json({
    credits, pending,
    ...(Date.now() < pausedUntil ? { retryAfter: Math.ceil((pausedUntil - Date.now()) / 1000) } : {}),
  });
}
