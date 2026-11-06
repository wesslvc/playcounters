'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCovers, coverOf } from './useCovers';
import { Section, Cover, Seg } from './ui';

const SEEDS_KEY = 'pc-rec-seeds';
const LAST_KEY = 'pc-rec-last';
const PREFS_KEY = 'pc-rec-prefs';
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const kept = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const seedKey = (s) => `${s.artist_key}\u0000${s.track_key}`;

/** What can be asked for besides the box. The values go to the server as they are. */
const GENRES = ['K-POP', '팝', '힙합 · 랩', 'R&B · 소울', '발라드', '록', '인디', '일렉트로닉', 'J-POP', 'OST · 클래식', '재즈'];
const LANGS = [['any', '상관없음'], ['ko', '한국어'], ['en', '영어'], ['ja', '일본어']];
const ERAS = [['any', '상관없음'], ['new', '최근 2년'], ['2010s', '2010년대'], ['old', '2000년대 이전']];
const ARTISTS = [['mix', '섞어서'], ['new', '처음 듣는 가수만'], ['same', '담은 가수 위주']];
const FAME = [['any', '상관없음'], ['hidden', '숨은 곡'], ['popular', '유명한 곡']];
const DEFAULT = { genres: [], lang: 'any', era: 'any', artists: 'mix', fame: 'any', mood: '' };

/** One line saying what's been set, for the closed panel. */
function summary(p) {
  const name = (list, v) => list.find(([k]) => k === v)?.[1];
  const bits = [
    p.genres.length ? p.genres.join(', ') : null,
    p.lang !== 'any' ? name(LANGS, p.lang) : null,
    p.era !== 'any' ? name(ERAS, p.era) : null,
    p.artists !== 'mix' ? name(ARTISTS, p.artists) : null,
    p.fame !== 'any' ? name(FAME, p.fame) : null,
    p.mood ? `"${p.mood}"` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : '장르와 분위기는 상자를 따라가요';
}

/**
 * Recommendations, on their own tab: type part of a title or an artist and
 * your own plays come up as you type; put the songs that set the mood in the
 * box, say how many, and — if you like — the genres, language, era, whether
 * the artists should be new to you, how well known the songs should be, and
 * a feeling in your own words. Each suggestion shows which song in the box it
 * follows and what the two share; none is a song you've already played. The
 * box, the settings and the last answer stay on this device.
 */
export default function Recs() {
  const [seeds, setSeeds] = useState([]);
  const [count, setCount] = useState(10);
  const [prefs, setPrefs] = useState(DEFAULT);
  const [panel, setPanel] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const cache = useRef(new Map());
  const input = useRef(null);
  const loaded = useRef(false);

  useEffect(() => {
    setSeeds(kept(SEEDS_KEY, []));
    setRes(kept(LAST_KEY, null));
    setPrefs({ ...DEFAULT, ...kept(PREFS_KEY, {}) });
    setCount(kept('pc-rec-count', 10));
    loaded.current = true;
  }, []);
  useEffect(() => { if (loaded.current) keep(SEEDS_KEY, seeds); }, [seeds]);
  useEffect(() => { if (loaded.current) keep(PREFS_KEY, prefs); }, [prefs]);
  useEffect(() => { if (loaded.current) keep('pc-rec-count', count); }, [count]);

  // as you type: your own plays, a short pause after the last key
  useEffect(() => {
    const term = q.trim();
    if (cache.current.has(term)) { setHits(cache.current.get(term)); return undefined; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/recommend/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((j) => { const items = j.items ?? []; cache.current.set(term, items); setHits(items); })
        .catch(() => {});
    }, term ? 120 : 0);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const inBox = useMemo(() => new Set(seeds.map(seedKey)), [seeds]);
  const covers = useCovers('tracks', useMemo(() => [...seeds, ...(hits ?? [])], [seeds, hits]));
  const add = (h) => {
    if (inBox.has(seedKey(h)) || seeds.length >= 10) return;
    setSeeds([...seeds, { artist: h.artist, track: h.track, artist_key: h.artist_key, track_key: h.track_key }]);
    setQ('');
    input.current?.focus();
  };
  const remove = (s) => setSeeds(seeds.filter((x) => seedKey(x) !== seedKey(s)));
  const set = (k, v) => setPrefs((p) => ({ ...p, [k]: v }));
  const toggleGenre = (g) => set('genres', prefs.genres.includes(g) ? prefs.genres.filter((x) => x !== g) : [...prefs.genres, g].slice(-3));
  const ask = () => {
    setBusy(true);
    fetch('/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seeds, count, prefs }) })
      .then((r) => r.json())
      .then((j) => { setRes(j); if (j.items?.length) keep(LAST_KEY, j); })
      .catch((e) => setRes({ error: e.message }))
      .finally(() => setBusy(false));
  };
  const shown = (hits ?? []).slice(0, 8);
  const changed = JSON.stringify(prefs) !== JSON.stringify(DEFAULT);

  return (
    <div className="recs">
      <div className="radio-head">
        <h1>추천</h1>
        <p className="radio-sub">들었던 곡을 상자에 담으면, 그 결을 따라 안 들어본 곡을 골라 줘요</p>
      </div>

      <div className="rec-box">
        <div className="rec-search">
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setFocus(true); }} placeholder="곡이나 가수 이름 일부" aria-label="들었던 곡 찾기"
                 onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
                 onKeyDown={(e) => {
                   if (e.key === 'Escape') setFocus(false);
                   if (e.key === 'Enter' && shown[0]) { e.preventDefault(); add(shown.find((h) => !inBox.has(seedKey(h))) ?? shown[0]); }
                 }} />
          {focus && shown.length > 0 && (
            <ul className="rec-hits" role="listbox">
              {!q.trim() && <li className="rec-hits-k">최근 많이 들은 곡</li>}
              {shown.map((h) => (
                <li key={seedKey(h)}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(h)} disabled={inBox.has(seedKey(h))}>
                    <Cover src={coverOf(covers, 'tracks', h)} size={36} />
                    <span className="nm"><b>{h.track}</b><span>{h.artist}</span></span>
                    <em>{inBox.has(seedKey(h)) ? '담음' : `${h.plays.toLocaleString()}회`}</em>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {seeds.length > 0 ? (
          <ul className="rec-seeds">
            {seeds.map((s) => (
              <li key={seedKey(s)}>
                <Cover src={coverOf(covers, 'tracks', s)} size={28} />
                <span><b>{s.track}</b><small>{s.artist}</small></span>
                <button type="button" aria-label={`${s.track} 빼기`} onClick={() => remove(s)}>×</button>
              </li>
            ))}
          </ul>
        ) : <p className="rec-empty">상자가 비어 있어요. 위에서 찾아 담아 주세요 (최대 10곡).</p>}

        <button type="button" className="rec-panel-toggle" aria-expanded={panel} onClick={() => setPanel(!panel)}>
          <span><b>세부 설정</b><small>{summary(prefs)}</small></span>
          <i aria-hidden="true">{panel ? '−' : '+'}</i>
        </button>
        {panel && (
          <div className="rec-panel">
            <div className="rec-opt">
              <span className="rec-opt-k">장르 <small>최대 3개 · 안 고르면 상자를 따라가요</small></span>
              <div className="rec-chips">
                {GENRES.map((g) => (
                  <button key={g} type="button" className="chip" aria-pressed={prefs.genres.includes(g)} onClick={() => toggleGenre(g)}>{g}</button>
                ))}
              </div>
            </div>
            <div className="rec-opt">
              <span className="rec-opt-k">언어</span>
              <Seg size="sm" label="언어" options={LANGS} value={prefs.lang} onChange={(v) => set('lang', v)} />
            </div>
            <div className="rec-opt">
              <span className="rec-opt-k">시기</span>
              <Seg size="sm" label="시기" options={ERAS} value={prefs.era} onChange={(v) => set('era', v)} />
            </div>
            <div className="rec-opt">
              <span className="rec-opt-k">가수</span>
              <Seg size="sm" label="가수" options={ARTISTS} value={prefs.artists} onChange={(v) => set('artists', v)} />
            </div>
            <div className="rec-opt">
              <span className="rec-opt-k">인지도</span>
              <Seg size="sm" label="인지도" options={FAME} value={prefs.fame} onChange={(v) => set('fame', v)} />
            </div>
            <div className="rec-opt">
              <span className="rec-opt-k">원하는 느낌 <small>자유롭게, 예: 새벽 드라이브, 비 오는 날</small></span>
              <input className="rec-mood" value={prefs.mood} maxLength={60} onChange={(e) => set('mood', e.target.value)} placeholder="비워 두면 상자를 따라가요" />
            </div>
            {changed && <button type="button" className="rec-reset" onClick={() => setPrefs(DEFAULT)}>설정 초기화</button>}
          </div>
        )}

        <div className="rec-go-row">
          <Seg size="sm" label="곡 수" options={[[5, '5곡'], [10, '10곡'], [20, '20곡']]} value={count} onChange={setCount} />
          <button className="btn" onClick={ask} disabled={!seeds.length || busy}>{busy ? '고르는 중…' : '추천 받기'}</button>
        </div>
      </div>

      {busy && !res?.items?.length ? (
        <ol className="ranks rec-list" aria-busy="true">
          {[0, 1, 2].map((i) => <li key={i} className="rec-ghost"><span /><span /></li>)}
        </ol>
      ) : res?.error && !res.items?.length ? (
        <p className="note rec-note">{res.error}</p>
      ) : res?.items?.length > 0 && (
        <>
          <Section title="추천곡" sub={`${res.items.length}곡 · 누르면 Spotify에서 열려요`} />
          <ol className="ranks rec-list" data-busy={busy || undefined}>
            {res.items.map((x) => (
              <li key={x.id}>
                <a className="row rec" href={x.url} target="_blank" rel="noreferrer">
                  <Cover src={x.image} size={52} />
                  <span className="nm">
                    <b>{x.title}</b>
                    <span>{x.artist}</span>
                    {x.reason && <span className="rec-why">{x.because ? <em>{x.because}처럼 · </em> : null}{x.reason}</span>}
                  </span>
                  <span className="rec-go" aria-hidden="true">↗</span>
                </a>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
