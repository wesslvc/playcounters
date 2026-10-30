import { Bar, FAMILY, LIKELY, Move, Pic, Ring, STATUS, Sev, V, mah, when } from './parts';
import { won } from './score';

const BARS = [['performance', '성능'], ['camera', '카메라'], ['battery', '배터리'], ['display', '화면'], ['design', '디자인'], ['opinion', '여론']];

/** The headline of a phone: who, how well it fits, where it leads, and the few numbers that matter. */
export default function Tile({ p, rank, move, ranks, chips, watched, onWatch, picked, onPick, onOpen }) {
  const f = p.fit;
  const my = ranks ?? {};
  const concerns = p.concerns ?? [];
  const worst = ['high', 'medium', 'low'].find((s) => concerns.some((c) => c.severity === s));
  const mood = (m) => (m ? <span className={`np-dot-mood ${m.sentiment === '긍정' ? 'pos' : m.sentiment === '부정' ? 'neg' : m.sentiment === '혼재' ? 'mix' : 'none'}`} /> : null);
  return (
    <li className="np-tile" data-first={rank === 1 ? '' : undefined}>
      <div className="np-tile-rank"><b>{rank}</b><Move d={move} /></div>
      <button type="button" className="np-tile-pic" onClick={onOpen} aria-label={`${p.name} 상세`}><Pic p={p} /></button>

      <div className="np-tile-main">
        <div className="np-tile-title">
          <div>
            <span className="np-brand">{p.brand}</span>
            <h3><button type="button" onClick={onOpen}>{p.name}</button></h3>
          </div>
          <div className="np-tags">
            <span className={`np-tag ${p.status}`}>{STATUS[p.status]}</span>
            {p.status !== 'released' && p.release_likelihood && <span className="np-tag">{LIKELY[p.release_likelihood]}</span>}
            {p.chipset?.family && <span className="np-tag">{FAMILY[p.chipset.family]}</span>}
            {p.confidence !== 'high' && <span className="np-tag sure" title="정보가 덜 확실하다는 표시예요. 점수는 깎지 않아요.">정보 {p.confidence === 'low' ? '불확실' : '일부 불확실'}</span>}
          </div>
        </div>

        {(chips.up.length > 0 || chips.down.length > 0) && (
          <div className="np-edge">
            {chips.up.map((c) => <span key={c.k} className="np-edge-chip up" title={`${c.of}개 중 ${c.rank}위 (${c.v}점)`}>{c.label} {c.rank}위</span>)}
            {chips.down.map((c) => <span key={c.k} className="np-edge-chip down" title={`${c.of}개 중 ${c.rank}위 (${c.v}점)`}>{c.label} {c.rank}위</span>)}
          </div>
        )}

        <ul className="np-bars">
          {BARS.map(([k, label]) => {
            const r = my[k];
            const v = f.axes[k];
            return (
              <li key={k}>
                <span className="np-bars-l">{label}</span>
                <Bar value={v} lead={r && r.rank <= 3 && r.tie <= 2} label={`${label} ${v ?? '정보 없음'}점`} />
                <span className="np-bars-v">{v ?? '—'}</span>
                <span className="np-bars-r">{r ? `${r.rank}위` : ''}</span>
              </li>
            );
          })}
        </ul>

        <dl className="np-spec-row">
          <div><dt>칩셋</dt><dd>{p.chipset?.name ?? '미정'}</dd></div>
          <div><dt>무게</dt><dd><V e={p.weight_g} unit="g" /></dd></div>
          <div><dt>배터리</dt><dd><V e={p.battery_mah} fmt={mah} /></dd></div>
          <div><dt>가격</dt><dd><V e={p.price_krw} fmt={won} /></dd></div>
        </dl>

        <div className="np-tile-foot">
          <span className="np-foot-item" title="한국 · 해외 커뮤니티 분위기">여론 {mood(p.opinion?.kr)}한 {mood(p.opinion?.global)}해</span>
          <span className="np-foot-item">우려 {concerns.length ? <>{concerns.length}건 <Sev level={worst} /></> : '없음'}</span>
          <span className="np-foot-item">유출 {p.leaks?.length ?? 0}건</span>
          <span className="np-foot-item faint">조사 {when(p.updated_at)}</span>
        </div>
      </div>

      <div className="np-tile-side">
        <Ring value={f.match} />
        {p.delta ? (
          <span className={`np-delta ${p.delta.fit > 0 ? 'up' : p.delta.fit < 0 ? 'down' : 'none'}`}>
            {p.delta.fit === 0 ? '지난 조사와 같음' : `지난 조사 ${p.delta.fit > 0 ? '▲' : '▼'}${Math.abs(p.delta.fit)}`}
          </span>
        ) : <span className="np-delta none">첫 조사</span>}
        {f.penalties.length > 0 && <span className="np-pen" title={f.penalties.map((x) => `${x.label} ${x.v}`).join(' · ')}>우려로 −{Math.abs(f.penalties.reduce((a, x) => a + x.v, 0))}</span>}
        <button type="button" className="np-open" onClick={onOpen}>자세히 보기</button>
        <div className="np-tile-act">
          <label className="np-check"><input type="checkbox" checked={picked} onChange={onPick} /> 비교</label>
          <button type="button" className={`np-star${watched ? ' on' : ''}`} onClick={onWatch} aria-pressed={watched}>{watched ? '★ 관심' : '☆ 관심'}</button>
        </div>
      </div>
    </li>
  );
}
