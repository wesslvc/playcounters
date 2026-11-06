'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCovers } from './useCovers';
import { RadioCard, GROUPS } from './RadioCard';

const DAY = 864e5;
const KST = 9 * 3600e3;
const isTrack = (t) => Boolean(t?.track);

/** The channels: what the season, this month's race, the last week and the records have to say. */
function channels(pin) {
  const kst = new Date(Date.now() + KST);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  const list = [
    { key: 'season', label: '시즌', sub: `${y} 챔피언십`, q: { view: 'season', year: y } },
    { key: 'gp', label: `${m}월 GP`, sub: '이번 달 레이스', q: { view: 'gp', year: y, month: m } },
    { key: 'week', label: '최근 7일', sub: '지난 일주일 차트', q: { view: 'chart', from: new Date(Date.now() - 7 * DAY).toISOString(), to: new Date(Date.now() + DAY).toISOString() } },
    { key: 'records', label: '기록', sub: '통산 마일스톤', q: { view: 'records' } },
  ];
  if (pin) list.push({ key: 'pin', label: `${pin.month}월 GP 다시보기`, sub: `${pin.year}년 ${pin.month}월 레이스`, q: { view: 'gp', year: pin.year, month: pin.month } });
  return list;
}

/**
 * Race radio, gathered on its own tab: pick a channel and read everything
 * it has, grouped by kind — the fights, the passes, the odds, the records.
 * A card opens the song or artist it's about.
 */
export default function Radio({ source, mode, estimate, onSelect, pin }) {
  const chans = useMemo(() => channels(pin), [pin]);
  const [chan, setChan] = useState(pin ? 'pin' : 'season');
  const [group, setGroup] = useState('all');
  const [data, setData] = useState({});
  useEffect(() => { if (pin) setChan('pin'); }, [pin]);

  const ch = chans.find((c) => c.key === chan) ?? chans[0];
  const qs = useMemo(() => {
    const p = new URLSearchParams({ source, mode, label: ch.sub });
    if (estimate) p.set('estimate', '1');
    for (const [k, v] of Object.entries(ch.q)) p.set(k, String(v));
    return p.toString();
  }, [ch, source, mode, estimate]);

  useEffect(() => {
    if (data[qs]) return undefined;
    const ctl = new AbortController();
    fetch(`/api/radio?${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => setData((d) => ({ ...d, [qs]: j.error ? { error: j.error } : j })))
      .catch((e) => { if (e.name !== 'AbortError') setData((d) => ({ ...d, [qs]: { error: e.message } })); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);
  useEffect(() => { setGroup('all'); }, [chan]);

  const got = data[qs];
  const items = useMemo(() => got?.items ?? [], [got]);
  const targets = useMemo(() => items.flatMap((x) => x.targets ?? []), [items]);
  const covers = {
    tracks: useCovers('tracks', useMemo(() => targets.filter(isTrack), [targets])),
    artists: useCovers('artists', useMemo(() => targets.filter((t) => !isTrack(t)), [targets])),
  };
  const present = GROUPS.filter(([g]) => g !== 'all' && items.some((x) => x.group === g));
  const sections = present.filter(([g]) => group === 'all' || g === group);
  const open = (it) => { if (it.targets?.[0]) onSelect(it.targets[0]); };

  return (
    <div className="radio">
      <div className="radio-head">
        <h1>라디오</h1>
        <p className="radio-sub">순위표 뒤에서 벌어지는 추격, 추월, 확률과 기록</p>
      </div>

      <div className="radio-chans" role="tablist" aria-label="채널">
        {chans.map((c) => (
          <button key={c.key} role="tab" aria-selected={c.key === chan} className="radio-chan" onClick={() => setChan(c.key)}>
            <b>{c.label}</b>
            <span>{c.sub}</span>
          </button>
        ))}
      </div>

      {present.length > 1 && (
        <div className="radio-groups">
          {[['all', '전체'], ...present].map(([g, l]) => (
            <button key={g} className="chip" aria-pressed={group === g} onClick={() => setGroup(g)}>
              {l}{g !== 'all' && <small>{items.filter((x) => x.group === g).length}</small>}
            </button>
          ))}
        </div>
      )}

      {!got ? (
        <div className="radio-grid" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="radio-ghost" />)}
        </div>
      ) : got.error ? (
        <p className="err">{got.error}</p>
      ) : !items.length ? (
        <p className="radio-none">지금은 조용해요. 눈에 띄는 경쟁이나 변동이 없어요.</p>
      ) : (
        sections.map(([g, label]) => (
          <section key={g} className="radio-sec">
            <h2>{label}<span>{items.filter((x) => x.group === g).length}</span></h2>
            <div className="radio-grid">
              {items.filter((x) => x.group === g).map((it, i) => (
                <RadioCard key={`${g}-${i}`} it={it} covers={covers} onOpen={open} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
