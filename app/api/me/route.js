import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Who is signed in and when their plays were last pulled — the app shell's header. */
export async function GET() {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const [user, calibrated] = await Promise.all([
    db.from('users').select('display_name, avatar_url, last_synced_at').eq('id', userId).single(),
    db.rpc('has_youtube_estimate', { p_user: userId }),
  ]);
  return NextResponse.json({
    user: user.data ?? null,
    calibrated: calibrated.error ? false : Boolean(calibrated.data),
  });
}
