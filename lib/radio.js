/**
 * Race radio: what's happening in whatever ranking is on screen, worked out
 * from the numbers alone — fights, overtakes, gaps closing, who is on course
 * to pass whom and when, whose pace is fading, milestones in reach. The AI
 * only rewords a message's line; every figure comes from here.
 *
 * Rows are ranked the list's way (plays, then whoever got there later) and
 * carry `plays`, `last_at`, `artist_key`, `track_key`.
 *
 * Paces are plays per day — `p3`, `p7` and `p30` over the last three, seven
 * and thirty days — and a car's own average across the window. No single
 * one of them decides a projection: see paceModel.
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
export const span = (days) => (days < 2 ? `${Math.max(1, Math.round(days * 24))}시간`
  : days < 60 ? `${Math.round(days)}일`
  : days < 730 ? `${Math.round(days / 30)}개월`
  : `${Math.round(days / 365)}년`);
const within = (days) => (days < 1 / 24 ? '곧' : `약 ${span(days)} 뒤`);

const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
/** Plays in a stretch at an average of `l`: Poisson, or its normal shape once it's large. */
function poisson(l) {
  if (l <= 0) return 0;
  if (l > 30) return Math.max(0, Math.round(l + Math.sqrt(l) * gauss()));
  const floor = Math.exp(-l);
  let k = 0;
  for (let p = Math.random(); p > floor; p *= Math.random()) k++;
  return k;
}

/** How fast a projection relaxes from the recent pace to the long one, in days. */
const TAU = 14;

/**
 * Each car's pace as a projection should see it — no one reading trusted on
 * its own. `short` is where it is now: the last three days, the week and the
 * month together, the week counting most. `long` is what it drifts back to:
 * the month and the car's own average across the window (since it first
 * played in it). Something only just discovered is expected to cool rather
 * than keep its debut pace.
 */
export function paceModel(pace, { from = 0, now = Date.now() } = {}) {
  const get = (m, r) => pace?.[m]?.get(keyOf(r));
  return (r) => {
    const p3 = get('p3', r) ?? 0;
    const p7 = get('p7', r) ?? 0;
    const p30 = get('p30', r) ?? p7;
    const since = Math.max(from, Date.parse(r.first_at) || from);
    const age = Math.max(3, (now - since) / DAY);
    const avg = Number(r.plays) / age;
    const short = 0.25 * p3 + 0.4 * p7 + 0.35 * p30;
    let long = 0.55 * p30 + 0.45 * avg;
    if (age < 21) long = Math.min(long, short) * 0.85;
    return { short, long, p3, p7, p30, avg, age };
  };
}

/** Plays expected in the next `days`: the short pace easing into the long one. */
export const expectIn = (m, days) => m.long * days + (m.short - m.long) * TAU * (1 - Math.exp(-days / TAU));

/** Projected plays per day over the next week — the one number a card shows. */
export const projPace = (m) => expectIn(m, 7) / 7;

// checkpoints for a catch: tenths of a day at first, then halves, then five-day steps
const GRID = [
  ...Array.from({ length: 20 }, (_, i) => (i + 1) / 10),
  ...Array.from({ length: 116 }, (_, i) => 2.5 + i / 2),
  ...Array.from({ length: 207 }, (_, i) => 65 + i * 5),
];

/** When `chaser`, `gap` plays behind, first draws level with `leader` — or null within `max` days. */
export function catchUp(leader, chaser, gap, max) {
  for (const t of GRID) {
    if (t > max) return null;
    if (expectIn(chaser, t) - expectIn(leader, t) >= gap + 0.5) return t;
  }
  return null;
}

/**
 * Who is first after `days` more: each car plays on at its modelled pace,
 * Poisson around it, with the pace itself wobbling run to run — more the
 * further out it looks — and the runs are counted.
 */
export function finishOdds(rows, modelOf, days, runs = 3000) {
  const field = rows.slice(0, 8);
  const mean = field.map((r) => expectIn(modelOf(r), days));
  const sigma = 0.22 + 0.08 * Math.log1p(days / 7);
  const won = field.map(() => 0);
  for (let s = 0; s < runs; s++) {
    const fin = field.map((r, i) => Number(r.plays) + poisson(mean[i] * Math.exp(sigma * gauss() - (sigma * sigma) / 2)));
    const best = Math.max(...fin);
    const top = fin.flatMap((f, i) => (f === best ? [i] : []));
    for (const i of top) won[i] += 1 / top.length;
  }
  return field.map((r, i) => ({ r, pos: i + 1, p: won[i] / runs }));
}

/** A stretch of time the way a lead is talked about: days, then weeks, months, years. */
export const weeks = (days) => (days < 14 ? `${Math.max(1, Math.round(days))}일`
  : days < 182 ? `${Math.round(days / 7)}주`
  : days < 730 ? `${Math.round(days / 30)}개월`
  : `${Math.round(days / 365)}년`);
export const pct = (p) => (p >= 1 ? 100 : p <= 0 ? 0 : p >= 0.995 ? 99 : p <= 0.005 ? 1 : Math.round(p * 100));

/** Speeding up, fading, or steady: the last three days against the week and the month together, with the week leaning the same way. */
function trend(m) {
  const base = 0.5 * m.p7 + 0.5 * m.p30;
  if (base < 0.5 && m.p3 < 0.5) return null;
  if (m.p3 < base * 0.6 && m.p7 <= base) return 'down';
  if (m.p3 > base * 1.6 && m.p3 >= 1.5 && m.p7 >= base) return 'up';
  return null;
}

/**
 * Messages for one ranking.
 * @param now   ranked rows now
 * @param then  the same window as it stood a while ago (or null)
 * @param pace  { p3, p7, p30 } maps of plays per day by key (or null)
 * @param opts  { top, live, endsAt (ms), open, from (ms) } — `open` is a
 *   ranking with no end (all-time), where nothing is ever settled
 */
export function rankingEvents(now, then, pace, { top = 10, live = true, endsAt = null, open = false, from = 0 } = {}) {
  const out = [];
  const rows = now.slice(0, top);
  const thenRank = new Map((then ?? []).map((r, i) => [keyOf(r), i + 1]));
  const thenPlays = new Map((then ?? []).map((r) => [keyOf(r), Number(r.plays)]));
  const model = paceModel(pace, { from });
  const cache = new Map();
  const M = (r) => cache.get(keyOf(r)) ?? cache.set(keyOf(r), model(r)).get(keyOf(r));
  const projecting = live && pace;
  const daysLeft = endsAt && !open ? Math.max(0, (endsAt - Date.now()) / DAY) : null;
  const mix = (m) => `3일 ${f1(m.p3)} · 7일 ${f1(m.p7)} · 30일 ${f1(m.p30)}`;
  // one car's figures, for the card to lay out
  const side = (r, pos) => ({
    pos, plays: Number(r.plays),
    ...(projecting ? { p3: projPace(M(r)), p7: M(r).p7, trend: trend(M(r)) } : {}),
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
        detail: passed.length ? `${passed.slice(0, 2).join(', ')} 추월${projecting ? ` · ${mix(M(r))}` : ''}` : null,
        stat: { value: `P${pos}` },
        solo: { ...side(r, pos), from: before },
        targets: [targetOf(r)],
      });
    }

    // fading or surging, for the front of the field
    if (projecting && pos <= 5) {
      const t = trend(M(r));
      if (t) {
        out.push({
          kind: t === 'down' ? 'fade' : 'surge', group: 'forecast', weight: 40 - pos,
          title: t === 'down' ? `P${pos} 페이스 하락` : `P${pos} 페이스 상승`,
          text: `${nameOf(r)}, 최근 3일 하루 ${f1(M(r).p3)}회로 ${t === 'down' ? '느려지는 중' : '빨라지는 중'}`,
          detail: `7일 ${f1(M(r).p7)} · 30일 ${f1(M(r).p30)}회/일 대비`,
          stat: { value: f1(M(r).p3), unit: '회/일' },
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
    // on course to pass, on the whole pace model
    let eta = null;
    let after = null; // on course, but not before the window closes
    if (projecting && gap > 0) {
      const t = catchUp(M(ahead), M(r), gap, open ? 1095 : 90);
      if (t != null && (daysLeft == null || t < daysLeft) && t <= (open ? 1095 : 45)) eta = t;
      else if (t != null) after = t;
    }
    const gain = projecting ? expectIn(M(r), 7) - expectIn(M(ahead), 7) : 0;
    const duel = {
      sides: [side(r, pos), side(ahead, pos - 1)], gap, was, eta, after,
      drift: projecting ? (gain > 0.3 ? 'closing' : gain < -0.3 ? 'opening' : 'steady') : null,
    };
    const fading = projecting && trend(M(ahead)) === 'down';

    if (gap <= Math.max(2, Math.round(Number(ahead.plays) * 0.02))) {
      out.push({
        kind: 'battle', group: 'battle', weight: (pos <= 4 ? 80 - pos : 40 - pos) + (eta != null && eta < 2 ? 5 : 0),
        title: `P${pos - 1} 경쟁`,
        text: eta != null
          ? `${nameOf(r)}, ${within(eta)} ${nameOf(ahead)} 추월 가시권`
          : `${nameOf(ahead)} vs ${nameOf(r)}, ${gap === 0 ? '동률' : `${n(gap)}회 차`} 접전${after != null ? ' · 이 흐름이면 기간 안 추월은 어려움' : ''}`,
        detail: projecting ? `예상 페이스 하루 ${f1(projPace(M(ahead)))}회 vs ${f1(projPace(M(r)))}회` : null,
        stat: gap === 0 ? { value: '동률' } : { value: n(gap), unit: '회 차' },
        duel, targets: [targetOf(r), targetOf(ahead)],
      });
    } else if (eta != null) {
      out.push({
        kind: 'eta', group: 'forecast', weight: 50 - pos + (eta < 3 ? 15 : 0),
        title: `P${pos} → P${pos - 1} 예상`,
        text: `${nameOf(r)}, ${within(eta)} ${nameOf(ahead)} 추월 예상${fading ? ` · ${nameOf(ahead)} 페이스 하락 중` : ''}`,
        detail: `예상 페이스 하루 ${f1(projPace(M(r)))}회 vs ${f1(projPace(M(ahead)))}회 · 3일·7일·30일·기간 평균 종합`,
        stat: { value: span(eta) },
        duel, targets: [targetOf(r), targetOf(ahead)],
      });
    } else if (was != null && was - gap >= Math.max(4, was * 0.4) && gap > 0) {
      out.push({
        kind: 'closing', group: 'battle', weight: 55 - pos,
        title: `P${pos - 1}–P${pos} 격차 축소`,
        text: `${nameOf(r)}, ${nameOf(ahead)} 상대 격차 ${n(was)}회 → ${n(gap)}회`,
        detail: open ? '최근 30일 사이' : '최근 3일 사이',
        stat: { value: n(gap), unit: '회 차' },
        duel, targets: [targetOf(r), targetOf(ahead)],
      });
    }
  });

  if (open && projecting && rows.length >= 2) {
    const [a, b] = rows;
    const lead = Number(a.plays) - Number(b.plays);
    // when each car behind would draw level; the soonest is the threat
    const threats = rows.slice(1, 6)
      .map((r, i) => ({ r, pos: i + 2, days: catchUp(M(a), M(r), Number(a.plays) - Number(r.plays), 730) }))
      .filter((x) => x.days != null)
      .sort((x, y) => x.days - y.days);
    const t = threats[0] ?? null;
    // the same question asked a month and a quarter out, with chance in it
    const in4 = finishOdds(rows, M, 28);
    const in12 = finishOdds(rows, M, 84);
    out.push({
      kind: 'hold', group: 'lead', weight: t && t.days < 90 ? 74 : 58,
      title: '통산 1위 수성',
      text: t
        ? `${who(a)}, 통산 1위 약 ${weeks(t.days)} 더 유지 예상 · 4주 뒤에도 1위일 확률 ${pct(in4[0].p)}%`
        : `${who(a)}, ${n(lead)}회 차 통산 1위 · 12주 뒤에도 1위일 확률 ${pct(in12[0].p)}%`,
      detail: t
        ? `위협 P${t.pos} ${nameOf(t.r)} · 예상 페이스 ${f1(projPace(M(t.r)))} vs ${f1(projPace(M(a)))}회/일 · 12주 뒤 ${pct(in12[0].p)}%`
        : `2년 안에는 따라올 ${a.track ? '곡' : '가수'} 없음 · 예상 페이스 ${f1(projPace(M(a)))} vs 2위 ${f1(projPace(M(b)))}회/일`,
      stat: t ? { value: weeks(t.days), unit: '유지 예상' } : { value: `${pct(in12[0].p)}%`, unit: '12주 뒤 1위' },
      duel: {
        sides: [side(a, 1), side(t?.r ?? b, t?.pos ?? 2)],
        gap: Number(a.plays) - Number((t?.r ?? b).plays), eta: null, lead: true,
        holdFor: t ? weeks(t.days) : '안정', drift: t ? 'closing' : 'opening',
      },
      targets: [targetOf(a), targetOf(t?.r ?? b)],
    });
    if (in4[0].p < 0.9) {
      const odds = [...in4].sort((x, y) => y.p - x.p).slice(0, 3);
      out.push({
        kind: 'win-odds', group: 'lead', weight: 72, title: '4주 뒤 통산 1위 예측',
        text: `4주 뒤 통산 1위 · ${nameOf(odds[0].r)} ${pct(odds[0].p)}% · ${nameOf(odds[1].r)} ${pct(odds[1].p)}%`,
        detail: '3일·7일·30일·기간 평균을 종합한 페이스로 3,000번 돌려본 결과',
        stat: { value: `${pct(odds[0].p)}%`, unit: '1위' },
        odds: odds.map(({ r, p }) => ({ ...targetOf(r), pct: pct(p) })),
        targets: odds.map(({ r }) => targetOf(r)),
      });
    }
  } else if (rows.length >= 2) {
    const [a, b] = rows;
    const lead = Number(a.plays) - Number(b.plays);
    // how long the lead has to last: what's left of the window, or a week when there's no end
    const bounded = daysLeft != null;
    const days = bounded ? daysLeft : 7;
    const until = bounded ? `남은 ${weeks(daysLeft)}` : '앞으로 7일';
    const odds = projecting ? finishOdds(rows, M, days) : null;
    const hold = odds ? odds[0].p : null;
    const sealed = hold != null && bounded && hold >= 0.98;
    const fading = projecting && trend(M(a)) === 'down';
    const gain = projecting ? expectIn(M(b), 7) - expectIn(M(a), 7) : 0;
    const drift = projecting ? (gain > 0.3 ? 'closing' : gain < -0.3 ? 'opening' : 'steady') : null;
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
    // who finishes first when the window closes, and how it would end on the expected pace
    if (odds && bounded && !sealed) {
      const best = [...odds].sort((x, y) => y.p - x.p).slice(0, 3);
      const proj = rows.slice(0, 8)
        .map((r) => ({ r, end: Number(r.plays) + expectIn(M(r), days) }))
        .sort((x, y) => y.end - x.end).slice(0, 3);
      out.push({
        kind: 'win-odds', group: 'lead', weight: best[0].r === a ? 64 : 76, title: '기간 종료 1위 예측',
        text: best[0].r === a
          ? `${nameOf(a)}, ${until} 지나도 1위일 확률 ${pct(best[0].p)}% · 대항마 ${nameOf(best[1].r)} ${pct(best[1].p)}%`
          : `역전 예고 · ${nameOf(best[0].r)}, 기간 종료 1위 확률 ${pct(best[0].p)}%로 현재 선두 ${nameOf(a)} 앞섬`,
        detail: `예상 최종 ${proj.map((x, i) => `P${i + 1} ${nameOf(x.r)} ≈${n(x.end)}회`).join(' · ')}`,
        stat: { value: `${pct(best[0].p)}%`, unit: '1위' },
        odds: best.map(({ r, p }) => ({ ...targetOf(r), pct: pct(p) })),
        targets: best.map(({ r }) => targetOf(r)),
      });
    }
  }
  return out;
}

/**
 * Milestones in reach (projected on the last three days' pace), and marks
 * passed in the last few days.
 */
export function milestoneEvents(rows, then, pace, marks, { label }) {
  const out = [];
  const model = paceModel(pace);
  const before = new Map((then ?? []).map((r) => [keyOf(r), Number(r.plays)]));
  for (const r of rows) {
    const p = Number(r.plays);
    const prev = before.get(keyOf(r));
    const pm = model(r);
    const rate = projPace(pm);
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
          const days = rate > 0 ? catchUp({ short: 0, long: 0 }, pm, left - 0.5, 1095) : null;
          out.push({
            kind: 'near', group: 'milestone', weight: 45 + m / 1000 - left / 10,
            title: `${label(m)} 임박`,
            text: `${who(r)}, ${n(m)}회까지 ${n(left)}회${days != null ? ` · ${within(days)}` : ''}`,
            detail: `지금 ${n(p)}회 · 예상 페이스 하루 ${rate < 0.1 ? '0.1회 미만' : `${f1(rate)}회`}`,
            stat: { value: n(left), unit: '회 남음' },
            solo: { plays: p, p3: rate, p7: pm.p7, eta: days, mark: m },
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
