'use client';

import { coverOf } from './useCovers';
import { Cover } from './ui';
import { nameOf, span } from '@/lib/radio';
import { artistColor } from '@/lib/genre';

/** The kinds of message, in the order the feed shows them. */
export const GROUPS = [
  ['all', '전체'], ['lead', '선두'], ['battle', '경쟁'], ['move', '순위 변동'], ['forecast', '예상'],
  ['milestone', '마일스톤'], ['champ', '챔피언십'], ['cx', '컨스트럭터'], ['rookie', '루키'],
];
const isTrack = (t) => Boolean(t?.track);

const num = (v) => Math.round(Number(v)).toLocaleString('ko-KR');
const one = (v) => (Math.round(v * 10) / 10).toLocaleString('ko-KR');
const ARROW = { up: '▲', down: '▼', plunge: '▼▼' };
const DRIFT = { closing: '좁혀지는 중', opening: '벌어지는 중', steady: '그대로' };

/** The line itself. */
const Line = ({ text }) => <span className="rr-text">{text}</span>;

/** One car: picture, name, place, and its projected pace, large, against the week. */
function Side({ s, t, pic, top, align }) {
  const color = artistColor(t.artist);
  return (
    <span className={`rr-side ${align}${s.p3 != null && top > 0 && s.p3 === top ? ' fast' : ''}`}>
      <Cover src={pic} size={48} round={!isTrack(t)} />
      <b className="rr-name">{nameOf(t)}</b>
      <small className="rr-pos">P{s.pos} · {s.pts != null ? `${num(s.pts)}pt` : `${num(s.plays)}회`}</small>
      {s.p3 != null && (
        <>
          <span className="rr-pace" data-trend={s.trend || undefined}>
            <b>{one(s.p3)}</b><small>회/일</small>{s.trend && <i>{ARROW[s.trend]}</i>}
          </span>
          <span className="rr-bar"><i style={{ width: `${top > 0 ? Math.max(4, (s.p3 / top) * 100) : 0}%`, background: color }} /></span>
          <small className="rr-p7">예상 · 7일 평균 {one(s.p7)}</small>
        </>
      )}
    </span>
  );
}

/**
 * One message as a card. A fight puts both cars side by side — the chaser
 * on the left, the car ahead on the right — with when the pass comes, or
 * the gap, large between them. Anything else is one picture and its figures.
 */
export function RadioCard({ it, covers, onOpen }) {
  const pics = (it.targets ?? []).slice(0, 2);
  const pic = (t) => coverOf(covers[isTrack(t) ? 'tracks' : 'artists'], isTrack(t) ? 'tracks' : 'artists', t);
  if (it.odds?.length) {
    return (
      <button className="rr-card rr-odds" onClick={() => onOpen(it)}>
        <span className="rr-tag">{it.title}</span>
        <span className="rr-odds-list">
          {it.odds.map((o, i) => (
            <span className="rr-odd" key={i}>
              <Cover src={pic(o)} size={40} round={!isTrack(o)} />
              <span className="rr-odd-body">
                <b className="rr-name">{nameOf(o)}</b>
                <span className="rr-bar"><i style={{ width: `${Math.max(2, o.pct)}%`, background: artistColor(o.artist) }} /></span>
              </span>
              <span className="rr-odd-pct" data-first={i === 0 || undefined}>
                {o.move != null && (
                  <i className="rr-move" data-up={o.move > 0 || undefined} title={it.since ? `${it.since} 대비` : undefined}>
                    {o.move > 0 ? '▲' : '▼'}{Math.abs(o.move)}
                  </i>
                )}
                {/* a simulation that never saw it win isn't a proof it can't */}
                {o.pct < 1 ? '<1' : o.pct}<small>%</small>
              </span>
            </span>
          ))}
        </span>
        <Line text={it.text} />
        {it.detail && <span className="rr-detail">{it.detail}</span>}
      </button>
    );
  }

  const d = it.duel;
  if (d && pics.length === 2) {
    // the higher place always on the left
    const flip = d.sides[0].pos > d.sides[1].pos;
    const [a, b] = flip ? [d.sides[1], d.sides[0]] : d.sides;
    const [ta, tb] = flip ? [pics[1], pics[0]] : pics;
    const top = Math.max(a.p3 ?? 0, b.p3 ?? 0);
    const unit = d.unit ?? '회';
    return (
      <button className="rr-card rr-duel" onClick={() => onOpen(it)}>
        <span className="rr-tag">{it.title}</span>
        <span className="rr-vs">
          <Side s={a} t={ta} pic={pic(ta)} top={top} align="l" />
          <span className="rr-mid">
            {d.need != null ? (
              <>
                <small>라운드당 필요</small>
                <b>{num(d.need)}{unit}</b>
                <small>예상 {num(d.expect)}{unit} · {num(d.gap)}{unit} 차</small>
              </>
            ) : d.holdFor != null ? (
              <>
                <small>1위 유지</small>
                <b>{d.holdFor}</b>
                <small>{num(d.gap)}{unit} 차</small>
              </>
            ) : d.hold != null ? (
              <>
                <small>1위 유지</small>
                <b>{d.hold}%</b>
                <small>{d.until} · {num(d.gap)}{unit} 차</small>
              </>
            ) : d.eta != null ? (
              <>
                <small>추월까지</small>
                <b>{span(d.eta)}</b>
                <small>{num(d.gap)}{unit} 차</small>
              </>
            ) : (
              <>
                <small>{d.label ?? (d.lead ? '선두 격차' : '격차')}</small>
                <b>{d.gap === 0 ? '동률' : num(d.gap)}</b>
                {d.gap !== 0 && <small>{unit}</small>}
              </>
            )}
            {d.drift && <span className="rr-drift" data-drift={d.drift}>{DRIFT[d.drift]}</span>}
            {d.after != null && <small className="rr-after">이 페이스면 {span(d.after)} 뒤</small>}
          </span>
          <Side s={b} t={tb} pic={pic(tb)} top={top} align="r" />
        </span>
        <Line text={it.text} />
      </button>
    );
  }

  const s = it.solo;
  return (
    <button className="rr-card rr-solo" onClick={() => onOpen(it)} disabled={!pics.length}>
      <span className={`rr-pics n${pics.length}`} aria-hidden="true">
        {pics.map((t, i) => <Cover key={i} src={pic(t)} size={pics.length > 1 ? 52 : 72} round={!isTrack(t)} />)}
      </span>
      <span className="rr-body">
        <span className="rr-tag">{it.title}</span>
        <Line text={it.text} />
        {s?.p3 != null ? (
          <span className="rr-paceline" data-trend={s.trend || undefined}>
            예상 페이스 <b>{one(s.p3)}</b>회/일{s.trend && <i>{ARROW[s.trend]}</i>}
            <span>· 7일 평균 {one(s.p7)}</span>
          </span>
        ) : it.detail && <span className="rr-detail">{it.detail}</span>}
        {s?.mark && (
          <span className="rr-bar wide"><i style={{ width: `${Math.min(100, (s.plays / s.mark) * 100)}%` }} /></span>
        )}
      </span>
      {it.stat && (
        <span className="rr-stat">
          <b>{it.stat.value}</b>
          {it.stat.unit && <small>{it.stat.unit}</small>}
        </span>
      )}
    </button>
  );
}

