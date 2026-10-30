import { useEffect, useState } from 'react';
import { ELEMENTS, IMPORTANCE, TRAITS, importanceWord, leanWord, netLeans, EMPTY_PREFS, OTHERS } from './score';
import { Spectrum, Importance, DuelEditor } from './Spectrum';
import Priority from './Priority';

const CHIPS = [
  ['snapdragon', '스냅드래곤'], ['exynos', '엑시노스'], ['apple', 'Apple A/M'], ['tensor', '텐서'], ['dimensity', '디멘시티'],
];

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) ?? '{}'); } catch { return {}; } };

/** A section that folds away and says in one line what it is currently set to. */
function Acc({ id, title, summary, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { const s = read('npp.acc'); if (s[id] != null) setOpen(s[id]); }, [id]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem('npp.acc', JSON.stringify({ ...read('npp.acc'), [id]: next })); } catch { /* private mode */ }
  };
  return (
    <section className={`np-acc${open ? ' open' : ''}`}>
      <button type="button" className="np-acc-h" onClick={toggle} aria-expanded={open}>
        <span><b>{title}</b><small>{summary}</small></span><i aria-hidden="true">▾</i>
      </button>
      {open && <div className="np-acc-b">{children}</div>}
    </section>
  );
}

/** The left panel: every way of saying what matters. */
export default function Controls({ prefs, setPrefs, filters, setFilters, brandOptions, presets, onSave, onLoad, onDelete, onShare, shared }) {
  const [name, setName] = useState('');
  const setTr = (k, v) => setPrefs({ ...prefs, tr: { ...prefs.tr, [k]: v } });
  const setDuels = (kind, list) => setPrefs({ ...prefs, duels: { ...prefs.duels, [kind]: list } });
  const f = (patch) => setFilters({ ...filters, ...patch });
  const save = (e) => { e.preventDefault(); if (name.trim()) { onSave(name.trim()); setName(''); } };

  const label = (opts) => (k) => (k === OTHERS ? '그 외' : opts.find(([o]) => o.toLowerCase() === String(k).toLowerCase())?.[1] ?? k);
  const netText = (duels, opts) => {
    const n = [...netLeans(duels)].filter(([, v]) => Math.abs(v) >= 5).sort((a, b) => b[1] - a[1]);
    return n.length ? n.slice(0, 3).map(([k, v]) => `${label(opts)(k)} ${v > 0 ? '+' : '−'}${Math.round(Math.abs(v))}`).join(' · ') : '선호 없음';
  };
  const byKey = Object.fromEntries(ELEMENTS.map((e) => [e.key, e.label]));
  const orderText = prefs.order.length ? prefs.order.slice(0, 4).map((k, i) => `${i + 1} ${byKey[k]}`).join(' · ') : '정하지 않음 — 모두 같은 비중';
  const traitText = TRAITS.filter((t) => Math.abs(prefs.tr[t.key]) >= 8).map((t) => (prefs.tr[t.key] < 0 ? t.l[0] : t.r[0])).slice(0, 3).join(' · ') || '균형';
  const limits = [filters.maxMan && `${filters.maxMan}만원↓`, filters.maxWeight && `${filters.maxWeight}g↓`, filters.minBattery && `${filters.minBattery}mAh↑`, !filters.upcoming && '출시된 폰만', filters.onlyConfirmed && '확실한 정보만'].filter(Boolean);

  return (
    <div className="ctl">
      <div className="ctl-head">
        <h2>내 취향</h2>
        <button type="button" className="np-link" onClick={() => setPrefs(EMPTY_PREFS)}>처음 상태로</button>
      </div>
      <p className="ctl-sub">슬라이더를 움직이면 오른쪽 순위가 바로 바뀌어요. 접힌 줄에는 지금 설정이 요약돼요.</p>

      <Acc id="priority" title="우선순위" summary={orderText} defaultOpen>
        <Priority prefs={prefs} setPrefs={setPrefs} />
      </Acc>

      <Acc id="importance" title="세부 중요도" summary="항목마다 얼마나 중요한지 (선택)">
        <p className="ctl-sub">우선순위와 따로, 항목 하나하나를 얼마나 중요하게 볼지 미세 조정해요.</p>
        {IMPORTANCE.map((it) => (
          <Importance key={it.key} label={it.label} sub={it.sub} value={prefs.imp[it.key]} word={importanceWord(prefs.imp[it.key])}
            onChange={(v) => setPrefs({ ...prefs, imp: { ...prefs.imp, [it.key]: v } })} />
        ))}
      </Acc>

      <Acc id="traits" title="어느 쪽이 더 끌리나" summary={traitText}>
        <p className="ctl-sub">정말 서로 반대인 것만 한 줄에 놓았어요.</p>
        {TRAITS.map((t) => (
          <Spectrum key={t.key} pair={t} value={prefs.tr[t.key]} onChange={(v) => setTr(t.key, v)}
            hint={Math.abs(prefs.tr[t.key]) >= 95 && (t.key === 'os' || t.key === 'form') ? `${prefs.tr[t.key] < 0 ? t.l[0] : t.r[0]}만 보기` : leanWord(prefs.tr[t.key], t)} />
        ))}
      </Acc>

      <Acc id="brand" title="브랜드 대결" summary={netText(prefs.duels.brand, brandOptions)}>
        <DuelEditor duels={prefs.duels.brand} onChange={(l) => setDuels('brand', l)} options={brandOptions} title="브랜드"
          empty="브랜드 선호가 없어요. 아래 버튼으로 삼성 vs 애플처럼 대결을 추가하세요. 한 브랜드만 좋다면 '그 외 전부'와 붙이면 돼요." />
      </Acc>

      <Acc id="chip" title="칩셋 대결" summary={netText(prefs.duels.chip, CHIPS)}>
        <DuelEditor duels={prefs.duels.chip} onChange={(l) => setDuels('chip', l)} options={CHIPS} title="칩셋"
          empty="스냅드래곤 vs 엑시노스처럼 선호하는 칩을 대결로 정해보세요." />
      </Acc>

      <Acc id="limits" title="한도" summary={limits.length ? limits.join(' · ') : '제한 없음'}>
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
      </Acc>

      <Acc id="presets" title="저장한 옵션" summary={presets.length ? `${presets.length}개 저장됨` : '없음'}>
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
        <p className="ctl-sub">지금 설정은 이 브라우저에 자동으로 남아요.</p>
      </Acc>
    </div>
  );
}
