import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * The signed-in reader's taste, saved presets and followed phones, so they
 * follow them from one device to another. Without a playcounters login the
 * page keeps them in the browser only.
 */
export async function GET() {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ signedIn: false });
  const { data, error } = await db.from('phone_prefs').select('data, updated_at').eq('user_id', userId).maybeSingle();
  if (error) return NextResponse.json({ signedIn: true, error: error.message }, { status: 500 });
  return NextResponse.json({ signedIn: true, data: data?.data ?? null, savedAt: data ? Date.parse(data.updated_at) : 0 });
}

export async function PUT(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const text = await req.text();
  if (text.length > 64000) return NextResponse.json({ error: 'too large' }, { status: 413 });
  let body;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const data = { prefs: body.prefs ?? null, filters: body.filters ?? null, presets: Array.isArray(body.presets) ? body.presets.slice(0, 12) : [], watch: Array.isArray(body.watch) ? body.watch.slice(0, 12) : [] };
  const savedAt = Number.isFinite(body.savedAt) ? body.savedAt : Date.now();
  const { error } = await db.from('phone_prefs').upsert({ user_id: userId, data, updated_at: new Date(savedAt).toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, savedAt });
}
