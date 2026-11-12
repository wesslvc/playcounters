import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/db';
import { settingsOf, survey, preview, enable, setSources, disable, collectNew, addedCount, undoAdded } from '@/lib/collect';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const fail = (e) => {
  console.error('collect failed', e.message);
  const reauth = e.status === 401 || e.status === 403;
  return NextResponse.json({ error: reauth ? 'Spotify가 플레이리스트 수정을 거부했어요. 다시 연결해 주세요.' : '플레이리스트를 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.', reauth }, { status: reauth ? 403 : 502 });
};
const answer = (r) => (r?.error ? NextResponse.json(r, { status: r.status ?? 400 }) : NextResponse.json(r ?? {}));
const ids = (v) => (Array.isArray(v) ? v.map(String).slice(0, 400) : []);

/**
 * GET /api/collect — the gathering playlist's settings and last look.
 * GET /api/collect?setup=<playlist id> — your other playlists, with which look made by hand.
 * GET /api/collect?added=1 — how many songs it put in that are still there.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  try {
    if (q.get('setup')) return answer(await survey(userId, q.get('setup')));
    if (q.get('added')) return answer(await addedCount(userId));
    const st = await settingsOf(userId);
    return NextResponse.json({ settings: st ? { ...st, sigs: undefined, known: undefined } : null });
  } catch (e) { return fail(e); }
}

/**
 * POST /api/collect
 *   { action: 'preview', target, sources }        what turning it on would add now
 *   { action: 'enable', target, sources, autoNew, backfill }
 *   { action: 'sources', sources, autoNew }      which playlists count, nothing added now
 *   { action: 'run' }                            look now
 *   { action: 'undo' }                           take out every song it added, and turn off
 *   { action: 'disable' }
 */
export async function POST(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    switch (body.action) {
      case 'preview':
        if (!body.target) return NextResponse.json({ error: '모을 플레이리스트를 골라 주세요.' }, { status: 400 });
        return answer(await preview(userId, String(body.target), ids(body.sources)));
      case 'enable':
        if (!body.target) return NextResponse.json({ error: '모을 플레이리스트를 골라 주세요.' }, { status: 400 });
        return answer(await enable(userId, String(body.target), ids(body.sources), body.autoNew !== false, Boolean(body.backfill)));
      case 'sources':
        return answer(await setSources(userId, ids(body.sources), body.autoNew !== false));
      case 'run':
        return answer((await collectNew(userId)) ?? { added: 0 });
      case 'undo':
        return answer(await undoAdded(userId));
      case 'disable':
        await disable(userId);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
  } catch (e) { return fail(e); }
}
