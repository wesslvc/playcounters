'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCovers, coverOf } from './useCovers';
import { Section, Cover, Seg } from './ui';

const DAY = 864e5;
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const target = (r) => ({ artist: r.artist, track: r.track ?? null, artist_key: r.artist_key, track_key: r.track_key ?? null });

/** Five steps of colour, by where a day falls among the days that have plays. */
function levels(values) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.75), q(0.92)];
  return (v) => (v <= 0 ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : v <= cuts[3] ? 4 : 5);
}

/**
 * A year of listening as a grid of days, a week to a column: the darker,
 * the more played. Tap a day for what it was spent on.
 */
export function ListenCalendar({ calendar, source, estimate, onSelect }) {
  const years = useMemo(() => [...new Set((calendar ?? []).map((d) => Number(d.day.slice(0, 4))))].sort((a, b) => b - a), [calendar]);
  const [year, setYear] = useState(null);
  const [day, setDay] = useState(null);
  const [top, setTop] = useState(null);
  useEffect(() => { if (years.length && !years.includes(year)) setYear(years[0]); }, [years, year]);
  useEffect(() => {
    if (!day) return undefined;
    const ctl = new AbortController();
    setTop(null);
    const qs = new URLSearchParams({ d: day, source });
    if (estimate) qs.set('estimate', '1');
    fetch(`/api/day?${qs}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => setTop(j.items ?? [])).catch(() => {});
    return () => ctl.abort();
  }, [day, source, estimate]);
  const covers = useCovers('tracks', top);

  const plays = useMemo(() => new Map((calendar ?? []).map((d) => [d.day, Number(d.plays)])), [calendar]);
  if (!year) return null;
  const start = Date.UTC(year, 0, 1);
  const end = Math.min(Date.UTC(year + 1, 0, 1), Date.now() + 9 * 3600e3);
  // columns start on Monday
  const lead = (new Date(start).getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let t = start; t < end; t += DAY) cells.push(new Date(t).toISOString().slice(0, 10));
  const inYear = cells.filter(Boolean).map((d) => plays.get(d) ?? 0);
  const level = levels(inYear);
  const total = inYear.reduce((a, b) => a + b, 0);
  const active = inYear.filter((v) => v > 0).length;
  const weeks = Math.ceil(cells.length / 7);
  const months = [];
  for (let m = 0; m < 12; m++) {
    const t = Date.UTC(year, m, 1);
    if (t >= end) break;
    months.push({ m: m + 1, col: Math.floor((lead + (t - start) / DAY) / 7) });
  }
  const picked = day ? plays.get(day) ?? 0 : null;

  return (
    <>
      <Section title="청취 달력" sub={`${year}년 ${active}일 · ${total.toLocaleString()}회`}>
        {years.length > 1 && <Seg size="sm" label="연도" options={years.slice(0, 4).map((y) => [y, String(y)])} value={year} onChange={(y) => { setYear(y); setDay(null); }} />}
      </Section>
      <div className="cal-wrap">
        <div className="cal-months" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
          {months.map((x) => <span key={x.m} style={{ gridColumn: x.col + 1 }}>{x.m}월</span>)}
        </div>
        <div className="cal" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
          {cells.map((d, i) => (d ? (
            <button key={d} className="cal-d" data-l={level(plays.get(d) ?? 0)} aria-pressed={day === d}
                    title={`${d} · ${(plays.get(d) ?? 0).toLocaleString()}회`} onClick={() => setDay(d === day ? null : d)} />
          ) : <i key={`p${i}`} />))}
        </div>
        <div className="cal-legend"><span>적게</span>{[0, 1, 2, 3, 4, 5].map((l) => <i key={l} data-l={l} />)}<span>많이</span></div>
      </div>
      {day && (
        <div className="cal-day">
          <p><b>{Number(day.slice(5, 7))}월 {Number(day.slice(8))}일 ({WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]})</b><span>{picked.toLocaleString()}회</span></p>
          {!top ? <div className="skeleton"><i /></div> : !top.length ? <p className="note">이날은 기록이 없어요</p> : (
            <ol>
              {top.slice(0, 3).map((t, i) => (
                <li key={`${t.artist_key}|${t.track_key}`}>
                  <button onClick={() => onSelect(target(t))}>
                    <span className="cal-rk">{i + 1}</span>
                    <Cover src={coverOf(covers, 'tracks', t)} size={40} />
                    <span className="cal-nm"><b>{t.track}</b><small>{t.artist}</small></span>
                    <em>{t.plays.toLocaleString()}회</em>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </>
  );
}

/**
 * When the listening happens: every weekday by hour, the darker the more,
 * and the song each hour belongs to.
 */
export function ListenClock({ source, estimate, onSelect }) {
  const [data, setData] = useState(null);
  const [hour, setHour] = useState(null);
  useEffect(() => {
    const ctl = new AbortController();
    const qs = new URLSearchParams({ source });
    if (estimate) qs.set('estimate', '1');
    fetch(`/api/clock?${qs}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => { if (Array.isArray(j?.grid)) setData({ grid: j.grid, tops: j.tops ?? [] }); }).catch(() => {});
    return () => ctl.abort();
  }, [source, estimate]);
  const tops = data?.tops ?? [];
  const covers = useCovers('tracks', tops);
  if (!data) return null;
  const grid = new Map(data.grid.map(([d, h, n]) => [`${d}|${h}`, Number(n)]));
  const level = levels([...grid.values()]);
  const byHour = Array.from({ length: 24 }, (_, h) => [1, 2, 3, 4, 5, 6, 7].reduce((a, d) => a + (grid.get(`${d}|${h}`) ?? 0), 0));
  const byDay = [1, 2, 3, 4, 5, 6, 7].map((d) => byHour.reduce((a, _, h) => a + (grid.get(`${d}|${h}`) ?? 0), 0));
  const peakH = byHour.indexOf(Math.max(...byHour));
  const peakD = byDay.indexOf(Math.max(...byDay));
  const shown = hour ?? peakH;
  const song = tops.find((t) => t.hour === shown);
  const hourLabel = (h) => `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}시`;

  return (
    <>
      <Section title="언제 듣나" sub={`가장 많이 듣는 때 · ${WEEKDAYS[peakD]}요일, ${hourLabel(peakH)}`} />
      <div className="clock">
        <div className="clock-grid">
          <span />
          {Array.from({ length: 24 }, (_, h) => <span key={h} className="clock-h">{h % 6 === 0 ? h : ''}</span>)}
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <div key={d} className="clock-row">
              <span className="clock-d">{WEEKDAYS[d - 1]}</span>
              {Array.from({ length: 24 }, (_, h) => (
                <button key={h} className="clock-c" data-l={level(grid.get(`${d}|${h}`) ?? 0)} aria-pressed={shown === h}
                        title={`${WEEKDAYS[d - 1]} ${hourLabel(h)} · ${(grid.get(`${d}|${h}`) ?? 0).toLocaleString()}회`}
                        onClick={() => setHour(h)} />
              ))}
            </div>
          ))}
        </div>
        {song && (
          <button className="clock-song" onClick={() => onSelect(target(song))}>
            <Cover src={coverOf(covers, 'tracks', song)} size={48} />
            <span><small>{hourLabel(shown)}의 노래</small><b>{song.track}</b><em>{song.artist} · 이 시간에 {Number(song.plays).toLocaleString()}회</em></span>
          </button>
        )}
      </div>
    </>
  );
}
