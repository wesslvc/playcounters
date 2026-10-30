import { SPECTRA, LEANS, affinityWord, leanWord } from './score';
import { Spectrum, Affinity } from './Spectrum';

const CHIPS = [
  ['snapdragon', '스냅드래곤'], ['exynos', '엑시노스'], ['apple', 'Apple A/M'], ['tensor', '텐서'], ['dimensity', '디멘시티'],
];

/** The left panel: every way of saying what matters, all on spectra. */
export default function Controls({ prefs, setPrefs, filters, setFilters, brandOptions, brandCount, onReset }) {
  const setSp = (key, v) => setPrefs({ ...prefs, sp: { ...prefs.sp, [key]: v } });
  const setBrand = (b, v) => setPrefs({ ...prefs, brands: { ...prefs.brands, [b]: v } });
  const setChip = (c, v) => setPrefs({ ...prefs, chips: { ...prefs.chips, [c]: v } });
  const f = (patch) => setFilters({ ...filters, ...patch });
  return (
    <div className="ctl">
      <div className="ctl-head">
        <h2>내 취향</h2>
        <button type="button" className="np-link" onClick={onReset}>전부 균형으로</button>
      </div>
      <p className="ctl-sub">슬라이더를 어느 쪽으로 얼마나 밀지가 곧 어디에 치중할지예요. 가운데가 균형이고, 끝으로 갈수록 그쪽을 강하게 봐요.</p>

      <section className="ctl-sec">
        <h3>무엇에 치중할까</h3>
        {SPECTRA.map((s) => (
          <Spectrum key={s.key} pair={s} value={prefs.sp[s.key]} onChange={(v) => setSp(s.key, v)} hint={leanWord(prefs.sp[s.key], s)} />
        ))}
      </section>

      <section className="ctl-sec">
        <h3>종류</h3>
        {LEANS.map((s) => (
          <Spectrum key={s.key} pair={s} value={prefs.sp[s.key]} onChange={(v) => setSp(s.key, v)}
            hint={Math.abs(prefs.sp[s.key]) >= 95 ? `${prefs.sp[s.key] < 0 ? s.l[0] : s.r[0]}만 보기` : leanWord(prefs.sp[s.key], s)} />
        ))}
      </section>

      <section className="ctl-sec">
        <h3>브랜드 취향 <small>제외 ← 보통 → 최우선</small></h3>
        {brandOptions.map(([b, ko]) => (
          <Affinity key={b} label={ko} count={brandCount(b)} value={prefs.brands[b] ?? 0} onChange={(v) => setBrand(b, v)} word={affinityWord(prefs.brands[b] ?? 0)} />
        ))}
      </section>

      <section className="ctl-sec">
        <h3>칩셋 취향 <small>제외 ← 보통 → 최우선</small></h3>
        {CHIPS.map(([c, ko]) => (
          <Affinity key={c} label={ko} value={prefs.chips[c] ?? 0} onChange={(v) => setChip(c, v)} word={affinityWord(prefs.chips[c] ?? 0)} />
        ))}
      </section>

      <section className="ctl-sec">
        <h3>한도</h3>
        <label className="lim">
          <span>가격 <b>{filters.maxMan ? `${filters.maxMan}만원 이하` : '제한 없음'}</b></span>
          <input type="range" min="60" max="400" step="10" value={filters.maxMan || 400}
            onChange={(e) => f({ maxMan: +e.target.value >= 400 ? 0 : +e.target.value })} />
        </label>
        <label className="lim">
          <span>무게 <b>{filters.maxWeight ? `${filters.maxWeight}g 이하` : '제한 없음'}</b></span>
          <input type="range" min="150" max="300" step="5" value={filters.maxWeight || 300}
            onChange={(e) => f({ maxWeight: +e.target.value >= 300 ? 0 : +e.target.value })} />
        </label>
        <label className="lim">
          <span>배터리 <b>{filters.minBattery ? `${filters.minBattery.toLocaleString()}mAh 이상` : '제한 없음'}</b></span>
          <input type="range" min="3000" max="7500" step="100" value={filters.minBattery || 3000}
            onChange={(e) => f({ minBattery: +e.target.value <= 3000 ? 0 : +e.target.value })} />
        </label>
        <label className="np-check"><input type="checkbox" checked={filters.upcoming} onChange={(e) => f({ upcoming: e.target.checked })} /> 출시 예정·루머 포함</label>
        <label className="np-check"><input type="checkbox" checked={filters.onlyConfirmed} onChange={(e) => f({ onlyConfirmed: e.target.checked })} /> 확실한 정보만</label>
      </section>
    </div>
  );
}
