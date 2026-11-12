import { ask } from '@/lib/openai';
import { tempoGap } from '@/lib/reorder';

/**
 * "비슷한 곡끼리" for a playlist of any size, in three steps. The model first
 * reads the whole playlist at a glance (its artists and a sample of songs)
 * and names the groups it falls into, in a good order to listen through.
 * Then every song is put in one of those groups, a couple of hundred songs
 * per call, all at once. Inside a group the songs are lined up here, without
 * the model: same artists together, each next song the nearest in tempo and
 * energy. One model call per 200 songs keeps a thousand-song playlist well
 * inside a minute, where one call over the whole list would not finish.
 */

const PER_CALL = 200;

const NAMES = {
  type: 'object', additionalProperties: false, required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'about'],
        properties: { name: { type: 'string' }, about: { type: 'string' } },
      },
    },
  },
};

const ASSIGN = {
  type: 'object', additionalProperties: false, required: ['assign'],
  properties: {
    assign: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['i', 'g'],
        properties: { i: { type: 'integer' }, g: { type: 'integer' } },
      },
    },
  },
};

const pct = (v) => (v == null ? undefined : Math.round(Number(v) * 100));
const brief = (s, j) => ({
  i: j, t: s.track, a: s.artist,
  ...(s.tempo != null ? { bpm: s.tempo } : {}),
  ...(s.energy != null ? { e: pct(s.energy) } : {}),
  ...(s.valence != null ? { v: pct(s.valence) } : {}),
  ...(s.acoustic != null ? { ac: pct(s.acoustic) } : {}),
});

/** Each next song the nearest to the last one: same artist first, then tempo and energy. */
function lineUp(list) {
  if (list.length < 3) return list;
  const left = [...list];
  // start from the calmest, so a group opens gently and builds
  left.sort((a, b) => (a.energy ?? 0.5) - (b.energy ?? 0.5));
  const out = [left.shift()];
  while (left.length) {
    const last = out[out.length - 1];
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < left.length; k += 1) {
      const s = left[k];
      const g = tempoGap(last.tempo, s.tempo);
      const d = (g == null ? 0.6 : g / 20)
        + (last.energy == null || s.energy == null ? 0.4 : Math.abs(last.energy - s.energy) * 3)
        + (last.artist === s.artist ? -0.8 : 0);
      if (d < bestD) { bestD = d; best = k; }
    }
    out.push(left.splice(best, 1)[0]);
  }
  return out;
}

/**
 * Groups for `songs` ({ i, track, artist, tempo, energy, valence, acoustic }),
 * and the order they make: { groups: [{ name, about }], of: Map(song.i -> group),
 * order: [song.i, ...] }.
 */
export async function groupSongs(songs, { model, prompt = '', budgetMs = 46000 } = {}) {
  // the whole thing has to fit in one server call (a minute, with the playlist read before it)
  const until = Date.now() + budgetMs;
  const n = songs.length;
  const want = Math.max(4, Math.min(14, Math.round(n / 45)));
  const artists = new Map();
  for (const s of songs) artists.set(s.artist, (artists.get(s.artist) ?? 0) + 1);
  const step = Math.max(1, Math.floor(n / 150));
  const sample = songs.filter((_, j) => j % step === 0).slice(0, 150).map(brief);

  const named = await ask(model,
    '너는 플레이리스트를 정리하는 큐레이터다. 이 플레이리스트를 분위기·장르·소리가 비슷한 곡끼리 묶을 그룹을 정한다. '
    + `그룹은 ${want}개 안팎, 곡이 고르게 나뉘게. 이름은 한국어로 짧게(12자 안팎, 예: "잔잔한 어쿠스틱", "K-pop 댄스", "영화음악"), about은 어떤 곡이 들어가는지 한 줄. `
    + '그룹은 이어 들을 때 자연스러운 순서로 늘어놓는다(차분한 데서 신나는 데로, 혹은 비슷한 결끼리 이웃하게). '
    + 'artists는 가수별 곡 수, sample은 곡 일부: t 제목, a 가수, bpm 템포, e 에너지, v 밝은 느낌, ac 어쿠스틱(0-100).'
    + (prompt ? ` 이 사람의 요청: "${prompt}". 요청에 맞춰 그룹을 정한다.` : ''),
    { songs: n, artists: [...artists].sort((a, b) => b[1] - a[1]).slice(0, 200), sample },
    NAMES, AbortSignal.timeout(18000), 'low');
  const groups = (named.groups ?? []).slice(0, 16).filter((g) => g?.name);
  if (!groups.length) throw new Error('no groups');

  const list = groups.map((g, k) => `${k}: ${g.name} — ${g.about}`).join('\n');
  const chunks = [];
  for (let k = 0; k < n; k += PER_CALL) chunks.push(songs.slice(k, k + PER_CALL));
  const answers = await Promise.all(chunks.map((chunk, c) => ask(model,
    `너는 곡을 그룹에 나누는 큐레이터다. 그룹:\n${list}\n`
    + '각 곡(i 번호, t 제목, a 가수, bpm, e 에너지, v 밝은 느낌, ac 어쿠스틱)을 가장 잘 맞는 그룹 번호 g 하나에 넣는다. 모든 곡을 빠짐없이 한 번씩.',
    { songs: chunk.map((s, j) => brief(s, c * PER_CALL + j)) },
    ASSIGN, AbortSignal.timeout(Math.max(12000, until - Date.now())), 'low').catch(() => ({ assign: [] }))));

  // a song the answers missed goes where most of its artist's songs went, else into the last group
  const of = new Map();
  for (const a of answers.flatMap((x) => x.assign ?? [])) {
    const s = songs[a.i];
    if (s && Number.isInteger(a.g) && a.g >= 0 && a.g < groups.length && !of.has(s.i)) of.set(s.i, a.g);
  }
  // most calls came back empty (timed out): better to say so than to hand back one big leftover group
  if (of.size < n * 0.5) throw new Error(`only ${of.size} of ${n} songs placed`);
  const byArtist = new Map();
  for (const s of songs) {
    if (!of.has(s.i)) continue;
    const m = byArtist.get(s.artist) ?? new Map();
    m.set(of.get(s.i), (m.get(of.get(s.i)) ?? 0) + 1);
    byArtist.set(s.artist, m);
  }
  for (const s of songs) {
    if (of.has(s.i)) continue;
    const m = byArtist.get(s.artist);
    of.set(s.i, m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : groups.length - 1);
  }

  const order = [];
  groups.forEach((_, g) => {
    for (const s of lineUp(songs.filter((x) => of.get(x.i) === g))) order.push(s.i);
  });
  return { groups, of, order, missed: n - answers.reduce((t, x) => t + (x.assign?.length ?? 0), 0) };
}
