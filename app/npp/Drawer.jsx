import { useEffect, useState } from 'react';
import { COMPARE_AXES, deltaOf, fitOf, won } from './score';
import { Bar, FAMILY, KIND, LIKELY, OpinionPanel, Pic, Ring, STATUS, Sev, V, day, imgSrc, mah, sign, when } from './parts';

const TABS = [['overview', '개요'], ['leaks', '유출'], ['opinion', '여론'], ['risks', '우려'], ['scores', '점수·변동'], ['photos', '사진']];
const CERT_ICON = { 확정: '✓', 유력: '◐', 루머: '?' };
const GROUP_ORDER = ['크기·무게', '화면', '성능', '배터리·충전', '카메라', '소프트웨어', '연결·기타', '가격·출시'];

/** The detailed spec sheet, by group; anything not confirmed carries its badge and where it came from. */
function SpecSheet({ rows }) {
  const groups = new Map();
  for (const r of rows) { if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group).push(r); }
  const names = [...groups.keys()].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  return (
    <div className="np-sheet">
      {names.map((g) => (
        <div key={g}>
          <h5>{g}</h5>
          <dl>
            {groups.get(g).map((r, i) => (
              <div key={i}>
                <dt>{r.label}</dt>
                <dd>
                  <span className={r.certainty === '확정' ? '' : 'guess'}>{r.value}</span>
                  {r.certainty !== '확정' && <i className="np-i">{r.certainty}</i>}
                  {r.source && <small>{/^https?:/.test(r.source) ? <a href={r.source} target="_blank" rel="noreferrer noopener">출처</a> : r.source}</small>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/** Fit over the research runs, as one thin line. */
function Spark({ points }) {
  if (points.length < 2) return <p className="np-meta">조사가 두 번 이상 쌓이면 점수의 흐름이 그려져요.</p>;
  const W = 320; const H = 80; const P = 8;
  const lo = Math.min(...points.map((x) => x.fit)) - 4; const hi = Math.max(...points.map((x) => x.fit)) + 4;
  const t0 = points[0].t; const t1 = points.at(-1).t || t0 + 1;
  const x = (t) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const y = (v) => H - P - ((v - lo) / Math.max(1, hi - lo)) * (H - 2 * P);
  return (
    <svg className="np-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="적합도 변화">
      <polyline points={points.map((q) => `${x(q.t)},${y(q.fit)}`).join(' ')} />
      {points.map((q, i) => <circle key={i} cx={x(q.t)} cy={y(q.fit)} r="4"><title>{`${day(q.t)} · ${q.fit}%`}</title></circle>)}
    </svg>
  );
}

export default function Drawer({ p, ranks, history, model, watched, onWatch, picked, onPick, onClose }) {
  const [tab, setTab] = useState('overview');
  const [cur, setCur] = useState(0);
  const [bad, setBad] = useState({});
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const concerns = [...(p.concerns ?? [])].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
  const snaps = history ?? [];
  const points = snaps.map((s) => ({ t: Date.parse(s.at), fit: fitOf(s.data, model).match }));
  const delta = snaps.length >= 2 ? deltaOf(snaps.at(-2).data, snaps.at(-1).data, model) : null;
  const imgs = (p.images ?? []).map((x, i) => ({ ...x, i })).filter((x) => !bad[x.i]);
  const main = imgs[Math.min(cur, Math.max(0, imgs.length - 1))];
  const edges = p.edges;
  const counts = { leaks: p.leaks?.length ?? 0, risks: concerns.length, photos: imgs.length };

  return (
    <div className="np-drawer-wrap" role="dialog" aria-modal="true" aria-label={`${p.brand} ${p.name} 상세`}>
      <button type="button" className="np-scrim" onClick={onClose} aria-label="닫기" />
      <aside className="np-drawer">
        <header className="np-d-head">
          <Pic p={p} size="sm" />
          <div className="np-d-title">
            <span className="np-brand">{p.brand}</span>
            <h2>{p.name}</h2>
            <div className="np-tags">
              <span className={`np-tag ${p.status}`}>{STATUS[p.status]}</span>
              {p.status !== 'released' && p.release_likelihood && <span className="np-tag">{LIKELY[p.release_likelihood]}</span>}
              <span className="np-tag">{p.release}</span>
            </div>
          </div>
          <Ring value={p.fit.match} size={68} />
          <button type="button" className="np-x" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div className="np-d-actions">
          <label className="np-check"><input type="checkbox" checked={picked} onChange={onPick} /> 비교에 담기</label>
          <button type="button" className={`np-star${watched ? ' on' : ''}`} onClick={onWatch}>{watched ? '★ 관심 폰' : '☆ 관심 폰 추가'}</button>
          <span className="np-meta">조사 {when(p.updated_at)}</span>
        </div>

        <nav className="np-d-tabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label}{counts[k] ? <i>{counts[k]}</i> : null}
            </button>
          ))}
        </nav>

        <div className="np-d-body">
          {tab === 'overview' && (
            <>
              <p className="np-lead">{p.summary}</p>

              <section>
                <h4>비교우위 <small>다른 폰과 견줘서</small></h4>
                {edges && (edges.strengths?.length || edges.weaknesses?.length) ? (
                  <div className="np-edges">
                    <ul className="up">{edges.strengths.map((t, i) => <li key={i}><i aria-hidden="true">▲</i>{t}</li>)}</ul>
                    <ul className="down">{edges.weaknesses.map((t, i) => <li key={i}><i aria-hidden="true">▼</i>{t}</li>)}</ul>
                  </div>
                ) : <p className="np-meta">폰들을 서로 비교 채점하면 여기에 "어떤 폰보다 어디가 낫고 못한지"가 나와요.</p>}
              </section>

              <section>
                <h4>항목별 점수 <small>비교 채점 기준 · 1~3위는 파란색</small></h4>
                <ul className="np-score-table">
                  {COMPARE_AXES.map(([k, label]) => {
                    const r = ranks?.[k];
                    const v = p.fit.axes[k];
                    const why = p.cal_notes?.[k] ?? p.score_notes?.[k];
                    return (
                      <li key={k}>
                        <span className="l">{label}</span>
                        <Bar value={v} lead={r && r.rank <= 3 && r.tie <= 2} label={`${label} ${v ?? '정보 없음'}점`} />
                        <span className="v">{v ?? '—'}</span>
                        <span className="r">{r ? `${r.of}개 중 ${r.rank}위` : ''}</span>
                        {why && <small>{why}</small>}
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section>
                <h4>주요 사양</h4>
                <dl className="np-specs">
                  <div><dt>칩셋</dt><dd>{p.chipset?.name ?? '미정'}{p.chipset?.certainty && p.chipset.certainty !== '확정' ? <i className="np-i">{p.chipset.certainty}</i> : null}<small>{p.chipset?.family ? FAMILY[p.chipset.family] : ''}</small></dd></div>
                  <div><dt>무게</dt><dd><V e={p.weight_g} unit="g" stack /></dd></div>
                  <div><dt>두께</dt><dd><V e={p.thickness_mm} unit="mm" stack /></dd></div>
                  <div><dt>화면</dt><dd>{p.display}<small><V e={p.screen_in} unit="인치" /></small></dd></div>
                  <div><dt>배터리</dt><dd><V e={p.battery_mah} fmt={mah} stack /></dd></div>
                  <div><dt>충전</dt><dd><V e={p.charge_w} unit="W" stack /></dd></div>
                  <div><dt>카메라</dt><dd>{p.camera}</dd></div>
                  <div><dt>업데이트</dt><dd><V e={p.update_years} unit="년" stack /></dd></div>
                  <div><dt>가격</dt><dd><V e={p.price_krw} fmt={won} stack /></dd></div>
                </dl>
              </section>

              {p.spec_sheet?.length > 0 && (
                <section>
                  <h4>상세 사양 <small>{p.spec_sheet.length}개 항목 · 확정이 아닌 값은 배지로 표시</small></h4>
                  <SpecSheet rows={p.spec_sheet} />
                </section>
              )}

              {(p.highlights?.length > 0 || p.cautions?.length > 0) && (
                <section className="np-two">
                  <div><h4>장점</h4><ul className="np-list pos">{p.highlights?.map((h, i) => <li key={i}>{h}</li>)}</ul></div>
                  <div><h4>아쉬운 점</h4><ul className="np-list neg">{p.cautions?.map((h, i) => <li key={i}>{h}</li>)}</ul></div>
                </section>
              )}
            </>
          )}

          {tab === 'leaks' && (
            <>
              <section>
                <h4>최근 유출 요약 <small>최신순</small></h4>
                {p.leak_digest?.length ? (
                  <ol className="np-timeline">
                    {p.leak_digest.map((x, i) => (
                      <li key={i}><time>{x.date ? day(x.date) : '—'}</time><div><p>{x.text}</p><small>{x.who}</small></div></li>
                    ))}
                  </ol>
                ) : <p className="np-meta">최근 유출 소식을 찾지 못했어요.</p>}
              </section>
              <section>
                <h4>유출·보도 전체 {counts.leaks}건</h4>
                <ul className="np-leaks">
                  {(p.leaks ?? []).map((l, i) => (
                    <li key={i}>
                      <span className={`np-cert c-${l.certainty}`}><i aria-hidden="true">{CERT_ICON[l.certainty]}</i>{l.certainty}</span>
                      <div>
                        <p>{l.claim}</p>
                        <small>{l.who}{l.date ? ` · ${l.date}` : ''}{/^https?:/.test(l.source) ? <> · <a href={l.source} target="_blank" rel="noreferrer noopener">원문</a></> : ` · ${l.source}`}</small>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
              {!!p.sources?.length && (
                <section>
                  <h4>출처</h4>
                  <ul className="np-src">{p.sources.map((s, i) => <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a> : s.label}</li>)}</ul>
                </section>
              )}
            </>
          )}

          {tab === 'opinion' && <OpinionPanel p={p} all />}

          {tab === 'risks' && (
            <section>
              <h4>우려되는 점 · 마이너스 요소</h4>
              {concerns.length ? (
                <ul className="np-risks">
                  {concerns.map((x, i) => (
                    <li key={i} className={x.severity}>
                      <Sev level={x.severity} />
                      <div><b>{x.title}</b><p>{x.detail}</p><small>{x.source}</small></div>
                    </li>
                  ))}
                </ul>
              ) : <p className="np-meta">조사에서 뚜렷한 우려 요소는 나오지 않았어요.</p>}
              {p.fit.penalties.length > 0 && <p className="np-pen-note">점수에서는 {p.fit.penalties.map((x) => `${x.label} ${x.v}`).join(' · ')}만큼 깎였어요. (정보가 불확실하다는 이유로는 깎지 않아요)</p>}
            </section>
          )}

          {tab === 'scores' && (
            <>
              <section>
                <h4>내 취향 적합도 변화</h4>
                <Spark points={points} />
                {delta ? (
                  <>
                    <p className="np-fit-line">지난 조사 {delta.from}% → <b className={delta.fit > 0 ? 'up' : delta.fit < 0 ? 'down' : ''}>{delta.to}%</b> ({delta.fit === 0 ? '변동 없음' : sign(delta.fit)})</p>
                    {delta.scores.length + delta.specs.length === 0 ? <p className="np-meta">지난 조사와 항목 점수·수치는 같아요.</p> : (
                      <ul className="np-delta-list">
                        {delta.scores.map((s) => <li key={s.label}><span>{s.label}</span><b>{s.from} → {s.to}</b><em className={s.to > s.from ? 'up' : 'down'}>{sign(s.to - s.from)}</em></li>)}
                        {delta.specs.map((s) => <li key={s.label}><span>{s.label}</span><b>{s.from} → {s.to}</b></li>)}
                      </ul>
                    )}
                  </>
                ) : <p className="np-meta">아직 비교할 지난 조사가 없어요. 다음 조사부터 점수와 수치의 변동이 여기에 나와요.</p>}
              </section>
              {!!p.changes?.length && (
                <section><h4>새로 바뀐 정보</h4><ul className="np-list new">{p.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></section>
              )}
              <section>
                <h4>점수·수치의 근거</h4>
                <ul className="np-basis">
                  {[['성능', p.cal_notes?.performance ?? p.score_notes?.performance], ['카메라', p.cal_notes?.camera ?? p.score_notes?.camera], ['배터리', p.cal_notes?.battery ?? p.score_notes?.battery],
                    ['화면', p.cal_notes?.display ?? p.score_notes?.display], ['디자인', p.cal_notes?.design ?? p.score_notes?.design], ['칩셋', p.chipset?.note], ['무게', p.weight_g?.note],
                    ['배터리 용량', p.battery_mah?.note], ['충전', p.charge_w?.note], ['가격', p.price_krw?.note], ['업데이트', p.update_years?.note]]
                    .filter(([, n]) => n).map(([k, n]) => <li key={k}><b>{k}</b>{n}</li>)}
                </ul>
              </section>
            </>
          )}

          {tab === 'photos' && (
            <section>
              {main ? (
                <>
                  <div className="np-photo"><img src={imgSrc(p, main.i)} alt={`${p.brand} ${p.name}`} onError={() => setBad((b) => ({ ...b, [main.i]: true }))} /><span className={`np-kind k-${main.kind}`}>{KIND[main.kind]}</span></div>
                  <p className="np-meta">{main.caption}{main.page ? <> · <a href={main.page} target="_blank" rel="noreferrer noopener">{main.source ?? '출처'}</a></> : main.source ? ` · ${main.source}` : ''}</p>
                  {imgs.length > 1 && (
                    <div className="np-thumbs">
                      {imgs.map((im, k) => (
                        <button type="button" key={im.i} className={k === Math.min(cur, imgs.length - 1) ? 'on' : ''} onClick={() => setCur(k)} aria-label={`${KIND[im.kind]} 보기`}>
                          <img src={imgSrc(p, im.i)} alt="" loading="lazy" onError={() => setBad((b) => ({ ...b, [im.i]: true }))} />
                          <span>{KIND[im.kind]}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : <p className="np-meta">서버에서 열리는 사진을 찾지 못했어요. 출시 전 폰은 유출 렌더링이 공개되면 다음 조사 때 채워져요.</p>}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
