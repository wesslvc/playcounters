import { LIKELY, STATUS } from './parts';

/** Phones with any chance of coming out that haven't been looked into yet. */
export default function CandidatesView({ stubs, onResearch, busy, watched = [], onWatch }) {
  if (!stubs.length) {
    return <section className="np-card np-empty"><h2>후보군</h2><p>아직 조사하지 않은 후보가 없어요. 위 검색창에서 브랜드를 말하면 출시 가능성이 조금이라도 있는 폰이 여기에 모여요.</p></section>;
  }
  const bands = [['high', '출시 가능성 높음'], ['medium', '출시 가능성 보통'], ['low', '소문 단계']];
  return (
    <div className="np-cands">
      <p className="np-banner">후보는 이름만 모아둔 거라 비용이 들지 않아요. ☆ 관심을 누르면 매주 자동 조사에 들어가고, 지금 바로 보고 싶으면 '지금 조사'를 누르세요.</p>
      {bands.map(([k, label]) => {
        const list = stubs.filter((p) => (p.release_likelihood ?? 'low') === k);
        if (!list.length) return null;
        return (
          <section className="np-card" key={k}>
            <h2>{label} <small>{list.length}개</small></h2>
            <ul className="np-cand-grid">
              {list.map((p) => (
                <li key={p.id}>
                  <div>
                    <span className="np-brand">{p.brand}</span>
                    <b>{p.name}</b>
                    <div className="np-tags"><span className={`np-tag ${p.status}`}>{STATUS[p.status] ?? '후보'}</span><span className="np-tag">{p.release}</span></div>
                    <p>{p.summary}</p>
                  </div>
                  <div className="np-cand-act">
                    <button type="button" className={`np-star${watched.includes(p.id) ? ' on' : ''}`} onClick={() => onWatch(p.id)} title="관심 폰은 매주 자동으로 조사돼요">{watched.includes(p.id) ? '★ 관심' : '☆ 관심'}</button>
                    <button type="button" className="np-go sm" disabled={busy} onClick={() => onResearch(p)}>지금 조사</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
