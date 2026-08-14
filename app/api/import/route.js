import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Accepts one batch of already-parsed plays.
 *
 * The browser parses the Spotify JSON and posts it in chunks, because a full
 * export easily exceeds the 4.5 MB request body limit on Vercel functions.
 */
export async function POST(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  let batch;
  try {
    ({ batch } = await req.json());
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!Array.isArray(batch)) {
    return NextResponse.json({ error: 'batch must be an array' }, { status: 400 });
  }
  if (batch.length > 2000) {
    return NextResponse.json({ error: 'batch too large (max 2000)' }, { status: 413 });
  }

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

  if (!rows.length) return NextResponse.json({ inserted: 0, skipped: batch.length });

  const { error } = await db
    .from('plays')
    .upsert(rows, { onConflict: 'user_id,played_at', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ inserted: rows.length, skipped: batch.length - rows.length });
}
