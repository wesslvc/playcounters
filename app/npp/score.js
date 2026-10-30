/**
 * Fit scoring, shared by the page and the over-time graph. Plain JS so it can be tested on its own.
 *
 * The reader's taste is a set of spectra, not steps. Each SPECTRUM is a pair of
 * poles on a −100…+100 line (negative leans to the left pole): how far the
 * handle sits from the middle is how hard that side is leaned on. Brands and
 * chip families each get an affinity on the same scale, and OS and form factor
 * are leans of their own.
 */

export const AXES = [
  ['performance', '성능'], ['camera', '카메라'], ['battery', '배터리'], ['charging', '충전 속도'],
  ['display', '디스플레이'], ['lightness', '가벼움'], ['software', '업데이트'], ['value', '가성비'],
  ['design', '디자인'], ['opinion', '여론'], ['certainty', '정보 확실성'], ['novelty', '신제품 기대'],
];

export const SPECTRA = [
  { key: 'perf_battery', l: ['성능', '칩셋·게임'], r: ['배터리', '용량·충전'] },
  { key: 'camera_value', l: ['카메라', '사진·영상'], r: ['가성비', '가격 대비'] },
  { key: 'light_display', l: ['가볍고 작게', '무게·두께'], r: ['크고 좋은 화면', '디스플레이'] },
  { key: 'design_software', l: ['디자인', '마감·외관'], r: ['오래 쓰는 소프트웨어', '업데이트 보장'] },
  { key: 'spec_opinion', l: ['스펙 수치', '벤치마크·사양'], r: ['사용자 평판', '커뮤니티·리뷰'] },
  { key: 'novel_proven', l: ['곧 나올 신제품', '유출·기대'], r: ['검증된 확정 모델', '출시·실측'] },
];
export const LEANS = [
  { key: 'os', l: ['안드로이드', ''], r: ['iOS', ''] },
  { key: 'form', l: ['바 타입', ''], r: ['폴더블·플립', ''] },
];
export const EMPTY_PREFS = {
  sp: Object.fromEntries([...SPECTRA, ...LEANS].map((s) => [s.key, 0])),
  brands: {},
  chips: {},
};

/** Words for a position on the −100…+100 line. */
export const affinityWord = (v) => (v <= -95 ? '제외' : v < -30 ? '비선호' : v < 30 ? '보통' : v < 70 ? '선호' : '최우선');
export const leanWord = (v, pair) => {
  const a = Math.abs(v);
  if (a < 8) return '균형';
  const side = v < 0 ? pair.l[0] : pair.r[0];
  return a < 35 ? `${side} 쪽으로 약간` : a < 70 ? `${side} 쪽으로` : `${side}에 크게 치중`;
};

/** The six that draw the radar. */
export const RADAR = [
  ['performance', '성능'], ['camera', '카메라'], ['battery', '배터리'],
  ['display', '화면'], ['lightness', '가벼움'], ['opinion', '여론'],
];

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const val = (e) => (e && typeof e.value === 'number' ? e.value : null);
const NEUTRAL = 50;

/** Every axis on 0–100. A figure nobody has found yet counts as neutral, not as bad. */
export function axesOf(d) {
  const s = d.scores ?? {};
  const w = val(d.weight_g);
  const c = val(d.charge_w);
  const u = val(d.update_years);
  const price = val(d.price_krw);
  const perf = d.chipset?.perf_score ?? s.performance ?? NEUTRAL;
  const avg = (perf + (s.camera ?? NEUTRAL) + (s.battery ?? NEUTRAL) + (s.display ?? NEUTRAL)) / 4;
  const priceScore = price == null ? NEUTRAL : clamp(100 - ((price - 600000) / 2000000) * 100);
  return {
    performance: perf,
    camera: s.camera ?? NEUTRAL,
    battery: s.battery ?? NEUTRAL,
    charging: c == null ? NEUTRAL : clamp(((c - 15) / 85) * 100),
    display: s.display ?? NEUTRAL,
    lightness: w == null ? NEUTRAL : clamp(((260 - w) / 100) * 100),
    software: u == null ? NEUTRAL : clamp((u / 7) * 100),
    value: Math.round(avg * 0.4 + priceScore * 0.6),
    design: s.design ?? NEUTRAL,
    opinion: d.opinion?.score ?? NEUTRAL,
    certainty: { high: 100, medium: 65, low: 35 }[d.confidence] ?? 50,
    novelty: { upcoming: 100, rumored: 80, released: 35 }[d.status] ?? 50,
  };
}

/** Spectra → weights. A pole's weight runs from 0 (handle all the way the other way) to 4 (all the way here); the middle gives both 2. */
export function weightsFrom(sp) {
  const L = (v) => 2 * (1 - v / 100) + 0.4;
  const R = (v) => 2 * (1 + v / 100) + 0.4;
  const specBoost = 1 + 0.5 * Math.max(0, -sp.spec_opinion / 100);
  const w = {
    performance: L(sp.perf_battery) * specBoost, battery: R(sp.perf_battery) * specBoost,
    camera: L(sp.camera_value) * specBoost, value: R(sp.camera_value),
    lightness: L(sp.light_display), display: R(sp.light_display) * specBoost,
    design: L(sp.design_software), software: R(sp.design_software),
    opinion: R(sp.spec_opinion),
    novelty: L(sp.novel_proven) * 0.6, certainty: R(sp.novel_proven) * 0.6,
  };
  w.charging = w.battery * 0.4;
  return w;
}

const brandKey = (b) => String(b ?? '').toLowerCase();

/** The reader's taste as something that scores a phone. */
export function buildModel(prefs) {
  const weights = weightsFrom(prefs.sp);
  const brands = Object.fromEntries(Object.entries(prefs.brands).map(([k, v]) => [brandKey(k), v]));
  return { weights, prefs, brands };
}

/** Hard exclusions: a brand or chip at "제외", or OS / form pushed all the way to one side. */
export function excluded(d, model) {
  const { prefs, brands } = model;
  if ((brands[brandKey(d.brand)] ?? 0) <= -95) return true;
  if ((prefs.chips[d.chipset?.family] ?? 0) <= -95) return true;
  if (prefs.sp.os >= 95 && d.os !== 'ios') return true;
  if (prefs.sp.os <= -95 && d.os === 'ios') return true;
  const folds = d.form === 'foldable' || d.form === 'flip';
  if (prefs.sp.form >= 95 && !folds) return true;
  if (prefs.sp.form <= -95 && folds) return true;
  return false;
}

/** Points added or taken for leanings that aren't about specs: OS, form, brand, chip family. */
function bonusOf(d, model) {
  const { prefs, brands } = model;
  const parts = [];
  const add = (label, v) => { if (Math.abs(v) >= 1) parts.push({ label, v }); };
  add(prefs.sp.os >= 0 ? 'iOS 선호' : '안드로이드 선호', (d.os === 'ios' ? 1 : -1) * 14 * (prefs.sp.os / 100));
  const folds = d.form === 'foldable' || d.form === 'flip';
  add(prefs.sp.form >= 0 ? '폴더블 선호' : '바 타입 선호', (folds ? 1 : -1) * 14 * (prefs.sp.form / 100));
  const b = brands[brandKey(d.brand)] ?? 0;
  add(`${d.brand} ${b >= 0 ? '선호' : '비선호'}`, 16 * (b / 100));
  const c = prefs.chips[d.chipset?.family] ?? 0;
  add(`${d.chipset?.family ?? ''} 칩 ${c >= 0 ? '선호' : '비선호'}`, 10 * (c / 100));
  return { total: parts.reduce((x, y) => x + y.v, 0), parts };
}

/** The fit, 0–100, with what carried it. */
export function fitOf(d, model) {
  const a = axesOf(d);
  const { weights } = model;
  const total = Object.values(weights).reduce((x, y) => x + y, 0) || 1;
  const parts = AXES.map(([k, label]) => ({ k, label, v: (a[k] * (weights[k] ?? 0)) / total, w: weights[k] ?? 0 }));
  const bonus = bonusOf(d, model);
  const base = parts.reduce((x, y) => x + y.v, 0);
  // strongest where the reader cares most and the phone is good
  const why = parts.filter((x) => x.w > 0.8 && a[x.k] >= 70).sort((x, y) => y.v - x.v).slice(0, 3).map((x) => x.label);
  const pulls = bonus.parts.filter((x) => x.v >= 3).map((x) => x.label);
  return { match: Math.round(clamp(base + bonus.total)), why, pulls, axes: a, bonus: bonus.parts };
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
