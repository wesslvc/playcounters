import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/db';
import { settingsOf, preview, enable, disable, collectNew } from '@/lib/collect';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const fail = (e) => {
  console.error('collect failed', e.message);
  const reauth = e.status === 401 || e.status === 403;
  return NextResponse.json({ error: reauth ? 'Spotify가 플레이리스트 수정을 거부했어요. 다시 연결해 주세요.' : '플레이리스트를 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.', reauth }, { status: reauth ? 403 : 502 });
};
const answer = (r) => (r?.error ? NextResponse.json(r, { status: r.status ?? 400 }) : NextResponse.json(r ?? {}));

/**
 * GET /api/collect — the gathering playlist's settings and last look.
 * GET /api/collect?preview=<playlist id> — what turning it on would add now.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const target = req.nextUrl.searchParams.get('preview');
  try {
    if (target) return answer(await preview(userId, target));
    const st = await settingsOf(userId);
    return NextResponse.json({ settings: st ? { ...st, sigs: undefined } : null });
  } catch (e) { return fail(e); }
}

/**
 * POST /api/collect { action: 'enable', target, backfill } | { action: 'disable' } | { action: 'run' }
 */
export async function POST(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'enable') {
      if (!body.target) return NextResponse.json({ error: '모을 플레이리스트를 골라 주세요.' }, { status: 400 });
      return answer(await enable(userId, String(body.target), Boolean(body.backfill)));
    }
    if (body.action === 'disable') { await disable(userId); return NextResponse.json({ ok: true }); }
    if (body.action === 'run') return answer((await collectNew(userId)) ?? { added: 0 });
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) { return fail(e); }
}
