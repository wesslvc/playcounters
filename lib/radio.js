/**
 * Race radio: what's happening in whatever ranking is on screen, worked out
 * from the numbers alone — fights, overtakes, gaps closing, who is on course
 * to pass whom and when, milestones in reach. The AI only rewords these;
 * every figure in a message comes from here.
 *
 * Rows are ranked the list's way (plays, then whoever got there later) and
 * carry `plays`, `last_at`, `artist_key`, `track_key`.
 */

const DAY = 864e5;

export const keyOf = (r) => `${r.artist_key}\u0000${r.track_key ?? ''}`;
// a title without its bracketed tail — "Lose My Mind", not "(feat. …) [From …]"
const short = (s) => String(s ?? '').replace(/\s*[([（［].*$/, '').trim() || String(s ?? '');
const nameOf = (r) => (r.track ? short(r.track) : r.artist);
const who = (r) => (r.track ? `${short(r.track)} (${r.artist})` : r.artist);
const target = (r) => ({ artist: r.artist, track: r.track ?? null, artist_key: r.artist_key, track_key: r.track_key ?? null });
const n = (v) => Math.round(Number(v)).toLocaleString('ko-KR');

/** Rank like the list: plays, then the later arrival ahead. */
export function ranked(rows) {
  return [...(rows ?? [])].sort((a, b) =>
    Number(b.plays) - Number(a.plays) || new Date(b.last_at) - new Date(a.last_at));
}

const etaLabel = (days) => {
  if (days < 1 / 24) return '곧';
  if (days < 1) return `약 ${Math.max(1, Math.round(days * 24))}시간 뒤`;
  return `약 ${Math.round(days)}일 뒤`;
};

/**
 * Events for one ranking.
 * @param now   ranked rows now
 * @param then  the same window as it stood a few days ago (or null)
 * @param pace  plays per day over the last week, by key (or null)
 * @param opts  { top, live, endsAt (ms) }
 */
export function rankingEvents(now, then, pace, { top = 10, live = true, endsAt = null } = {}) {
  const out = [];
  const rows = now.slice(0, top);
  const thenRank = new Map((then ?? []).map((r, i) => [keyOf(r), i + 1]));
  const thenPlays = new Map((then ?? []).map((r) => [keyOf(r), Number(r.plays)]));
  const rate = (r) => pace?.get(keyOf(r)) ?? 0;

  rows.forEach((r, i) => {
    const pos = i + 1;
    const before = thenRank.get(keyOf(r));
    // overtakes: up at least one place inside the top since then
    if (before && before > pos) {
      const passed = rows.slice(i + 1).filter((x) => (thenRank.get(keyOf(x)) ?? 99) < before).map(nameOf);
      out.push({
        kind: 'overtake', weight: pos <= 3 ? 90 : 60 - pos,
        title: pos === 1 ? 'NEW LEADER' : `P${before} → P${pos}`,
        text: `${who(r)}, P${before}에서 P${pos}로${passed.length ? ` · ${passed.slice(0, 2).join(', ')} 추월` : ''}`,
        target: target(r),
      });
    }
    if (i === 0) return;
    const ahead = rows[i - 1];
    const gap = Number(ahead.plays) - Number(r.plays);
    // a fight: within a couple of plays
    if (gap <= Math.max(2, Math.round(Number(ahead.plays) * 0.02))) {
      out.push({
        kind: 'battle', weight: pos <= 4 ? 80 - pos : 40 - pos,
        title: `BATTLE FOR P${pos - 1}`,
        text: `${nameOf(ahead)} vs ${nameOf(r)}, ${gap === 0 ? '동률' : `${n(gap)}회 차`}`,
        target: target(r),
      });
    }
    // the gap closed hard since then
    const ta = thenPlays.get(keyOf(ahead));
    const tb = thenPlays.get(keyOf(r));
    if (ta != null && tb != null) {
      const was = ta - tb;
      if (was - gap >= Math.max(4, was * 0.4) && gap > 0) {
        out.push({
          kind: 'closing', weight: 55 - pos,
          title: `GAP P${pos - 1}–P${pos}`,
          text: `${nameOf(r)}, 앞선 ${nameOf(ahead)} 상대 격차 ${n(was)} → ${n(gap)}회`,
          target: target(r),
        });
      }
    }
    // on course to pass: the chaser's pace beats the car ahead
    if (live && pace) {
      const closing = rate(r) - rate(ahead);
      if (closing > 0.05 && gap > 0) {
        const days = (gap + 0.5) / closing;
        const at = Date.now() + days * DAY;
        if (days <= 45 && (!endsAt || at < endsAt)) {
          out.push({
            kind: 'eta', weight: 50 - pos + (days < 3 ? 15 : 0),
            title: `P${pos} → P${pos - 1} 예상`,
            text: `${nameOf(r)}, 지금 페이스면 ${etaLabel(days)} ${nameOf(ahead)} 추월 (하루 ${rate(r).toFixed(1)} vs ${rate(ahead).toFixed(1)}회)`,
            target: target(r),
          });
        }
      }
    }
  });

  if (rows.length >= 2) {
    const lead = Number(rows[0].plays) - Number(rows[1].plays);
    out.push({
      kind: 'lead', weight: 10,
      title: 'LEADER',
      text: `${who(rows[0])}, ${lead === 0 ? '공동 선두' : `${n(lead)}회 차 선두`}`,
      target: target(rows[0]),
    });
  }
  return out;
}

/**
 * Milestones in reach: an all-time total within a week's pace (or a few
 * plays) of a mark, and marks passed in the last few days.
 */
export function milestoneEvents(rows, then, pace, marks, { unit = '회', label }) {
  const out = [];
  const before = new Map((then ?? []).map((r) => [keyOf(r), Number(r.plays)]));
  for (const r of rows) {
    const p = Number(r.plays);
    const prev = before.get(keyOf(r));
    const rate = pace?.get(keyOf(r)) ?? 0;
    for (const m of marks) {
      if (prev != null && prev < m && p >= m) {
        out.push({
          kind: 'hit', weight: 85 + m / 1000,
          title: `${label(m)} 달성`,
          text: `${who(r)}, 통산 ${n(m)}${unit} 돌파`,
          target: target(r),
        });
      } else if (p < m) {
        const left = m - p;
        if (left <= Math.max(3, rate * 7)) {
          const days = rate > 0 ? left / rate : null;
          out.push({
            kind: 'near', weight: 45 + m / 1000 - left / 10,
            title: `${label(m)} 임박`,
            text: `${who(r)}, ${n(m)}${unit}까지 ${n(left)}${unit}${days != null ? ` · ${etaLabel(days)}` : ''}`,
            target: target(r),
          });
        }
        break; // only the next mark up counts
      }
    }
  }
  return out;
}

/** The few that matter most, one per subject where possible. */
export function pick(events, max = 6) {
  const seen = new Map();
  const out = [];
  for (const e of [...events].sort((a, b) => b.weight - a.weight)) {
    const k = `${e.kind}|${e.target ? keyOf(e.target) : e.title}`;
    if (seen.has(k)) continue;
    seen.set(k, true);
    out.push(e);
    if (out.length === max) break;
  }
  return out;
}
