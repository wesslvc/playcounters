/** Fit scoring, shared by the page and the over-time graph. Plain JS so it can be tested on its own. */

export const AXES = [
  ['performance', '성능'], ['camera', '카메라'], ['battery', '배터리'], ['charging', '충전 속도'],
  ['display', '디스플레이'], ['lightness', '가벼움'], ['software', '업데이트'], ['value', '가성비'],
  ['design', '디자인'], ['opinion', '여론'], ['certainty', '정보 확실성'],
];
export const DEFAULT_WEIGHTS = {
  performance: 3, camera: 3, battery: 3, charging: 1, display: 2, lightness: 2,
  software: 2, value: 2, design: 1, opinion: 2, certainty: 1,
};
/** The six that draw the radar. */
export const RADAR = [
  ['performance', '성능'], ['camera', '카메라'], ['battery', '배터리'],
  ['display', '화면'], ['lightness', '가벼움'], ['opinion', '여론'],
];

const clamp = (n) => Math.max(0, Math.min(100, n));
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
  };
}

/** The weighted fit, 0–100, and the two axes that carry it most. */
export function fitOf(d, weights) {
  const a = axesOf(d);
  const total = Object.values(weights).reduce((x, y) => x + y, 0) || 1;
  const parts = AXES.map(([k, label]) => ({ k, label, v: (a[k] * (weights[k] ?? 0)) / total }));
  return {
    match: Math.round(parts.reduce((x, y) => x + y.v, 0)),
    why: parts.filter((x) => (weights[x.k] ?? 0) > 0).sort((x, y) => y.v - x.v).slice(0, 2).map((x) => x.label),
    axes: a,
  };
}

/** Does a phone pass the filters? */
export function passes(d, f) {
  const price = val(d.price_krw);
  const weight = val(d.weight_g);
  const battery = val(d.battery_mah);
  if (f.brands.size && !f.brands.has(String(d.brand).toLowerCase())) return false;
  if (f.os !== 'any' && d.os !== f.os) return false;
  if (f.form !== 'any' && d.form !== f.form) return false;
  if (f.chips.size && !f.chips.has(d.chipset?.family)) return false;
  if (!f.upcoming && d.status !== 'released') return false;
  if (f.onlyConfirmed && (d.confidence === 'low' || d.chipset?.certainty === '미정')) return false;
  if (f.maxMan && price != null && price > f.maxMan * 10000) return false;
  if (f.minMan && price != null && price < f.minMan * 10000) return false;
  if (f.maxWeight && weight != null && weight > f.maxWeight) return false;
  if (f.minBattery && battery != null && battery < f.minBattery) return false;
  return true;
}

export const won = (n) => `${Math.round(n / 10000).toLocaleString()}만원`;

/** "약 5,000mAh (유력)" / "미정" — estimates read as estimates. */
export function est(e, fmt, unit = '') {
  if (!e || e.value == null) return { text: '미정', sure: false, note: e?.note ?? '' };
  const f = fmt ?? ((x) => `${Math.round(x * 10) / 10}${unit}`);
  const range = e.low != null && e.high != null && e.low !== e.high ? `${f(e.low)}~${f(e.high)}` : null;
  const sure = e.certainty === '확정';
  return { text: sure ? f(e.value) : `약 ${range ?? f(e.value)}`, sure, certainty: e.certainty, note: e.note ?? '' };
}
