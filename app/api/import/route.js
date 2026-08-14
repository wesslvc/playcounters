import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BATCH = 2000;

/** Spotify's extended streaming history: real timestamps and real durations. */
function fromSpotify(batch, userId) {
  const rows = [];
  const seen = new Set();
  for (const r of batch) {
    const track = r.master_metadata_track_name;
    const artist = r.master_metadata_album_artist_name;
    if (!track || !artist || !r.ts) continue;      // podcasts and audiobooks
    if (seen.has(r.ts)) continue;                  // same timestamp twice in one batch
    seen.add(r.ts);
    rows.push({
      user_id: userId,
      played_at: r.ts,
      track,
      artist,
      album: r.master_metadata_album_album_name ?? null,
      ms_played: r.ms_played ?? 0,
      source: 'import',
    });
  }
  return rows;
}

/**
 * YouTube Takeout, already parsed in the browser.
 *
 * ms_played is 0 because the export simply doesn't record it — the ranking
 * counts these by play instead of pretending to know a duration.
 */
function fromYouTube(batch, userId) {
  const rows = [];
  const seen = new Set();
  for (const r of batch) {
    if (!r?.track || !r?.artist || !r?.played_at) continue;
    const ts = new Date(r.played_at);
    if (Number.isNaN(ts.getTime())) continue;
    const iso = ts.toISOString();
    if (seen.has(iso)) continue;
    seen.add(iso);
    rows.push({
      user_id: userId,
      played_at: iso,
      track: String(r.track).slice(0, 500),
      artist: String(r.artist).slice(0, 500),
      album: null,
      ms_played: 0,
      source: 'youtube',
    });
  }
  return rows;
}

/**
 * Accepts one batch of already-parsed plays.
 *
 * The browser does the parsing and posts in chunks, because a full export
 * easily exceeds the 4.5 MB request body limit on Vercel functions — and for
 * YouTube, because the export is HTML measured in hundreds of megabytes.
 */
export async function POST(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const { batch, source = 'spotify' } = body ?? {};
  if (!Array.isArray(batch)) {
    return NextResponse.json({ error: 'batch must be an array' }, { status: 400 });
  }
  if (batch.length > MAX_BATCH) {
    return NextResponse.json({ error: `batch too large (max ${MAX_BATCH})` }, { status: 413 });
  }
  if (source !== 'spotify' && source !== 'youtube') {
    return NextResponse.json({ error: 'unknown source' }, { status: 400 });
  }

  const rows = source === 'youtube'
    ? fromYouTube(batch, userId)
    : fromSpotify(batch, userId);

  if (!rows.length) return NextResponse.json({ inserted: 0, skipped: batch.length });

  const { error } = await db
    .from('plays')
    .upsert(rows, { onConflict: 'user_id,played_at', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ inserted: rows.length, skipped: batch.length - rows.length });
}
