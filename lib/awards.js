/**
 * The records page's categories, and the Grand Prix records worked out from
 * the championship data — kept apart from the page so the detail sheet can
 * read the same definitions when it lists what a song holds.
 *
 * Every holder has one shape, whichever side computed it:
 *   { artist, track, artist_key, track_key, value, from, to }
 */

export const AWARD_GROUPS = [
  {
    key: 'club', title: '1000 Club', sub: '1000회',
    items: [
      { key: 'artist_fastest_1000', title: '0–1000', note: '가수 첫 재생부터 1000번째 재생까지 걸린 시간', duration: true, low: true, banner: true },
      { key: 'artist_100_1000', title: '100–1000', note: '가수 100번째 재생부터 1000번째 재생까지 걸린 시간', duration: true, low: true },
      { key: 'artist_500_1000', title: '500–1000', note: '가수 500번째 재생부터 1000번째 재생까지 걸린 시간', duration: true, low: true },
      { key: 'club_days', title: '1000회까지 들은 날', note: '1000번째 재생까지 실제로 들은 날 수 · 적을수록 몰아 들음', unit: '일', low: true },
      { key: 'club_top_share', title: '한 곡 집중도', note: '1000회 가운데 가장 많이 들은 한 곡이 차지한 몫', unit: '%' },
      { key: 'club_tracks', title: '1000회를 채운 곡 수', note: '1000번째 재생까지 들은 곡 수', unit: '곡' },
      { key: 'club_since', title: '입성 후 재생', note: '1000 Club에 들어온 뒤 더 들은 횟수', unit: '회' },
    ],
  },
  {
    key: 'dominance', title: 'Dominance', sub: '압도',
    items: [
      { key: 'daily_no1', title: '일간 1위 최다', note: '그날 가장 많이 들은 곡이 된 날', unit: '일' },
      { key: 'weekly_no1', title: '주간 1위 최다', note: '그 주 가장 많이 들은 곡이 된 주', unit: '주' },
      { key: 'weekly_no1_run', title: '최장 연속 주간 1위', note: '쉬지 않고 이어 간 주간 1위', unit: '주' },
      { key: 'month_share', title: '최고 월간 점유율', note: '한 달 재생 중 한 곡이 차지한 몫 · 월 100회 이상', unit: '%', month: true },
    ],
  },
  {
    key: 'velocity', title: 'Velocity', sub: '속도',
    items: [
      { key: 'fastest_100', title: 'Fastest Lap', tag: '0–100', note: '첫 재생부터 100번째 재생까지 걸린 시간', duration: true, low: true },
      { key: 'fastest_50', title: 'Purple Sector', tag: '0–50', note: '첫 재생부터 50번째 재생까지 걸린 시간', duration: true, low: true },
      { key: 'most_in_day', title: 'Max Speed', tag: '/day', note: '한 곡을 하루에 가장 많이 들은 날', unit: '회' },
      { key: 'debut_day', title: '첫날 최다 재생', note: '처음 들은 날 몇 번이나 돌렸는지', unit: '회' },
    ],
  },
  {
    key: 'endurance', title: 'Endurance', sub: '지구력',
    items: [
      { key: 'longest_streak', title: '최장 연속 청취', note: '하루도 빠짐없이 들은 기간', unit: '일' },
      { key: 'most_days', title: '최다 청취일', note: '들은 날을 모두 더해서', unit: '일' },
      { key: 'longevity', title: '최장 롱런', note: '처음 들은 날부터 마지막 날까지 · 20회 이상', unit: '일' },
      { key: 'comeback', title: '최장 공백 후 복귀', note: '가장 오래 잊혔다가 다시 돌아온 곡 · 복귀 후 5회 이상', unit: '일' },
    ],
  },
  {
    key: 'grandprix', title: 'Grand Prix', sub: '그랑프리',
    items: [
      { key: 'gp_wins', title: '최다 우승', note: '월간 그랑프리 1위', unit: '승' },
      { key: 'gp_win_streak', title: '최다 연속 우승', note: '이어서 따낸 그랑프리', unit: '연승', month: true },
      { key: 'gp_podiums', title: '최다 포디움', note: '그랑프리 3위 이내', unit: '회' },
      { key: 'gp_points_streak', title: '최장 연속 포인트', note: '쉬지 않고 이어 간 TOP 10', unit: '라운드', month: true },
      { key: 'gp_margin', title: '최대 우승 격차', note: '2위와의 재생 횟수 차이', unit: '회', month: true },
      { key: 'gp_points', title: '통산 최다 포인트', note: '모든 그랑프리 합산', unit: 'pt' },
    ],
  },
  {
    key: 'artists', title: 'Artists', sub: '가수',
    items: [
      { key: 'cx_wins', title: '컨스트럭터 최다 우승', note: '곡들이 따낸 그랑프리 1위', unit: '승' },
      { key: 'artist_fastest_100', title: '0–100', note: '가수 첫 재생부터 100번째 재생까지 걸린 시간', duration: true, low: true },
      { key: 'artist_fastest_500', title: '0–500', note: '가수 첫 재생부터 500번째 재생까지 걸린 시간', duration: true, low: true },
      { key: 'artist_most_in_day', title: '하루 최다 재생', note: '한 가수를 하루에 가장 많이 들은 날', unit: '회' },
      { key: 'artist_streak', title: '최장 연속 청취', note: '하루도 빠짐없이 들은 가수', unit: '일' },
      { key: 'artist_tracks', title: '가장 넓게 들은 가수', note: '들은 곡 수', unit: '곡' },
    ],
  },
];

export const AWARDS = Object.fromEntries(
  AWARD_GROUPS.flatMap((g) => g.items).map((i, order) => [i.key, { ...i, order }]));

const monthIso = (m) => `${m.year}-${String(m.month).padStart(2, '0')}-01`;
const monthEnd = (m) => new Date(Date.UTC(m.year, m.month, 0)).toISOString().slice(0, 10);
const keyOf = (r) => `${r.artist_key}\u0000${r.track_key ?? ''}`;
const holder = (r, value, from, to) => ({
  artist: r.artist, track: r.track ?? null, artist_key: r.artist_key, track_key: r.track_key ?? null,
  credits: r.credits ?? null, value, from, to,
});

/** The best `n` from a list of holders, one per song, highest first. */
function best(list, n = 3) {
  const seen = new Set();
  const out = [];
  for (const h of [...list].sort((a, b) => b.value - a.value)) {
    const k = keyOf(h);
    if (seen.has(k) || !(h.value > 0)) continue;
    seen.add(k);
    out.push(h);
    if (out.length === n) break;
  }
  return out;
}

/**
 * Grand Prix records from an all-time championship (/api/season?all=1,
 * track mode). Only finished rounds count; rounds are months that held a
 * race, so a month with no listening doesn't break a streak.
 */
export function gpRecords(career) {
  if (!career?.months) return {};
  const rounds = career.months.filter((m) => !m.live && m.top.length);

  const streaks = (hit) => {
    const run = new Map(); // key -> { n, from }
    const out = [];
    for (const m of rounds) {
      const now = new Set();
      for (const t of m.top) {
        if (!hit(t)) continue;
        const k = keyOf(t);
        now.add(k);
        const r = run.get(k) ?? { n: 0, from: m };
        r.n += 1;
        run.set(k, r);
        out.push(holder(t, r.n, monthIso(r.from), monthEnd(m)));
      }
      for (const k of [...run.keys()]) if (!now.has(k)) run.delete(k);
    }
    return best(out);
  };

  const margins = rounds.map((m) => {
    const [a, b] = [...m.top].sort((x, y) => x.rank - y.rank);
    return a ? holder(a, Number(a.plays) - Number(b?.plays ?? 0), monthIso(m), monthEnd(m)) : null;
  }).filter(Boolean);

  const tally = (rows, field) => best((rows ?? []).map((r) => holder(r, r[field], null, null)));
  return {
    gp_wins: tally(career.drivers, 'wins'),
    gp_podiums: tally(career.drivers, 'podiums'),
    gp_points: tally(career.drivers, 'points'),
    gp_win_streak: streaks((t) => t.rank === 1),
    gp_points_streak: streaks(() => true),
    gp_margin: best(margins),
    cx_wins: tally(career.constructors, 'wins'),
  };
}

/**
 * The records one row holds, best place first — for the detail sheet.
 * A song matches on its own key; an artist on artist-only records (and
 * constructor ones) by artist key.
 */
export function awardsFor(target, records) {
  if (!target || !records) return [];
  const out = [];
  for (const [key, list] of Object.entries(records)) {
    const def = AWARDS[key];
    if (!def || !Array.isArray(list)) continue;
    list.forEach((h, i) => {
      const match = target.track
        ? h.track_key && h.track_key === target.track_key && h.artist_key === target.artist_key
        : !h.track_key && h.artist_key === target.artist_key;
      if (match) out.push({ def, place: i + 1, holder: h });
    });
  }
  return out.sort((a, b) => a.place - b.place || a.def.order - b.def.order);
}

/**
 * A record's value as it is read: the number set large, the unit after it.
 * Durations (stored in hours) read like a lap time — "2일 5시간", "14시간",
 * "38분" — with the leading figure as the number.
 */
export function formatValue(def, value) {
  const n = Number(value);
  if (def.duration) {
    if (n < 1) return { v: String(Math.max(1, Math.round(n * 60))), unit: '분' };
    if (n < 24) return { v: String(Math.floor(n)), unit: n % 1 >= 1 / 60 ? `시간 ${Math.round((n % 1) * 60)}분` : '시간' };
    return { v: Math.round(n).toLocaleString(), unit: '시간' };
  }
  const v = def.unit === '%' ? n.toFixed(1) : Math.round(n).toLocaleString();
  return { v, unit: def.unit };
}
