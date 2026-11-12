import { db } from '@/lib/db';
import { spotifyFor } from '@/lib/spotifyUser';
import { itemsOf } from '@/lib/playlistItems';

/**
 * One playlist that gathers everything: whatever song goes into the playlists
 * you made yourself also goes into the one you pick (a "tier 3" that holds
 * every song). You choose which of your playlists count; the ones that look
 * made by Spotify rather than by hand — a radio or mix saved as your own,
 * anything whose songs all went in at the same minute — start unticked.
 * Playlists made later count too unless their name looks like a radio or mix.
 *
 * Nothing already there is added twice (by Spotify id or by artist and
 * title), local files and episodes are left alone, and after turning it on
 * only songs put into a playlist since the last look are brought over, so a
 * song taken out by hand stays out. Every song it adds is written down, so
 * "자동으로 넣은 곡 빼기" can take out exactly those again. The look happens with
 * every sync (every 20 minutes); a playlist whose snapshot hasn't changed
 * isn't read again.
 */

export const NEEDS = ['playlist-read-private', 'playlist-modify-private', 'playlist-modify-public'];
const MARGIN = 10 * 60e3; // a look overlaps the last by this much; the duplicate check makes it harmless
const MAX_TARGET = 10000;
const LOG_MAX = 8000;

const settingsKey = (userId) => `collect|${userId}`;
const haveKey = (userId) => `collect-have|${userId}`;
const logKey = (userId) => `collect-log|${userId}`;

// brackets and "feat." first, then everything that isn't a letter or digit
// (in one pass the space before a bracket was eaten first and the bracket stayed)
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKC')
  .replace(/\(.*?\)|\[.*?\]|feat\..*$/gu, '')
  .replace(/[^\p{L}\p{N}]+/gu, '');
const songKey = (x) => `${norm(x.artist)}|${norm(x.track)}`;
const sig = (l) => `${l.snapshot ?? ''}|${l.count ?? ''}`;
const addable = (x) => x.song && !x.local && String(x.uri ?? '').startsWith('spotify:track:');

/** A name Spotify gives what it makes: radios, mixes, Daily Mix, This Is, On Repeat and the like. */
export const looksMade = (name) => /radio|라디오|\bmix\b|믹스|daily|discover|release radar|this is|daylist|on repeat|repeat rewind|top songs|wrapped|blend|time capsule|made for|for you|추천/i.test(String(name ?? ''));

async function readNote(key) {
  const { data } = await db.from('radio_notes').select('body').eq('key', key).maybeSingle();
  return data?.body ?? null;
}
async function writeNote(key, body) {
  const { error } = await db.from('radio_notes').upsert({ key, body, created_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export const settingsOf = (userId) => readNote(settingsKey(userId));
export const saveSettings = (userId, body) => writeNote(settingsKey(userId), body);

/** Your own playlists, with what tells a changed one from an unchanged one. */
export async function ownedPlaylists(sp) {
  const out = [];
  for (let next = '/me/playlists?limit=50'; next && out.length < 400;) {
    const res = await sp.call(next);
    if (!res.ok) throw Object.assign(new Error(`playlists failed: ${res.status}`), { status: res.status });
    const page = await res.json();
    for (const p of page.items ?? []) {
      if (!p?.id || p.owner?.id !== sp.user.spotify_id) continue;
      out.push({ id: p.id, name: p.name, count: p.items?.total ?? p.tracks?.total ?? null, snapshot: p.snapshot_id ?? null });
    }
    next = page.next;
  }
  return out;
}

/** Which of your playlists feed the gathering one, by what was ticked; ones made since count unless they look made by Spotify. */
function sourcesOf(st, lists) {
  const others = lists.filter((l) => l.id !== st.target);
  if (!Array.isArray(st.sources)) return others.filter((l) => !looksMade(l.name));
  const known = new Set(st.known ?? []);
  return others.filter((l) => st.sources.includes(l.id) || (!known.has(l.id) && st.autoNew !== false && !looksMade(l.name)));
}

/** What the gathering playlist holds, from the copy kept since the last look unless it changed since. */
async function targetHave(sp, userId, target) {
  const kept = await readNote(haveKey(userId));
  if (kept && kept.id === target.id && kept.sig === sig(target)) {
    return { ids: new Set(kept.ids), keys: new Set(kept.keys) };
  }
  const got = await itemsOf(sp.call, encodeURIComponent(target.id), MAX_TARGET);
  if (!got.items) throw Object.assign(new Error(`reading the gathering playlist failed: ${got.status}`), { status: got.status });
  const songs = got.items.filter((x) => x.song);
  return { ids: new Set(songs.map((x) => x.id).filter(Boolean)), keys: new Set(songs.map(songKey)) };
}

async function keepHave(userId, target, have, snapshot, count) {
  await writeNote(haveKey(userId), {
    id: target.id, sig: `${snapshot ?? target.snapshot ?? ''}|${count}`,
    ids: [...have.ids], keys: [...have.keys],
  });
}

/** Songs in `sources` that the gathering playlist lacks, oldest addition first, each once. With `sinceMs`, only those put in after it. */
async function missing(sp, sources, have, sinceMs) {
  const found = new Map();
  for (const l of sources) {
    const got = await itemsOf(sp.call, encodeURIComponent(l.id), 2000);
    if (!got.items) continue;
    for (const x of got.items) {
      if (!addable(x)) continue;
      const at = Date.parse(x.added_at);
      if (sinceMs != null && !(at > sinceMs)) continue;
      const k = songKey(x);
      if (have.ids.has(x.id) || have.keys.has(k) || found.has(k)) continue;
      found.set(k, { uri: x.uri, id: x.id, track: x.track, artist: x.artist, at: Number.isFinite(at) ? at : 0, from: l.name });
    }
  }
  return [...found.values()].sort((a, b) => a.at - b.at);
}

/** Appends songs to the playlist a hundred a call, writing each down; the snapshot after the last call. */
async function append(sp, userId, id, uris) {
  let snapshot = null;
  let path = `/playlists/${encodeURIComponent(id)}/items`;
  const log = (await readNote(logKey(userId))) ?? { adds: [] };
  const at = new Date().toISOString();
  try {
    for (let i = 0; i < uris.length; i += 100) {
      const chunk = uris.slice(i, i + 100);
      const body = JSON.stringify({ uris: chunk });
      let res = await sp.call(path, { method: 'POST', body });
      if ((res.status === 404 || res.status === 405) && path.endsWith('/items')) {
        path = `/playlists/${encodeURIComponent(id)}/tracks`;
        res = await sp.call(path, { method: 'POST', body });
      }
      if (!res.ok) throw Object.assign(new Error(`adding songs failed: ${res.status}`), { status: res.status, added: i });
      snapshot = (await res.json().catch(() => ({}))).snapshot_id ?? snapshot;
      log.adds.push(...chunk.map((uri) => ({ uri, at, to: id })));
    }
  } finally {
    log.adds = log.adds.slice(-LOG_MAX);
    await writeNote(logKey(userId), log);
  }
  return snapshot;
}

/**
 * The songs it put into the gathering playlist that are still there: those
 * written down, and those added inside a recorded window (from before the
 * writing-down began).
 */
async function ours(sp, userId, st) {
  const log = (await readNote(logKey(userId))) ?? { adds: [] };
  const logged = new Set(log.adds.filter((a) => a.to === st.target).map((a) => a.uri));
  const windows = (st.windows ?? []).map((w) => [Date.parse(w.from), Date.parse(w.to)]);
  const got = await itemsOf(sp.call, encodeURIComponent(st.target), MAX_TARGET);
  if (!got.items) throw Object.assign(new Error(`reading the gathering playlist failed: ${got.status}`), { status: got.status });
  const uris = new Set();
  for (const x of got.items) {
    if (!x.uri) continue;
    const at = Date.parse(x.added_at);
    if (logged.has(x.uri) || windows.some(([a, b]) => at >= a && at <= b)) uris.add(x.uri);
  }
  return { uris: [...uris], log };
}

/** Takes songs out of the playlist, a hundred a call. */
async function remove(sp, id, uris) {
  let path = `/playlists/${encodeURIComponent(id)}/items`;
  let field = 'items';
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100).map((uri) => ({ uri }));
    let res = await sp.call(path, { method: 'DELETE', body: JSON.stringify({ [field]: chunk }) });
    if ((res.status === 404 || res.status === 405) && field === 'items') {
      path = `/playlists/${encodeURIComponent(id)}/tracks`;
      field = 'tracks';
      res = await sp.call(path, { method: 'DELETE', body: JSON.stringify({ [field]: chunk }) });
    }
    if (!res.ok) throw Object.assign(new Error(`removing songs failed: ${res.status}`), { status: res.status, removed: i });
  }
}

/** For the confirm step: how many songs taking them out would take out. */
export async function addedCount(userId) {
  const st = await settingsOf(userId);
  if (!st?.target) return { count: 0 };
  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return { error: sp.error, reauth: sp.reauth, status: sp.status };
  const { uris } = await ours(sp, userId, st);
  return { count: uris.length, targetName: st.targetName };
}

/** Takes out every song it put into the gathering playlist; turns gathering off. */
export async function undoAdded(userId) {
  const st = await settingsOf(userId);
  if (!st?.target) return { removed: 0 };
  // one at a time: the sync and the button can both reach for it at once
  if (st.undoing && Date.now() - Date.parse(st.undoing) < 120e3) return { removed: 0, busy: true };
  await saveSettings(userId, { ...st, undoing: new Date().toISOString() });
  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) {
    await saveSettings(userId, { ...st, undoing: null });
    return { error: sp.error, reauth: sp.reauth, status: sp.status };
  }
  let uris = [];
  try {
    const found = await ours(sp, userId, st);
    uris = found.uris;
    if (uris.length) await remove(sp, st.target, uris);
    const gone = new Set(uris);
    await writeNote(logKey(userId), { adds: found.log.adds.filter((a) => !(a.to === st.target && gone.has(a.uri))) });
    await writeNote(haveKey(userId), {}); // read the playlist fresh next time
  } catch (e) {
    await saveSettings(userId, { ...st, undoing: null });
    throw e;
  }
  // nothing left to take out right after a removal: say it was already done, not "0 songs"
  const recent = st.undone && Date.now() - Date.parse(st.undone.at) < 30 * 60e3;
  await saveSettings(userId, {
    ...st, enabled: false, pendingUndo: false, windows: [], total: 0, recent: [], undoing: null,
    undone: uris.length || !recent ? { count: uris.length, at: new Date().toISOString() } : st.undone,
  });
  return { removed: uris.length, ...(uris.length || !recent ? {} : { already: st.undone }) };
}

/**
 * For the setup screen: your playlists other than the gathering one, each
 * read once to see whether it looks made by hand (songs added over time) or
 * saved whole (every song in at the same minute, or a radio/mix name), with
 * which to tick to begin with.
 */
export async function survey(userId, targetId) {
  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return { error: sp.error, reauth: sp.reauth, status: sp.status };
  const st = (await settingsOf(userId)) ?? {};
  const lists = await ownedPlaylists(sp);
  if (!lists.some((l) => l.id === targetId)) return { error: '내 플레이리스트만 고를 수 있어요.', status: 400 };
  const chosen = st.target === targetId && Array.isArray(st.sources) ? new Set(st.sources) : null;
  const out = [];
  for (const l of lists.filter((x) => x.id !== targetId)) {
    const got = await itemsOf(sp.call, encodeURIComponent(l.id), 2000);
    const minutes = new Map();
    for (const x of got.items ?? []) {
      const m = String(x.added_at ?? '').slice(0, 16);
      if (m) minutes.set(m, (minutes.get(m) ?? 0) + 1);
    }
    const n = got.items?.length ?? 0;
    const top = Math.max(0, ...minutes.values());
    const whole = n >= 8 && top / n >= 0.8;
    const reason = looksMade(l.name) ? '라디오·믹스 같아요' : whole ? '한 번에 저장된 플리예요' : null;
    out.push({ id: l.id, name: l.name, count: l.count ?? n, reason, on: chosen ? chosen.has(l.id) : !reason });
  }
  return { playlists: out, autoNew: st.autoNew !== false };
}

/** For the setup screen: what turning it on would bring over now from the ticked playlists. */
export async function preview(userId, targetId, sourceIds) {
  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return { error: sp.error, reauth: sp.reauth, status: sp.status };
  const lists = await ownedPlaylists(sp);
  const target = lists.find((l) => l.id === targetId);
  if (!target) return { error: '내 플레이리스트만 고를 수 있어요.', status: 400 };
  const sources = lists.filter((l) => l.id !== targetId && sourceIds.includes(l.id));
  const have = await targetHave(sp, userId, target);
  const songs = await missing(sp, sources, have, null);
  return { count: songs.length, sample: songs.slice(-5).reverse().map((s) => ({ track: s.track, artist: s.artist, from: s.from })), sources: sources.length };
}

/**
 * Turns it on for `targetId` from the ticked playlists. With `backfill`, what
 * they hold now is added first; either way only later additions are gathered
 * after this.
 */
export async function enable(userId, targetId, sourceIds, autoNew, backfill) {
  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return { error: sp.error, reauth: sp.reauth, status: sp.status };
  const prev = (await settingsOf(userId)) ?? {};
  const lists = await ownedPlaylists(sp);
  const target = lists.find((l) => l.id === targetId);
  if (!target) return { error: '내 플레이리스트만 고를 수 있어요.', status: 400 };
  const startedAt = Date.now();
  const st = { target: target.id, sources: sourceIds, known: lists.map((l) => l.id), autoNew };
  const sources = sourcesOf(st, lists);
  const have = await targetHave(sp, userId, target);
  let added = [];
  let snapshot = null;
  if (backfill) {
    added = await missing(sp, sources, have, null);
    if (added.length) snapshot = await append(sp, userId, target.id, added.map((s) => s.uri));
    for (const s of added) { have.ids.add(s.id); have.keys.add(songKey(s)); }
  }
  await keepHave(userId, target, have, snapshot, (target.count ?? 0) + added.length);
  await saveSettings(userId, {
    ...st,
    windows: prev.target === target.id ? prev.windows ?? [] : [],
    enabled: true, targetName: target.name, since: startedAt,
    sigs: Object.fromEntries(lists.filter((l) => l.id !== target.id).map((l) => [l.id, sig(l)])),
    checkedAt: new Date().toISOString(), total: added.length,
    recent: added.slice(-12).reverse().map((s) => ({ track: s.track, artist: s.artist, from: s.from, at: new Date().toISOString() })),
  });
  return { added: added.length };
}

/** Saves which playlists count, without adding anything now. */
export async function setSources(userId, sourceIds, autoNew) {
  const st = await settingsOf(userId);
  if (!st?.target) return { error: '먼저 모을 플리를 골라 주세요.', status: 400 };
  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return { error: sp.error, reauth: sp.reauth, status: sp.status };
  const lists = await ownedPlaylists(sp);
  await saveSettings(userId, { ...st, sources: sourceIds, known: lists.map((l) => l.id), autoNew });
  return { ok: true };
}

export async function disable(userId) {
  const st = (await settingsOf(userId)) ?? {};
  await saveSettings(userId, { ...st, enabled: false });
}

/**
 * One look: songs put into the counted playlists since the last look go into
 * the gathering playlist. Unchanged playlists aren't read. A removal asked
 * for and not yet done is done first. Called from every sync and from the
 * "지금 확인" button.
 */
export async function collectNew(userId) {
  let st = await settingsOf(userId);
  if (st?.pendingUndo) {
    const r = await undoAdded(userId);
    console.log(`collect · took out ${r.removed ?? 0} songs it had added`);
    return { removed: r.removed ?? 0 };
  }
  if (!st?.enabled || !st.target) return null;
  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return { error: sp.error };
  const lookedAt = Date.now();
  const lists = await ownedPlaylists(sp);
  const target = lists.find((l) => l.id === st.target);
  if (!target) {
    await saveSettings(userId, { ...st, enabled: false, problem: '모으던 플레이리스트를 찾지 못해 자동 모으기를 껐어요.' });
    return { error: 'target gone' };
  }
  const sources = sourcesOf(st, lists);
  const changed = sources.filter((l) => st.sigs?.[l.id] !== sig(l));
  let added = [];
  if (changed.length) {
    const have = await targetHave(sp, userId, target);
    added = await missing(sp, changed, have, (st.since ?? lookedAt) - MARGIN);
    let snapshot = null;
    if (added.length) snapshot = await append(sp, userId, target.id, added.map((s) => s.uri));
    for (const s of added) { have.ids.add(s.id); have.keys.add(songKey(s)); }
    await keepHave(userId, target, have, snapshot, (target.count ?? 0) + added.length);
  }
  st = (await settingsOf(userId)) ?? st;
  const now = new Date().toISOString();
  await saveSettings(userId, {
    ...st,
    targetName: target.name,
    since: lookedAt,
    sigs: Object.fromEntries(lists.filter((l) => l.id !== target.id).map((l) => [l.id, sig(l)])),
    checkedAt: now,
    total: (st.total ?? 0) + added.length,
    recent: [...[...added].reverse().map((s) => ({ track: s.track, artist: s.artist, from: s.from, at: now })), ...(st.recent ?? [])].slice(0, 12),
    problem: null,
  });
  return { added: added.length, looked: changed.length };
}
