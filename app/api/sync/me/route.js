import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { syncUser, USER_COLUMNS } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The dashboard's refresh button. Same work as /api/sync, but scoped to the
 * signed-in user and authorised by the session cookie instead of
 * CRON_SECRET — the browser must never see that secret.
 */

// recently-played barely moves faster than this, and the button is easy to
// lean on. Cheaper to answer from the last result than to spend a Spotify call.
const COOLDOWN_MS = 10_000;

export async function POST() {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const { data: user, error } = await db
    .from('users')
    .select(USER_COLUMNS)
    .eq('id', userId)
    .single();
  if (error || !user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }

  if (user.last_synced_at &&
      Date.now() - new Date(user.last_synced_at).getTime() < COOLDOWN_MS) {
    return NextResponse.json({
      ok: true, added: 0, cooled: true, last_synced_at: user.last_synced_at,
    });
  }

  try {
    const { added, syncedAt } = await syncUser(user);
    return NextResponse.json({ ok: true, added, last_synced_at: syncedAt });
  } catch (e) {
    console.error('manual sync failed for', user.spotify_id, e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 502 });
  }
}
