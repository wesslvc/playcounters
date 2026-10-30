import { useState } from 'react';
import { TRAITS, leanWord, EMPTY_PREFS } from './score';
import { Spectrum, DuelEditor } from './Spectrum';
import PriorityList from './Priority';

const CHIPS = [
  ['snapdragon', '스냅드래곤'], ['exynos', '엑시노스'], ['apple', 'Apple A/M'], ['tensor', '텐서'], ['dimensity', '디멘시티'],
];

/** The left panel: every way of saying what matters. */
export default function Controls({ prefs, setPrefs, filters, setFilters, brandOptions, presets, onSave, onLoad, onDelete, onShare, shared }) {
  const [name, setName] = useState('');
  const setTr = (k, v) => setPrefs({ ...prefs, tr: { ...prefs.tr, [k]: v } });
  const setDuels = (kind, list) => setPrefs({ ...prefs, duels: { ...prefs.duels, [kind]: list } });
  const f = (patch) => setFilters({ ...filters, ...patch });
  const save = (e) => { e.preventDefault(); if (name.trim()) { onSave(name.trim()); setName(''); } };
  return (
    <div className="ctl">
      <div className="ctl-head">
        <h2>내 취향</h2>
        <button type="button" className="np-link" onClick={() => setPrefs(EMPTY_PREFS)}>처음 상태로</button>
      </div>

      <section className="ctl-sec">
        <h3>저장한 옵션</h3>
        <form className="pre-form" onSubmit={save}>
          <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="이름 (예: 게임용, 카메라 중심)" />
          <button disabled={!name.trim()}>저장</button>
        </form>
        {!!presets.length && (
          <ul className="pre-list">
            {presets.map((p) => (
              <li key={p.name}>
                <button type="button" className="pre-load" onClick={() => onLoad(p)}>{p.name}</button>
                <button type="button" className="np-link" onClick={() => onDelete(p.name)} aria-label={`${p.name} 삭제`}>삭제</button>
              </li>
            ))}
          </ul>
        )}
        <div className="pre-share">
          <button type="button" className="np-link" onClick={onShare}>{shared ? '링크를 복사했어요' : '지금 설정을 링크로 복사'}</button>
          <small>다른 기기에서 열면 같은 설정이 적용돼요</small>
        </div>
        <p className="ctl-sub">지금 설정은 이 브라우저에 자동으로 남아요. 이름을 붙여 저장하면 여러 개를 오갈 수 있어요.</p>
      </section>

      <section className="ctl-sec">
        <h3>우선순위와 중요도 <small>서로 반대되지 않는 항목들</small></h3>
        <PriorityList prefs={prefs} setPrefs={setPrefs} />
      </section>

      <section className="ctl-sec">
        <h3>어느 쪽이 더 끌리나 <small>정말 서로 반대인 것만</small></h3>
        {TRAITS.map((t) => (
          <Spectrum key={t.key} pair={t} value={prefs.tr[t.key]} onChange={(v) => setTr(t.key, v)}
            hint={Math.abs(prefs.tr[t.key]) >= 95 && (t.key === 'os' || t.key === 'form') ? `${prefs.tr[t.key] < 0 ? t.l[0] : t.r[0]}만 보기` : leanWord(prefs.tr[t.key], t)} />
        ))}
      </section>

      <section className="ctl-sec">
        <h3>브랜드 대결 <small>여러 개 겹쳐도 합산돼요</small></h3>
        <DuelEditor duels={prefs.duels.brand} onChange={(l) => setDuels('brand', l)} options={brandOptions} title="브랜드"
          empty="브랜드 선호가 없어요. 아래 버튼으로 삼성 vs 애플처럼 대결을 추가하세요. 한 브랜드만 좋다면 '그 외 전부'와 붙이면 돼요." />
      </section>

      <section className="ctl-sec">
        <h3>칩셋 대결</h3>
        <DuelEditor duels={prefs.duels.chip} onChange={(l) => setDuels('chip', l)} options={CHIPS} title="칩셋"
          empty="스냅드래곤 vs 엑시노스처럼 선호하는 칩을 대결로 정해보세요." />
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
