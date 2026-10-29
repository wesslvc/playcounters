/**
 * Race radio: what's happening in whatever ranking is on screen, worked out
 * from the numbers alone — fights, overtakes, gaps closing, who is on course
 * to pass whom and when, whose pace is fading, milestones in reach. The AI
 * only rewords a message's line; every figure comes from here.
 *
 * Rows are ranked the list's way (plays, then whoever got there later) and
 * carry `plays`, `last_at`, `artist_key`, `track_key`.
 *
 * Paces are plays per day: `p7` over the last week, `p3` over the last three
 * days. A projection runs on the recent one; comparing the two says whether
 * a car is speeding up or fading.
 *
 * Each message: { kind, group, title, text, detail, stat: { value, unit },
 * targets: [subject, rival?] }. `group` is what the viewer filters by.
 */

const DAY = 864e5;

export const keyOf = (r) => `${r.artist_key}\u0000${r.track_key ?? ''}`;
// a title without its bracketed tail — "Lose My Mind", not "(feat. …) [From …]"
const short = (s) => String(s ?? '').replace(/\s*[([（［].*$/, '').trim() || String(s ?? '');
export const nameOf = (r) => (r.track ? short(r.track) : r.artist);
const who = (r) => (r.track ? `${short(r.track)} (${r.artist})` : r.artist);
export const targetOf = (r) => ({ artist: r.artist, track: r.track ?? null, artist_key: r.artist_key, track_key: r.track_key ?? null });
const n = (v) => Math.round(Number(v)).toLocaleString('ko-KR');
const f1 = (v) => (Math.round(v * 10) / 10).toLocaleString('ko-KR');

/** Rank like the list: plays, then the later arrival ahead. */
export function ranked(rows) {
  return [...(rows ?? [])].sort((a, b) =>
    Number(b.plays) - Number(a.plays) || new Date(b.last_at) - new Date(a.last_at));
}

/** "11시간" / "3일", and the sentence form "약 11시간 뒤". */
export const span = (days) => (days < 2 ? `${Math.max(1, Math.round(days * 24))}시간` : `${Math.round(days)}일`);
const within = (days) => (days < 1 / 24 ? '곧' : `약 ${span(days)} 뒤`);

/** Standard normal CDF (Abramowitz–Stegun). */
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * The chance a lead survives `days` more, against one chaser: plays as
 * Poisson at the last three days' rates, the spread widened by half again
 * because the rates themselves are guesses.
 */
export function holdChance(lead, rLead, rChase, days) {
  const mean = lead + (rLead - rChase) * days;
  const sd = Math.sqrt(Math.max(0.25, (rLead + rChase) * days * 1.5));
  return phi((mean - 0.5) / sd);
}
export const pct = (p) => (p >= 1 ? 100 : p <= 0 ? 0 : p >= 0.995 ? 99 : p <= 0.005 ? 1 : Math.round(p * 100));

/** Speeding up, fading, or steady: the last three days against the week. */
function trend(p3, p7) {
  if (p7 < 0.5 && p3 < 0.5) return null;
  if (p3 < p7 * 0.6) return 'down';
  if (p3 > p7 * 1.6 && p3 >= 1.5) return 'up';
  return null;
}

/**
 * Messages for one ranking.
 * @param now   ranked rows now
 * @param then  the same window as it stood a few days ago (or null)
 * @param pace  { p7, p3 } maps of plays per day by key (or null)
 * @param opts  { top, live, endsAt (ms) }
 */

export function rankingEvents(now, then, pace, { top = 10, live = true, endsAt = null } = {}) {
  const out = [];
  const rows = now.slice(0, top);
  const thenRank = new Map((then ?? []).map((r, i) => [keyOf(r), i + 1]));
  const thenPlays = new Map((then ?? []).map((r) => [keyOf(r), Number(r.plays)]));
  const p7 = (r) => pace?.p7.get(keyOf(r)) ?? 0;
  const p3 = (r) => pace?.p3.get(keyOf(r)) ?? 0;
  const daysLeft = endsAt ? Math.max(0, (endsAt - Date.now()) / DAY) : null;
  // one car's figures, for the card to lay out
  const side = (r, pos) => ({
    pos, plays: Number(r.plays),
    ...(live && pace ? { p3: p3(r), p7: p7(r), trend: trend(p3(r), p7(r)) } : {}),
  });

  rows.forEach((r, i) => {
    const pos = i + 1;
    const before = thenRank.get(keyOf(r));
    if (before && before > pos) {
      const passed = rows.slice(i + 1).filter((x) => (thenRank.get(keyOf(x)) ?? 99) < before).map(nameOf);
      out.push({
        kind: 'overtake', group: 'move', weight: pos <= 3 ? 90 - pos : 60 - pos,
        title: pos === 1 ? '새 선두' : `P${before} → P${pos}`,
        text: `${who(r)}, P${before}에서 P${pos}까지 상승`,
        detail: passed.length ? `${passed.slice(0, 2).join(', ')} 추월 · 최근 3일 하루 ${f1(p3(r))}회` : null,
        stat: { value: `P${pos}` },
        solo: { ...side(r, pos), from: before },
        targets: [targetOf(r)],
      });
    }

    // fading or surging, for the front of the field
    if (live && pace && pos <= 5) {
      const t = trend(p3(r), p7(r));
      if (t) {
        out.push({
          kind: t === 'down' ? 'fade' : 'surge', group: 'forecast', weight: 40 - pos,
          title: t === 'down' ? `P${pos} 페이스 하락` : `P${pos} 페이스 상승`,
          text: `${nameOf(r)}, 최근 3일 하루 ${f1(p3(r))}회로 ${t === 'down' ? '느려지는 중' : '빨라지는 중'}`,
          detail: `7일 평균 하루 ${f1(p7(r))}회`,
          stat: { value: f1(p3(r)), unit: '회/일' },
          solo: side(r, pos),
          targets: [targetOf(r)],
        });
      }
    }

    if (i === 0) return;
    const ahead = rows[i - 1];
    const gap = Number(ahead.plays) - Number(r.plays);
    const ta = thenPlays.get(keyOf(ahead));
    const tb = thenPlays.get(keyOf(r));
    const was = ta != null && tb != null ? ta - tb : null;
    // on course to pass, on the last three days' pace
    const closing = p3(r) - p3(ahead);
    let eta = null;
    let after = null; // on course, but not before the window closes
    if (live && pace && gap > 0 && closing > 0.05) {
      const days = (gap + 0.5) / closing;
      if (days <= 45 && (daysLeft == null || days < daysLeft)) eta = days;
      else if (days <= 90) after = days;
    }
    const duel = {
      sides: [side(r, pos), side(ahead, pos - 1)], gap, was, eta, after,
      // how the gap moves if both keep the last three days' pace
      drift: live && pace ? (closing > 0.05 ? 'closing' : closing < -0.05 ? 'opening' : 'steady') : null,
    };
    const fading = trend(p3(ahead), p7(ahead)) === 'down';

    if (gap <= Math.max(2, Math.round(Number(ahead.plays) * 0.02))) {
      out.push({
        kind: 'battle', group: 'battle', weight: (pos <= 4 ? 80 - pos : 40 - pos) + (eta != null && eta < 2 ? 5 : 0),
        title: `P${pos - 1} 경쟁`,
        text: eta != null
          ? `${nameOf(r)}, ${within(eta)} ${nameOf(ahead)} 추월 가시권`
          : `${nameOf(ahead)} vs ${nameOf(r)}, ${gap === 0 ? '동률' : `${n(gap)}회 차`} 접전${after != null ? ' · 이 페이스면 기간 안 추월은 어려움' : ''}`,
        detail: pace ? `최근 3일 하루 ${f1(p3(ahead))}회 vs ${f1(p3(r))}회` : null,
        stat: gap === 0 ? { value: '동률' } : { value: n(gap), unit: '회 차' },
        duel, targets: [targetOf(r), targetOf(ahead)],
      });
    } else if (eta != null) {
      out.push({
        kind: 'eta', group: 'forecast', weight: 50 - pos + (eta < 3 ? 15 : 0),
        title: `P${pos} → P${pos - 1} 예상`,
        text: `${nameOf(r)}, ${within(eta)} ${nameOf(ahead)} 추월 예상${fading ? ` · ${nameOf(ahead)} 페이스 하락 중` : ''}`,
        detail: `최근 3일 하루 ${f1(p3(r))}회 vs ${f1(p3(ahead))}회 · 7일 평균 ${f1(p7(r))} vs ${f1(p7(ahead))}`,
        stat: { value: span(eta) },
        duel, targets: [targetOf(r), targetOf(ahead)],
      });
    } else if (was != null && was - gap >= Math.max(4, was * 0.4) && gap > 0) {
      out.push({
        kind: 'closing', group: 'battle', weight: 55 - pos,
        title: `P${pos - 1}–P${pos} 격차 축소`,
        text: `${nameOf(r)}, ${nameOf(ahead)} 상대 격차 ${n(was)}회 → ${n(gap)}회`,
        detail: '최근 3일 사이',
        stat: { value: n(gap), unit: '회 차' },
        duel, targets: [targetOf(r), targetOf(ahead)],
      });
    }
  });

  if (rows.length >= 2) {
    const [a, b] = rows;
    const lead = Number(a.plays) - Number(b.plays);
    // how long the lead has to last: what's left of the window, or a week for an open-ended one
    const bounded = daysLeft != null && daysLeft <= 62;
    const days = bounded ? daysLeft : 7;
    const until = bounded ? `남은 ${span(daysLeft)}` : '앞으로 7일';
    // everyone close enough to matter, each a separate threat
    const hold = live && pace
      ? rows.slice(1, 5).reduce((p, r) => p * holdChance(Number(a.plays) - Number(r.plays), p3(a), p3(r), days), 1)
      : null;
    const sealed = hold != null && bounded && hold >= 0.98;
    const fading = live && pace && trend(p3(a), p7(a)) === 'down';
    const drift = live && pace ? (p3(b) - p3(a) > 0.05 ? 'closing' : p3(b) - p3(a) < -0.05 ? 'opening' : 'steady') : null;
    out.push({
      kind: 'lead', group: 'lead', weight: sealed ? 72 : hold != null && hold < 0.6 ? 66 : 30,
      title: !live ? '1위' : sealed ? '1위 사실상 확정' : '레이스 리더',
      text: !live
        ? `${who(a)}, ${lead === 0 ? '동률 끝에' : `${n(lead)}회 차로`} 이 기간 1위`
        : sealed
          ? `${who(a)}, ${n(lead)}회 차로 이번 기간 1위 사실상 확정`
          : `${who(a)}, ${lead === 0 ? '공동 선두' : `${n(lead)}회 차 선두`} · ${until} 1위 유지 가능성 ${pct(hold ?? 1)}%${fading ? ' · 선두 페이스 하락 중' : ''}`,
      detail: `2위 ${nameOf(b)}`,
      stat: hold != null ? { value: `${pct(hold)}%`, unit: '1위 유지' } : lead === 0 ? { value: '동률' } : { value: n(lead), unit: '회 차' },
      duel: { sides: [side(a, 1), side(b, 2)], gap: lead, eta: null, lead: true, hold: hold != null ? pct(hold) : null, until, drift },
      targets: [targetOf(a), targetOf(b)],
    });
  }
  return out;
}

/**
 * Milestones in reach (projected on the last three days' pace), and marks
 * passed in the last few days.
 */
export function milestoneEvents(rows, then, pace, marks, { label }) {
  const out = [];
  const before = new Map((then ?? []).map((r) => [keyOf(r), Number(r.plays)]));
  for (const r of rows) {
    const p = Number(r.plays);
    const prev = before.get(keyOf(r));
    const rate = pace?.p3.get(keyOf(r)) ?? 0;
    for (const m of marks) {
      if (prev != null && prev < m && p >= m) {
        out.push({
          kind: 'hit', group: 'milestone', weight: 85 + m / 1000,
          title: `${label(m)} 달성`,
          text: `${who(r)}, 통산 ${n(m)}회 돌파`,
          detail: `지금 ${n(p)}회`,
          stat: { value: n(m), unit: '회' },
          solo: { plays: p, mark: m },
          targets: [targetOf(r)],
        });
      } else if (p < m) {
        const left = m - p;
        if (left <= Math.max(3, rate * 7)) {
          const days = rate > 0 ? left / rate : null;
          out.push({
            kind: 'near', group: 'milestone', weight: 45 + m / 1000 - left / 10,
            title: `${label(m)} 임박`,
            text: `${who(r)}, ${n(m)}회까지 ${n(left)}회${days != null ? ` · ${within(days)}` : ''}`,
            detail: `지금 ${n(p)}회 · 최근 3일 하루 ${f1(rate)}회`,
            stat: { value: n(left), unit: '회 남음' },
            solo: { plays: p, p3: rate, p7: pace?.p7.get(keyOf(r)) ?? 0, eta: days, mark: m },
            targets: [targetOf(r)],
          });
        }
        break; // only the next mark up counts
      }
    }
  }
  return out;
}

/** The ones that matter most, one per subject and kind. */
export function pick(events, max = 10) {
  const seen = new Set();
  const out = [];
  for (const e of [...events].sort((a, b) => b.weight - a.weight)) {
    const k = `${e.kind}|${e.targets?.[0] ? keyOf(e.targets[0]) : e.title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length === max) break;
  }
  return out;
}
