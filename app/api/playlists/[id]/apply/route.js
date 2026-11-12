import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/db';
import { spotifyFor } from '@/lib/spotifyUser';
import { itemsOf, MAX_SONGS } from '@/lib/playlistItems';
import { tagged, fitTarget, movesFor } from '@/lib/reorder';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NEEDS = ['playlist-read-private', 'playlist-modify-private', 'playlist-modify-public'];
const BUDGET = 40000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const denied = (status) => NextResponse.json({ error: 'Spotify가 순서 변경을 거부했어요. 내가 만든 플레이리스트만 바꿀 수 있어요.', reauth: status === 401 }, { status: 403 });

/**
 * POST /api/playlists/:id/apply — puts the playlist in the given order on Spotify, two ways.
 *
 * { target, mode: 'move', current?, snapshot? } moves entries a block at a
 * time, which keeps each one's "added" date but costs a call per move. The
 * playlist is read once; the order it's left in comes back with the
 * snapshot, and the page sends both on the next call so the list isn't read
 * again while nothing else touched it. The page calls again while `left` is
 * above zero, waiting `wait` seconds when Spotify asks it to slow down.
 *
 * { target, mode: 'replace', from? } writes the whole order afresh: the first
 * hundred replace the playlist, the rest are added a hundred at a time — a
 * handful of calls for any size, but every song's "added" date becomes now,
 * and local files (which Spotify won't add from outside) rule it out. If it
 * stops partway, the page calls again with `from` and it carries on adding
 * from there, so nothing is lost.
 */
export async function POST(req, { params }) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const target = (Array.isArray(body?.target) ? body.target : []).map(String).slice(0, MAX_SONGS + 100);
  if (!target.length) return NextResponse.json({ error: 'no order' }, { status: 400 });
  const mode = body?.mode === 'replace' ? 'replace' : 'move';

  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return NextResponse.json({ error: sp.error, reauth: sp.reauth ?? false }, { status: sp.status });
  const id = encodeURIComponent(params.id);
  const read = async () => {
    const got = await itemsOf(sp.call, id, MAX_SONGS + 100);
    if (!got.items) return { status: got.status };
    return { uris: got.items.map((x) => x.uri ?? `none:${x.pos}`) };
  };
  const until = Date.now() + BUDGET;

  if (mode === 'replace') {
    const from = Math.max(0, Math.floor(Number(body?.from) || 0));
    if (from === 0) {
      // only the same songs in a new order: nothing may go missing by being rewritten
      const now = await read();
      if (!now.uris) return now.status === 401 || now.status === 403 ? denied(now.status) : NextResponse.json({ error: `playlist failed: ${now.status}` }, { status: 502 });
      if (now.uris.some((u) => !/^spotify:(track|episode):/.test(u))) {
        return NextResponse.json({ error: '로컬 파일이나 지워진 곡이 있어서 빠르게 저장할 수 없어요. 날짜 유지로 저장해 주세요.' }, { status: 400 });
      }
      const same = (a, b) => { const x = [...a].sort(); const y = [...b].sort(); return x.length === y.length && x.every((u, k) => u === y[k]); };
      if (!same(now.uris, target)) return NextResponse.json({ error: '그사이 플레이리스트가 바뀌었어요. 다시 불러와서 짜 주세요.' }, { status: 409 });
    }
    let path = `/playlists/${id}/items`;
    let at = from;
    while (at < target.length) {
      if (Date.now() > until) return NextResponse.json({ from: at, left: target.length - at, total: target.length });
      const chunk = target.slice(at, at + 100);
      const method = at === 0 ? 'PUT' : 'POST';
      let res = await sp.call(path, { method, body: JSON.stringify({ uris: chunk }) });
      if ((res.status === 404 || res.status === 405) && path.endsWith('/items')) {
        path = `/playlists/${id}/tracks`;
        res = await sp.call(path, { method, body: JSON.stringify({ uris: chunk }) });
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after')) || 5;
        if (wait <= 8 && Date.now() + wait * 1000 < until) { await sleep(wait * 1000); continue; }
        console.log(`apply · replace · at ${at}/${target.length} · wait ${wait}s`);
        return NextResponse.json({ from: at, left: target.length - at, total: target.length, wait });
      }
      if (res.status === 401 || res.status === 403) return denied(res.status);
      if (!res.ok) return NextResponse.json({ error: `저장하다 멈췄어요 (${res.status}). 다시 누르면 이어서 저장해요.`, from: at, left: target.length - at }, { status: 502 });
      at += chunk.length;
    }
    console.log(`apply · replace · ${target.length} songs`);
    return NextResponse.json({ from: at, left: 0, total: target.length });
  }

  // moving, a block at a time: the list as the last call left it, unless something else changed it since
  let uris = Array.isArray(body?.current) ? body.current.map(String) : null;
  if (uris && body?.snapshot) {
    const res = await sp.call(`/playlists/${id}?fields=snapshot_id`);
    const snap = res.ok ? (await res.json()).snapshot_id : null;
    if (snap !== body.snapshot) uris = null;
  } else {
    uris = null;
  }
  if (!uris) {
    const now = await read();
    if (!now.uris) return now.status === 401 || now.status === 403 ? denied(now.status) : NextResponse.json({ error: `playlist failed: ${now.status}` }, { status: 502 });
    uris = now.uris;
  }

  const current = tagged(uris);
  const want = fitTarget(current, tagged(target));
  const moves = movesFor(current, want);
  const cur = [...uris];
  let path = `/playlists/${id}/items`;
  let snapshot = body?.snapshot ?? null;
  let done = 0;
  let wait = null;
  for (const m of moves) {
    if (Date.now() > until) break;
    const payload = JSON.stringify({ range_start: m.from, insert_before: m.to, range_length: m.len ?? 1 });
    let res = await sp.call(path, { method: 'PUT', body: payload });
    if ((res.status === 404 || res.status === 405) && path.endsWith('/items')) {
      path = `/playlists/${id}/tracks`;
      res = await sp.call(path, { method: 'PUT', body: payload });
    }
    if (res.status === 429) {
      const w = Number(res.headers.get('retry-after')) || 5;
      if (w <= 4 && Date.now() + w * 1000 < until) { await sleep(w * 1000); continue; }
      wait = w;
      break;
    }
    if (res.status === 401 || res.status === 403) return denied(res.status);
    if (!res.ok) return NextResponse.json({ error: `순서를 바꾸다 멈췄어요 (${res.status}). 다시 누르면 이어서 저장해요.` }, { status: 502 });
    snapshot = (await res.json().catch(() => ({}))).snapshot_id ?? snapshot;
    const block = cur.splice(m.from, m.len ?? 1);
    cur.splice(m.to, 0, ...block);
    done += 1;
  }
  const left = moves.length - done;
  console.log(`apply · move · ${done} done · ${left} left${wait ? ` · wait ${wait}s` : ''}`);
  return NextResponse.json({ done, left, total: moves.length, ...(wait ? { wait } : {}), current: cur, snapshot });
}
