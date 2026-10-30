import { useRef, useState } from 'react';
import { COMPARE_AXES, won } from './score';
import Radar from './Radar';
import { Bar, CAT, Pic, STATUS, V, mah, when } from './parts';

/** The comparison: who leads on each axis, by how much, and why — the leader in the accent, the rest in grey. */
export default function CompareView({ phones, all, ids, setIds, onOpen }) {
  const [mode, setMode] = useState('lead'); // lead: emphasis on the leader · color: one colour per phone
  const slots = useRef(new Map()); // the colour follows the phone, whatever else is added or removed
  const slotOf = (id) => {
    if (!slots.current.has(id)) slots.current.set(id, slots.current.size % CAT.length);
    return slots.current.get(id);
  };
  const sel = ids.map((id) => phones.find((p) => p.id === id)).filter(Boolean);
  const free = all.filter((p) => !ids.includes(p.id));
  const color = (p) => CAT[slotOf(p.id)];

  const rows = COMPARE_AXES.map(([k, label]) => {
    const entries = sel.map((p) => ({ p, v: p.fit.axes[k] })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
    const gap = entries.length > 1 && entries[0].v > entries[1].v ? entries[0].v - entries[1].v : 0;
    return { k, label, entries, gap, leader: gap > 0 ? entries[0].p : null };
  });
  const lead = (p) => rows.filter((r) => r.leader?.id === p.id).sort((a, b) => b.gap - a.gap);

  const best = (key) => { const m = Math.max(...sel.map((p) => p.fit.axes[key] ?? -1)); return (p) => sel.length > 1 && m >= 0 && p.fit.axes[key] === m; };
  const row = (label, f, hl) => (
    <tr key={label}><th scope="row">{label}</th>{sel.map((p) => <td key={p.id} className={hl?.(p) ? 'best' : ''}>{hl?.(p) ? <i aria-hidden="true">✓</i> : null}{f(p)}</td>)}</tr>
  );

  return (
    <div className="np-compare">
      <section className="np-card">
        <div className="np-cmp-bar">
          <ul className={`np-cmp-chips${mode === 'lead' ? ' lead' : ''}`}>
            {sel.map((p) => (
              <li key={p.id} style={{ '--bc': color(p) }}>
                <i aria-hidden="true" />
                <button type="button" onClick={() => onOpen(p)}>{p.brand} {p.name}</button>
                <button type="button" className="x" onClick={() => setIds(ids.filter((x) => x !== p.id))} aria-label={`${p.name} 빼기`}>✕</button>
              </li>
            ))}
          </ul>
          <div className="np-cmp-ctl">
            {sel.length < 5 && free.length > 0 && (
              <select value="" onChange={(e) => e.target.value && setIds([...ids, e.target.value])} aria-label="폰 추가">
                <option value="">+ 폰 추가</option>
                {free.map((p) => <option key={p.id} value={p.id}>{p.brand} {p.name}</option>)}
              </select>
            )}
            <div className="np-seg" role="group" aria-label="표시 방식">
              <button type="button" className={mode === 'lead' ? 'on' : ''} onClick={() => setMode('lead')}>우위만 강조</button>
              <button type="button" className={mode === 'color' ? 'on' : ''} onClick={() => setMode('color')}>폰별 색</button>
            </div>
          </div>
        </div>
        {sel.length < 2 && <p className="np-note">비교할 폰을 2개 이상 담아주세요. 추천 탭에서 "비교"를 체크하거나 위에서 추가할 수 있어요.</p>}
      </section>

      {sel.length >= 2 && (
        <>
          <section className="np-card">
            <h2>항목별 비교우위 <small>막대는 0~100점, 맨 오른쪽 숫자는 1위와 2위의 차이</small></h2>
            <div className="np-axes">
              {rows.map((r) => (
                <div className="np-axis" key={r.k}>
                  <div className="np-axis-h">
                    <b>{r.label}</b>
                    {r.leader
                      ? <span className="np-gap" style={mode === 'color' ? { '--bc': color(r.leader) } : undefined}><i aria-hidden="true">▲</i>{r.leader.name} +{r.gap}</span>
                      : <span className="np-gap tie">{r.entries.length ? '비슷함' : '정보 없음'}</span>}
                  </div>
                  <ul>
                    {r.entries.map((e, i) => (
                      <li key={e.p.id} style={{ '--bc': mode === 'color' ? color(e.p) : undefined }} className={mode === 'color' ? 'by-color' : ''}>
                        <span className="n">{e.p.name}</span>
                        <Bar value={e.v} lead={mode === 'lead' ? r.leader?.id === e.p.id : mode === 'color'} label={`${e.p.name} ${r.label} ${e.v}점`} />
                        <span className="v">{e.v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {mode === 'color' && (
              <ul className="np-legend" aria-label="범례">
                {sel.map((p) => <li key={p.id} style={{ '--c': color(p) }}><b>{p.brand} {p.name}</b></li>)}
              </ul>
            )}
          </section>

          <section className="np-card">
            <h2>폰별로 어디가 앞서나</h2>
            <div className="np-leadgrid" style={{ '--n': sel.length }}>
              {sel.map((p) => {
                const L = lead(p);
                return (
                  <article key={p.id} style={{ '--bc': color(p) }}>
                    <header><i aria-hidden="true" /><b>{p.brand} {p.name}</b><span>{p.fit.match}%</span></header>
                    {L.length ? (
                      <ul className="up">{L.slice(0, 5).map((r) => <li key={r.k}><i aria-hidden="true">▲</i>{r.label} <em>+{r.gap}</em></li>)}</ul>
                    ) : <p className="np-meta">이 비교군에서 단독 1위인 항목이 없어요.</p>}
                    {p.edges?.strengths?.length > 0 && <ul className="np-why">{p.edges.strengths.slice(0, 2).map((t, i) => <li key={i}>{t}</li>)}</ul>}
                    {p.edges?.weaknesses?.length > 0 && <ul className="np-why down">{p.edges.weaknesses.slice(0, 2).map((t, i) => <li key={i}><i aria-hidden="true">▼</i>{t}</li>)}</ul>}
                  </article>
                );
              })}
            </div>
          </section>

          {sel.length <= 3 && (
            <section className="np-card np-radar-card">
              <h2>모양으로 보기</h2>
              <Radar size={300} series={sel.map((p) => ({ label: p.name, color: color(p), values: p.fit.axes }))} />
              <ul className="np-legend">{sel.map((p) => <li key={p.id} style={{ '--c': color(p) }}><b>{p.brand} {p.name}</b></li>)}</ul>
            </section>
          )}

          <section className="np-card">
            <h2>사양 한눈에</h2>
            <div className="np-scroll">
              <table className="np-table">
                <thead><tr><th />{sel.map((p) => <th key={p.id} scope="col"><button type="button" onClick={() => onOpen(p)}><Pic p={p} size="sm" />{p.name}<small>{p.brand}</small></button></th>)}</tr></thead>
                <tbody>
                  {row('내 취향 일치', (p) => `${p.fit.match}%`, (p) => p.fit.match === Math.max(...sel.map((x) => x.fit.match)))}
                  {row('칩셋', (p) => <>{p.chipset?.name ?? '미정'}{p.chipset?.certainty && p.chipset.certainty !== '확정' ? <i className="np-i">{p.chipset.certainty}</i> : null}</>, best('performance'))}
                  {row('무게', (p) => <V e={p.weight_g} unit="g" />, best('lightness'))}
                  {row('두께', (p) => <V e={p.thickness_mm} unit="mm" />)}
                  {row('화면', (p) => <>{p.display} <V e={p.screen_in} unit="인치" /></>, best('display'))}
                  {row('배터리', (p) => <V e={p.battery_mah} fmt={mah} />, best('battery'))}
                  {row('충전', (p) => <V e={p.charge_w} unit="W" />, best('charging'))}
                  {row('카메라', (p) => p.camera, best('camera'))}
                  {row('업데이트', (p) => <V e={p.update_years} unit="년" />, best('software'))}
                  {row('가격', (p) => <V e={p.price_krw} fmt={won} />, best('value'))}
                  {row('여론 (한국)', (p) => (p.opinion?.kr ? `${p.opinion.kr.sentiment} · ${p.opinion.kr.score}점` : '—'))}
                  {row('여론 (해외)', (p) => (p.opinion?.global ? `${p.opinion.global.sentiment} · ${p.opinion.global.score}점` : '—'))}
                  {row('주요 우려', (p) => ((p.concerns ?? []).filter((c) => c.severity === 'high').map((c) => c.title).join(', ') || '큰 우려 없음'))}
                  {row('출시', (p) => `${STATUS[p.status]} · ${p.release}`)}
                  {row('조사 시각', (p) => when(p.updated_at))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
