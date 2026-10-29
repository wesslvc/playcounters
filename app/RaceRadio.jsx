'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCovers, coverOf } from './useCovers';
import { Cover } from './ui';

/** What the viewer can narrow the feed to. */
const GROUPS = [
  ['all', '전체'], ['battle', '경쟁'], ['move', '순위 변동'], ['forecast', '예상'],
  ['milestone', '마일스톤'], ['champ', '챔피언십'],
];
const seenKey = (k) => `radio-seen|${k}`;
const isTrack = (t) => Boolean(t?.track);

/**
 * One message as a card: the picture (or the two, for a fight), what it is,
 * the line, the figures behind it, and the number that matters, large.
 */
function RadioCard({ it, covers, onOpen }) {
  const pics = (it.targets ?? []).slice(0, 2);
  const pic = (t) => coverOf(covers[isTrack(t) ? 'tracks' : 'artists'], isTrack(t) ? 'tracks' : 'artists', t);
  return (
    <button className="rr-card" onClick={() => onOpen(it)} disabled={!pics.length}>
      <span className={`rr-pics n${pics.length}`} aria-hidden="true">
        {pics.map((t, i) => <Cover key={i} src={pic(t)} size={pics.length > 1 ? 44 : 56} round={!isTrack(t)} />)}
      </span>
      <span className="rr-body">
        <span className="rr-tag" data-group={it.group}>{it.title}</span>
        <span className="rr-text">{it.text}</span>
        {it.detail && <span className="rr-detail">{it.detail}</span>}
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
