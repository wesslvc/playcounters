/**
 * Fit scoring, shared by the page and the over-time graph. Plain JS so it can be tested on its own.
 *
 * Taste comes in two kinds, because not everything is a trade-off:
 *  - IMPORTANCE: criteria that don't oppose each other (performance, camera,
 *    battery …) each get their own 0–100 "how much does this matter".
 *  - TRAITS and DUELS: things that really are opposites sit on one −100…+100
 *    line (small & light ↔ big screen & battery, 가성비 ↔ 최고 사양,
 *    확정 모델 ↔ 신제품, Android ↔ iOS, bar ↔ foldable) and brands and chip
 *    families are pitted against each other, any number of duels at once.
 *    Duels that name the same brand add up.
 */

export const AXES = [
  ['performance', '성능'], ['camera', '카메라'], ['battery', '배터리'], ['charging', '충전 속도'],
  ['display', '디스플레이'], ['lightness', '가벼움'], ['software', '업데이트'], ['value', '가성비'],
  ['design', '디자인'], ['opinion', '여론'], ['certainty', '정보 확실성'], ['novelty', '신제품 기대'],
];

/** Criteria that don't oppose each other. */
export const IMPORTANCE = [
  { key: 'performance', label: '성능', sub: '칩셋·게임' },
  { key: 'camera', label: '카메라', sub: '사진·영상' },
  { key: 'battery', label: '배터리', sub: '용량·효율' },
  { key: 'charging', label: '충전 속도', sub: '유선·무선' },
  { key: 'display', label: '화면', sub: '밝기·주사율·패널' },
  { key: 'design', label: '디자인', sub: '마감·외관' },
  { key: 'software', label: '업데이트', sub: 'OS 지원 연수' },
  { key: 'opinion', label: '평판', sub: '커뮤니티·리뷰' },
  { key: 'certainty', label: '확정 정보 선호', sub: '켜면 루머·추정이 불리해져요' },
];

/** The brand/chip/OS/form leanings take part in the ordering as one element of their own. */
export const BRAND_ELEMENT = { key: 'brand', label: '브랜드·칩·OS 성향', sub: '아래 대결과 종류 설정', noSlider: true };
export const ELEMENTS = [...IMPORTANCE, BRAND_ELEMENT];

/** Things that really are opposites. */
export const TRAITS = [
  { key: 'size', l: ['작고 가볍게', '무게·두께'], r: ['큰 화면·큰 배터리', '용량 우선'] },
  { key: 'price_flagship', l: ['가성비', '저렴하게'], r: ['최고 사양', '가격 무관'] },
  { key: 'timing', l: ['지금 살 수 있는 확정 모델', '출시·실측'], r: ['곧 나올 신제품', '유출·기대'] },
  { key: 'os', l: ['안드로이드', ''], r: ['iOS', ''] },
  { key: 'form', l: ['바 타입', ''], r: ['폴더블·플립', ''] },
];

export const DEFAULT_IMPORTANCE = {
  performance: 60, camera: 60, battery: 60, charging: 25, display: 45, design: 35, software: 45, opinion: 45, certainty: 0,
};
export const EMPTY_PREFS = {
  imp: { ...DEFAULT_IMPORTANCE },
  order: [], // empty = no element ranked above another
  tr: Object.fromEntries(TRAITS.map((t) => [t.key, 0])),
  duels: { brand: [{ id: 'b0', a: 'Samsung', b: 'Apple', v: 0 }], chip: [] },
};

/** Fill in anything a saved or shared setting lacks. */
export function normalizePrefs(p) {
  const base = EMPTY_PREFS;
  const valid = new Set(ELEMENTS.map((e) => e.key));
  const given = [...new Set((Array.isArray(p?.order) ? p.order : []).filter((k) => valid.has(k)))];
  return {
    imp: { ...base.imp, ...(p?.imp ?? {}) },
    // a ranking is always whole: anything left out follows in the usual order
    order: given.length ? [...given, ...ELEMENTS.map((e) => e.key).filter((k) => !given.includes(k))] : [],
    tr: { ...base.tr, ...(p?.tr ?? {}) },
    duels: {
      brand: Array.isArray(p?.duels?.brand) ? p.duels.brand : base.duels.brand,
      chip: Array.isArray(p?.duels?.chip) ? p.duels.chip : [],
    },
  };
}

export const importanceWord = (v) => (v < 8 ? '상관없음' : v < 35 ? '조금' : v < 65 ? '보통' : v < 88 ? '중요' : '핵심');
export const leanWord = (v, pair) => {
  const a = Math.abs(v);
  if (a < 8) return '균형';
  const side = v < 0 ? pair.l[0] : pair.r[0];
  return a < 35 ? `${side} 쪽으로 약간` : a < 70 ? `${side} 쪽으로` : `${side}에 크게 치중`;
};
export const OTHERS = '*';
export const duelWord = (d, name) => {
  const a = Math.abs(d.v);
  if (a < 8) return '균형';
  const side = d.v < 0 ? name(d.a) : name(d.b);
  return a >= 95 ? `${side}만` : a < 35 ? `${side} 약간 선호` : a < 70 ? `${side} 선호` : `${side} 크게 선호`;
};

/** The six that draw the radar. */
export const RADAR = [
  ['performance', '성능'], ['camera', '카메라'], ['battery', '배터리'],
  ['display', '화면'], ['lightness', '가벼움'], ['opinion', '여론'],
];

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const val = (e) => (e && typeof e.value === 'number' ? e.value : null);
/**
 * Scores are meant to be stingy: 50 is an ordinary phone, 70 a good flagship,
 * 90 the best on the market by a clear margin, and nothing is 100. Dossiers
 * researched under that rubric (score_version 2) are used as given; older ones,
 * which were marked far too generously (nearly everything 75–98), are bent
 * down to the same scale here until they are researched again.
 *
 * Not being sure of a figure is NOT held against a phone: an estimate counts
 * at its best value, and a figure nobody has found at all is left out of the
 * average rather than scored low. How sure the information is shows on the
 * card; it only affects the ranking if the reader turns on "확정 정보 선호".
 */
const strict = (s) => clamp(Math.pow(clamp((s - 50) / 50, 0, 1), 1.4) * 100);
const given = (d, raw) => (raw == null ? null : (d.score_version ?? 1) >= 2 ? clamp(raw) : strict(raw));
const round = (v) => (v == null ? null : Math.round(v));

/** Every axis on 0–100; null where nothing is known. */
export function axesOf(d) {
  const s = d.scores ?? {};
  const w = val(d.weight_g);
  const c = val(d.charge_w);
  const u = val(d.update_years);
  const price = val(d.price_krw);
  const perf = given(d, d.chipset?.perf_score ?? s.performance);
  const cam = given(d, s.camera);
  const bat = given(d, s.battery);
  const disp = given(d, s.display);
  const known = [perf, cam, bat, disp].filter((x) => x != null);
  const avg = known.length ? known.reduce((x, y) => x + y, 0) / known.length : null;
  const priceScore = price == null ? null : clamp(100 - ((price - 500000) / 2000000) * 100);
  const value = avg == null && priceScore == null ? null : avg == null ? priceScore : priceScore == null ? avg : avg * 0.4 + priceScore * 0.6;
  const a = {
    performance: perf,
    camera: cam,
    battery: bat,
    charging: c == null ? null : clamp(((c - 20) / 100) * 100),
    display: disp,
    lightness: w == null ? null : clamp(((240 - w) / 80) * 100),
    software: u == null ? null : clamp(((u - 2) / 6) * 100),
    value,
    design: given(d, s.design),
    opinion: given(d, d.opinion?.score),
  };
  for (const k of Object.keys(a)) a[k] = round(a[k]);
  a.certainty = { high: 100, medium: 60, low: 25 }[d.confidence] ?? 40;
  a.novelty = { upcoming: 100, rumored: 80, released: 30 }[d.status] ?? 40;
  return a;
}

/** Points taken off for real concerns only — never for how sure the information is. */
export function penaltiesOf(d) {
  const sev = (k) => (d.concerns ?? []).filter((x) => x.severity === k).length;
  const parts = [];
  const high = Math.min(12, sev('high') * 4);
  const mid = Math.min(5, sev('medium') * 1.5);
  if (high) parts.push({ label: `큰 우려 ${sev('high')}건`, v: -high });
  if (mid) parts.push({ label: `주의 사항 ${sev('medium')}건`, v: -mid });
  return { total: parts.reduce((x, y) => x + y.v, 0), parts };
}

/**
 * How far up the reader's ordering an element sits, as a multiplier: first
 * place counts ×1.5, last ×0.6, evenly between. With no ordering, ×1.
 */
export function rankMult(prefs, key) {
  const n = prefs.order?.length ?? 0;
  const r = n ? prefs.order.indexOf(key) : -1;
  if (r < 0) return 1;
  return 1.5 - 0.9 * (r / Math.max(1, n - 1));
}

/** Importance and traits → weights. */
export function weightsFrom(prefs) {
  const { imp, tr } = prefs;
  const I = (k) => ((imp[k] ?? 0) / 25) * rankMult(prefs, k); // 0 … 4, then moved by its place in the ordering
  const L = (v) => Math.max(0, -v) / 100;
  const R = (v) => Math.max(0, v) / 100;
  const w = {
    performance: I('performance'), camera: I('camera'), battery: I('battery'), charging: I('charging'),
    display: I('display'), design: I('design'), software: I('software'), opinion: I('opinion'),
    lightness: 0.3 + 3 * L(tr.size),
    value: Math.max(0, 0.5 + 3 * L(tr.price_flagship) - 0.5 * R(tr.price_flagship)),
    certainty: I('certainty') + 3 * L(tr.timing),
    novelty: 3 * R(tr.timing),
  };
  w.display += 1.5 * R(tr.size); w.battery += 1.5 * R(tr.size);
  w.performance += 1.5 * R(tr.price_flagship); w.camera += R(tr.price_flagship); w.display += R(tr.price_flagship);
  return w;
}

const key = (b) => String(b ?? '').toLowerCase();

/**
 * Duels → a net lean per name, −100…+100 (the "*" entry is everyone not named).
 * In a duel a→b with score v (negative favours a, positive favours b) the
 * favoured side gains |v| and the other loses |v|; duels naming the same
 * brand add up, capped at ±100. A duel against "*" spreads its loss over all
 * the others.
 */
export function netLeans(duels) {
  const net = new Map();
  const bump = (name, v) => net.set(key(name), clamp((net.get(key(name)) ?? 0) + v, -100, 100));
  for (const d of duels) {
    if (!d.a || !d.b || !d.v) continue;
    const win = d.v < 0 ? d.a : d.b;
    const lose = d.v < 0 ? d.b : d.a;
    const m = Math.abs(d.v);
    bump(win, m);
    bump(lose, -m);
  }
  return net;
}

/** What the net leans mean for one brand: its own entry, else whatever was set against "everyone else". */
function leanFor(net, name) {
  const own = net.get(key(name));
  if (own != null) return own;
  return net.get(OTHERS) ?? 0;
}

/** Everything the reader said, as something that scores a phone. */
export function buildModel(prefs) {
  return {
    weights: weightsFrom(prefs), prefs,
    brands: netLeans(prefs.duels.brand), chips: netLeans(prefs.duels.chip),
    brandDuels: prefs.duels.brand, chipDuels: prefs.duels.chip,
  };
}

/** A duel at (nearly) full push shuts out the side it was pushed away from. */
function shutOut(duels, name) {
  const n = key(name);
  return duels.some((d) => {
    if (Math.abs(d.v) < 95 || !d.a || !d.b) return false;
    const win = d.v < 0 ? d.a : d.b;
    const lose = d.v < 0 ? d.b : d.a;
    if (key(lose) === n) return true;
    // against "everyone else": whoever isn't the winner is out
    if (lose === OTHERS) return key(win) !== n;
    return false;
  });
}

/** Hard exclusions: a brand or chip beaten all the way, OS or form pushed all the way to one side. */
export function excluded(d, model) {
  const { prefs } = model;
  if (shutOut(model.brandDuels, d.brand)) return true;
  if (d.chipset?.family && shutOut(model.chipDuels, d.chipset.family)) return true;
  if (prefs.tr.os >= 95 && d.os !== 'ios') return true;
  if (prefs.tr.os <= -95 && d.os === 'ios') return true;
  const folds = d.form === 'foldable' || d.form === 'flip';
  if (prefs.tr.form >= 95 && !folds) return true;
  if (prefs.tr.form <= -95 && folds) return true;
  return false;
}

/** Points added or taken for leanings that aren't about specs: OS, form, brand, chip family. */
function bonusOf(d, model) {
  const { prefs } = model;
  const parts = [];
  const add = (label, v) => { if (Math.abs(v) >= 1) parts.push({ label, v }); };
  add(prefs.tr.os >= 0 ? 'iOS 선호' : '안드로이드 선호', (d.os === 'ios' ? 1 : -1) * 14 * (prefs.tr.os / 100));
  const folds = d.form === 'foldable' || d.form === 'flip';
  add(prefs.tr.form >= 0 ? '폴더블 선호' : '바 타입 선호', (folds ? 1 : -1) * 14 * (prefs.tr.form / 100));
  const b = leanFor(model.brands, d.brand);
  add(`${d.brand} ${b >= 0 ? '선호' : '비선호'}`, 16 * (b / 100));
  const c = d.chipset?.family ? leanFor(model.chips, d.chipset.family) : 0;
  add(`${d.chipset?.family ?? ''} 칩 ${c >= 0 ? '선호' : '비선호'}`, 10 * (c / 100));
  const scale = rankMult(prefs, 'brand');
  for (const p of parts) p.v *= scale;
  return { total: parts.reduce((x, y) => x + y.v, 0), parts };
}

/** The fit, 0–100, with what carried it. */
export function fitOf(d, model) {
  const a = axesOf(d);
  const { weights } = model;
  // an axis nobody has data for counts as that phone's own average: it neither helps nor hurts
  const knownAxes = ['performance', 'camera', 'battery', 'display', 'design', 'opinion'].map((k) => a[k]).filter((x) => x != null);
  const own = knownAxes.length ? knownAxes.reduce((x, y) => x + y, 0) / knownAxes.length : 50;
  const at = (k) => a[k] ?? own;
  const total = Object.values(weights).reduce((x, y) => x + y, 0) || 1;
  const parts = AXES.map(([k, label]) => ({ k, label, v: (at(k) * (weights[k] ?? 0)) / total, w: weights[k] ?? 0 }));
  const bonus = bonusOf(d, model);
  const pen = penaltiesOf(d);
  const base = parts.reduce((x, y) => x + y.v, 0);
  const why = parts.filter((x) => x.w > 0.8 && (a[x.k] ?? 0) >= 60).sort((x, y) => y.v - x.v).slice(0, 3).map((x) => x.label);
  const pulls = bonus.parts.filter((x) => x.v >= 3).map((x) => x.label);
  return { match: Math.round(clamp(base + bonus.total + pen.total, 0, 97)), why, pulls, axes: a, bonus: bonus.parts, penalties: pen.parts };
}

/** Plain numeric filters. */
export function passes(d, f, model) {
  if (excluded(d, model)) return false;
  const price = val(d.price_krw);
  const weight = val(d.weight_g);
  const battery = val(d.battery_mah);
  if (!f.upcoming && d.status !== 'released') return false;
  if (f.onlyConfirmed && (d.confidence === 'low' || d.chipset?.certainty === '미정')) return false;
  if (f.maxMan && price != null && price > f.maxMan * 10000) return false;
  if (f.maxWeight && weight != null && weight > f.maxWeight) return false;
  if (f.minBattery && battery != null && battery < f.minBattery) return false;
  return true;
}

export const won = (n) => `${Math.round(n / 10000).toLocaleString()}만원`;

/** "약 5,000mAh" with its range and how sure it is, or "미정" — estimates read as estimates. */
export function est(e, fmt, unit = '') {
  if (!e || e.value == null) return { text: '미정', sure: false, note: e?.note ?? '' };
  const f = fmt ?? ((x) => `${Math.round(x * 10) / 10}${unit}`);
  const range = e.low != null && e.high != null && e.low !== e.high ? `${f(e.low)} ~ ${f(e.high)}` : null;
  const sure = e.certainty === '확정';
  return { text: sure ? f(e.value) : `약 ${f(e.value)}`, range: sure ? null : range, sure, certainty: e.certainty, note: e.note ?? '' };
}

const SCORE_LABELS = { performance: '성능', camera: '카메라', battery: '배터리', display: '화면', design: '디자인' };
const SPEC_LABELS = [['weight_g', '무게', 'g'], ['battery_mah', '배터리', 'mAh'], ['charge_w', '충전', 'W'], ['price_krw', '가격', '원'], ['update_years', '업데이트', '년']];

/** What moved between two research runs of the same phone, under the reader's current taste. */
export function deltaOf(prev, cur, model) {
  const pf = fitOf(prev, model).match;
  const cf = fitOf(cur, model).match;
  const scores = [];
  for (const [k, label] of Object.entries(SCORE_LABELS)) {
    const a = prev.scores?.[k]; const b = cur.scores?.[k];
    if (a != null && b != null && a !== b) scores.push({ label, from: a, to: b });
  }
  const po = prev.opinion?.score; const co = cur.opinion?.score;
  if (po != null && co != null && po !== co) scores.push({ label: '여론', from: po, to: co });
  const specs = [];
  for (const [k, label, unit] of SPEC_LABELS) {
    const a = prev[k]; const b = cur[k];
    if (!a || !b) continue;
    if (a.value !== b.value || a.certainty !== b.certainty) {
      const f = (x) => (x.value == null ? '미정' : unit === '원' ? won(x.value) : `${Math.round(x.value * 10) / 10}${unit}`);
      specs.push({ label, from: `${f(a)}${a.certainty && a.certainty !== '확정' ? ` (${a.certainty})` : ''}`, to: `${f(b)}${b.certainty && b.certainty !== '확정' ? ` (${b.certainty})` : ''}` });
    }
  }
  return { fit: cf - pf, from: pf, to: cf, scores, specs };
}
