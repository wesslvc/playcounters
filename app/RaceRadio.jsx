'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCovers, coverOf } from './useCovers';
import { Cover } from './ui';
import { nameOf, span } from '@/lib/radio';

/** What the viewer can narrow the feed to. */
const GROUPS = [
  ['all', '전체'], ['battle', '경쟁'], ['move', '순위 변동'], ['forecast', '예상'],
  ['milestone', '마일스톤'], ['champ', '챔피언십'],
];
const seenKey = (k) => `radio-seen|${k}`;
const isTrack = (t) => Boolean(t?.track);

const num = (v) => Math.round(Number(v)).toLocaleString('ko-KR');
const one = (v) => (Math.round(v * 10) / 10).toLocaleString('ko-KR');
const ARROW = { up: '▲', down: '▼' };
const DRIFT = { closing: '좁혀지는 중', opening: '벌어지는 중', steady: '그대로' };

/** The line, with the bits worth reading twice marked up. */
const KEY = /(약 \d+(?:시간|일) 뒤|곧|[\d,.]+(?:회|pt)(?: 차)?|P\d+|동률|동점|사실상 확정|조기 확정|챔피언 확정|추월 가시권|추월 예상|페이스 하락 중|느려지는 중|빨라지는 중|돌파)/;
function Line({ text }) {
  return (
    <span className="rr-text">
      {String(text).split(KEY).map((part, i) => (i % 2 ? <em key={i}>{part}</em> : part))}
    </span>
  );
}

/** One car: picture, name, place, and its pace — the last three days, large, against the week. */
function Side({ s, t, pic, top, align }) {
  return (
    <span className={`rr-side ${align}`}>
      <Cover src={pic} size={48} round={!isTrack(t)} />
      <b className="rr-name">{nameOf(t)}</b>
      <small className="rr-pos">P{s.pos} · {s.pts != null ? `${num(s.pts)}pt` : `${num(s.plays)}회`}</small>
      {s.p3 != null && (
        <>
          <span className="rr-pace" data-trend={s.trend || undefined}>
            <b>{one(s.p3)}</b><small>회/일</small>{s.trend && <i>{ARROW[s.trend]}</i>}
          </span>
          <span className="rr-bar"><i style={{ width: `${top > 0 ? Math.max(4, (s.p3 / top) * 100) : 0}%` }} /></span>
          <small className="rr-p7">7일 평균 {one(s.p7)}</small>
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
function RadioCard({ it, covers, onOpen }) {
  const pics = (it.targets ?? []).slice(0, 2);
  const pic = (t) => coverOf(covers[isTrack(t) ? 'tracks' : 'artists'], isTrack(t) ? 'tracks' : 'artists', t);
  const d = it.duel;
  if (d && pics.length === 2) {
    const [a, b] = d.sides;
    const top = Math.max(a.p3 ?? 0, b.p3 ?? 0);
    const unit = d.unit ?? '회';
    return (
      <button className="rr-card rr-duel" data-group={it.group} onClick={() => onOpen(it)}>
        <span className="rr-tag">{it.title}</span>
        <span className="rr-vs">
          <Side s={a} t={pics[0]} pic={pic(pics[0])} top={top} align="l" />
          <span className="rr-mid">
            {d.eta != null ? (
              <>
                <small>추월까지</small>
                <b>{span(d.eta)}</b>
                <small>{num(d.gap)}{unit} 차</small>
              </>
            ) : (
              <>
                <small>{d.lead ? '선두 격차' : '격차'}</small>
                <b>{d.gap === 0 ? '동률' : num(d.gap)}</b>
                {d.gap !== 0 && <small>{unit} 차</small>}
              </>
            )}
            {d.drift && <span className="rr-drift" data-drift={d.drift}>{DRIFT[d.drift]}</span>}
            {d.after != null && <small className="rr-after">이 페이스면 {span(d.after)} 뒤</small>}
          </span>
          <Side s={b} t={pics[1]} pic={pic(pics[1])} top={top} align="r" />
        </span>
        <Line text={it.text} />
      </button>
    );
  }

  const s = it.solo;
  return (
    <button className="rr-card rr-solo" data-group={it.group} onClick={() => onOpen(it)} disabled={!pics.length}>
      <span className={`rr-pics n${pics.length}`} aria-hidden="true">
        {pics.map((t, i) => <Cover key={i} src={pic(t)} size={pics.length > 1 ? 52 : 72} round={!isTrack(t)} />)}
      </span>
      <span className="rr-body">
        <span className="rr-tag">{it.title}</span>
        <Line text={it.text} />
        {s?.p3 != null ? (
          <span className="rr-paceline" data-trend={s.trend || undefined}>
            최근 3일 <b>{one(s.p3)}</b>회/일{s.trend && <i>{ARROW[s.trend]}</i>}
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

/**
 * Race radio: the fights, overtakes, projected passes, fading paces,
 * championship picture and milestones in whatever ranking is on screen.
 * A LIVE button opens them at the foot of the screen, one card at a time to
 * swipe through, narrowed by kind; the first time a view has news in a
 * visit, its top card rises on its own for a few seconds. The numbers come
 * from the server; the wording may be the AI's.
 */
export default function RaceRadio({ ctx, source, estimate, onSelect }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [group, setGroup] = useState('all');
  const [at, setAt] = useState(0);
  const track = useRef(null);
  const timer = useRef(null);
  const ctxKey = ctx ? JSON.stringify({ ...ctx, source, estimate }) : null;

  useEffect(() => {
    if (!ctx) return undefined;
    const ctl = new AbortController();
    // wait for the view to settle before asking
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ view: ctx.view, source, label: ctx.label ?? '' });
      if (estimate) qs.set('estimate', '1');
      for (const k of ['from', 'to', 'mode', 'year']) if (ctx[k] != null) qs.set(k, String(ctx[k]));
      fetch(`/api/radio?${qs}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((j) => {
          if (j.error) throw new Error(j.error);
          setData({ ...j, key: ctxKey, label: ctx.label });
          let seen = false;
          try { seen = sessionStorage.getItem(seenKey(ctxKey)) === '1'; sessionStorage.setItem(seenKey(ctxKey), '1'); } catch { /* private mode */ }
          const lead = j.items?.find((x) => x.kind !== 'lead');
          if (!seen && lead) {
            setToast(lead);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setToast(null), 6000);
          }
        })
        .catch((e) => { if (e.name !== 'AbortError') setData({ items: [], key: ctxKey, label: ctx.label }); });
    }, 700);
    return () => { clearTimeout(t); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { setOpen(false); setToast(null); setGroup('all'); }, [ctxKey]);

  const items = useMemo(() => (data?.key === ctxKey ? data.items ?? [] : []), [data, ctxKey]);
  const shown = useMemo(() => (group === 'all' ? items : items.filter((x) => x.group === group)), [items, group]);
  const groups = GROUPS.filter(([g]) => g === 'all' || items.some((x) => x.group === g));
  const news = items.filter((x) => x.kind !== 'lead').length;

  const targets = useMemo(() => items.flatMap((x) => x.targets ?? []), [items]);
  const covers = {
    tracks: useCovers('tracks', useMemo(() => targets.filter(isTrack), [targets])),
    artists: useCovers('artists', useMemo(() => targets.filter((t) => !isTrack(t)), [targets])),
  };

  useEffect(() => { setAt(0); track.current?.scrollTo({ left: 0 }); }, [group, open]);
  const onScroll = () => {
    const el = track.current;
    if (el) setAt(Math.round(el.scrollLeft / el.clientWidth));
  };
  const goTo = (i) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };
  const openItem = (it) => {
    if (it.targets?.[0]) onSelect(it.targets[0]);
    setOpen(false);
    setToast(null);
  };

  return (
    <>
      {toast && !open && (
        <div className="rr-dock">
          <RadioCard it={toast} covers={covers} onOpen={() => { setToast(null); setOpen(true); }} />
        </div>
      )}

      {open && (
        <>
          <button className="scrim" aria-label="닫기" onClick={() => setOpen(false)} />
          <div className="rr-dock rr-panel" role="dialog" aria-label="레이스 라디오">
            <div className="rr-top">
              <b>Race Radio</b>
              <span>{data?.label}</span>
            </div>
            {groups.length > 2 && (
              <div className="rr-groups">
                {groups.map(([g, l]) => (
                  <button key={g} className="chip" aria-pressed={group === g} onClick={() => setGroup(g)}>{l}</button>
                ))}
              </div>
            )}
            {shown.length ? (
              <>
                <div className="rr-track" ref={track} onScroll={onScroll}>
                  {shown.map((it, i) => (
                    <div className="rr-slide" key={`${group}-${i}`}>
                      <RadioCard it={it} covers={covers} onOpen={openItem} />
                    </div>
                  ))}
                </div>
                <div className="rr-nav">
                  <button className="icon-btn" aria-label="이전" disabled={at <= 0} onClick={() => goTo(at - 1)}>‹</button>
                  <span className="rr-dots">
                    {shown.map((_, i) => <i key={i} data-on={i === at || undefined} />)}
                  </span>
                  <button className="icon-btn" aria-label="다음" disabled={at >= shown.length - 1} onClick={() => goTo(at + 1)}>›</button>
                </div>
              </>
            ) : (
              <p className="rr-none">{data ? '지금은 조용해요. 눈에 띄는 경쟁이나 변동이 없어요.' : '무선 연결 중…'}</p>
            )}
            {items.some((x) => x.ai) && <p className="rr-foot">AI 해설 · 수치는 실제 기록 기준</p>}
          </div>
        </>
      )}

      <button className="rr-fab" aria-expanded={open} onClick={() => { setOpen((v) => !v); setToast(null); }}>
        <i aria-hidden="true" data-on={news > 0 || undefined} />
        LIVE
        {news > 0 && <b>{news}</b>}
      </button>
    </>
  );
}
