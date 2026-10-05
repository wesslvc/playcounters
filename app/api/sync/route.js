import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { syncUser, USER_COLUMNS } from '@/lib/sync';
import { findCredits } from '@/lib/credits';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Called every 20 minutes (Supabase pg_cron, with GitHub Actions as backup) with:
 *   Authorization: Bearer $CRON_SECRET
 *
 * Spotify only remembers a listener's last 50 plays, so the polling interval
 * is what decides whether anything is lost — and how fresh the numbers are.
 */
export async function GET(req) {
  // Two callers, each with its own token: GitHub Actions (CRON_SECRET) and
  // Supabase pg_cron (SUPABASE_CRON_SECRET), so either can be rotated alone.
  const auth = req.headers.get('authorization');
  const allowed = [process.env.CRON_SECRET, process.env.SUPABASE_CRON_SECRET]
    .filter(Boolean).map((s) => `Bearer ${s}`);
  if (!allowed.includes(auth)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: users, error } = await db.from('users').select(USER_COLUMNS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const report = [];

  for (const user of users) {
    try {
      const { added } = await syncUser(user);
      report.push({ user: user.spotify_id, added });
    } catch (e) {
      console.error('sync failed for', user.spotify_id, e);
      report.push({ user: user.spotify_id, error: String(e.message || e) });
    }
  }

  // Merge any new combined artist names ("A, B") into their main artist and
  // any obvious duplicate names or titles, then fill in credits for the most-played tracks still missing them, a
  // small batch per run. Best effort: neither ever fails the sync.
  const { error: splitErr } = await db.rpc('split_combined_artists');
  if (splitErr) console.error('split_combined_artists failed', splitErr.message);
  const { error: dupErr } = await db.rpc('merge_obvious_duplicates');
  if (dupErr) console.error('merge_obvious_duplicates failed', dupErr.message);
  let credited = 0;
  try {
    credited = await backfillCredits(CREDIT_BATCH);
  } catch (e) {
    console.error('credit backfill failed', e);
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), report, credited });
}

const CREDIT_BATCH = 20;

async function backfillCredits(limit) {
  const { data, error } = await db.rpc('tracks_missing_credits', { p_limit: limit });
  if (error) throw error;
  const found = [];
  const none = [];
  for (let i = 0; i < (data ?? []).length; i += 3) {
    await Promise.all(data.slice(i, i + 3).map(async ({ artist, track }) => {
      try {
        const artists = await findCredits(artist, track);
        (artists?.length ? found : none).push({ artist, track, artists: artists ?? [] });
      } catch {
        // rate limited or unreachable: leave it for the next run
      }
    }));
  }
  if (found.length) await db.rpc('save_track_credits', { p_items: found, p_source: 'deezer' });
  if (none.length) await db.rpc('save_track_credits', { p_items: none, p_source: 'none' });
  return found.length;
}
