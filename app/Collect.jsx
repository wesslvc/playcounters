'use client';

import { useEffect, useMemo, useState } from 'react';

const GUESS = /티어\s*3|tier\s*3|\bt3\b/i;

const ago = (iso) => {
  if (!iso) return null;
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60e3));
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`;
};

async function call(method, body, qs = '') {
  const res = await fetch(`/api/collect${qs}`, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || j.error) { const e = new Error(j.error || `HTTP ${res.status}`); e.reauth = j.reauth; throw e; }
  return j;
}

/**
 * The gathering playlist: every song you put into any of your playlists also
 * goes into the one picked here, checked with every sync. Turning it on first
 * shows what the other playlists already hold that it lacks, to bring over
 * now or leave.
 */
export default function Collect({ lists }) {
  const mine = useMemo(() => (lists ?? []).filter((p) => p.mine), [lists]);
  const [st, setSt] = useState(undefined);
  const [target, setTarget] = useState('');
  const [peek, setPeek] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    call('GET').then((j) => setSt(j.settings)).catch(() => setSt(null));
  }, []);
  useEffect(() => {
    if (target || !mine.length || st === undefined) return;
    setTarget(st?.target && mine.some((p) => p.id === st.target) ? st.target : mine.find((p) => GUESS.test(p.name))?.id ?? '');
  }, [mine, st, target]);

  const run = async (what, fn) => {
    setBusy(what);
    setError(null);
    setMsg(null);
    try { await fn(); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const look = () => run('peek', async () => setPeek(await call('GET', null, `?preview=${encodeURIComponent(target)}`)));
  const turnOn = (backfill) => run(backfill ? 'fill' : 'on', async () => {
    const j = await call('POST', { action: 'enable', target, backfill });
    setPeek(null);
    setMsg(backfill ? `${j.added.toLocaleString()}곡을 넣고 켰어요.` : '켰어요. 앞으로 넣는 곡부터 모아요.');
    setSt((await call('GET')).settings);
  });
  const now = () => run('run', async () => {
    const j = await call('POST', { action: 'run' });
    setMsg(j.added ? `${j.added}곡을 새로 넣었어요.` : '새로 넣을 곡이 없어요.');
    setSt((await call('GET')).settings);
  });
  const off = () => run('off', async () => {
    await call('POST', { action: 'disable' });
    setSt((await call('GET')).settings);
  });

  if (st === undefined || !mine.length) return null;
  const name = (id) => mine.find((p) => p.id === id)?.name ?? '';

  return (
    <div className="col">
      <div className="col-head">
        <b>자동 모으기</b>
        <small>내 플리 어디에 넣든, 그 곡을 고른 플리에도 자동으로 넣어요</small>
      </div>

      {st?.enabled ? (
        <>
          <p className="col-on"><b>{st.targetName ?? name(st.target)}</b>에 모으는 중</p>
          <p className="col-sub">
            20분마다 확인 · 지금까지 {(st.total ?? 0).toLocaleString()}곡 넣음{st.checkedAt ? ` · 마지막 확인 ${ago(st.checkedAt)}` : ''}
          </p>
          {st.recent?.length > 0 && (
            <ul className="col-recent">
              {st.recent.slice(0, 5).map((r, i) => (
                <li key={`${r.track}|${r.artist}|${i}`}><b>{r.track}</b><span>{r.artist}{r.from ? ` · ${r.from}에서` : ''}</span></li>
              ))}
            </ul>
          )}
          <div className="col-actions">
            <button className="btn" onClick={now} disabled={Boolean(busy)}>{busy === 'run' ? '확인하는 중…' : '지금 확인'}</button>
            <button className="btn ghost" onClick={off} disabled={Boolean(busy)}>끄기</button>
          </div>
        </>
      ) : (
        <>
          {st?.problem && <p className="col-sub err">{st.problem}</p>}
          <label className="col-pick">
            <span>모을 플리</span>
            <select value={target} onChange={(e) => { setTarget(e.target.value); setPeek(null); }}>
              <option value="">고르세요</option>
              {mine.map((p) => <option key={p.id} value={p.id}>{p.name}{p.count != null ? ` (${p.count}곡)` : ''}</option>)}
            </select>
          </label>
          {!peek ? (
            <div className="col-actions">
              <button className="btn" onClick={look} disabled={!target || Boolean(busy)}>{busy === 'peek' ? '다른 플리 살펴보는 중…' : '넣을 곡 확인하기'}</button>
            </div>
          ) : (
            <>
              <p className="col-sub">
                다른 플리 {peek.sources}개에 있는데 <b>{name(target)}</b>에 없는 곡이 <b>{peek.count.toLocaleString()}곡</b> 있어요
              </p>
              {peek.sample?.length > 0 && (
                <ul className="col-recent">
                  {peek.sample.map((r, i) => <li key={`${r.track}|${i}`}><b>{r.track}</b><span>{r.artist} · {r.from}</span></li>)}
                </ul>
              )}
              <div className="col-actions">
                {peek.count > 0 && (
                  <button className="btn" onClick={() => turnOn(true)} disabled={Boolean(busy)}>
                    {busy === 'fill' ? '넣는 중…' : `${peek.count.toLocaleString()}곡 넣고 켜기`}
                  </button>
                )}
                <button className={peek.count > 0 ? 'btn ghost' : 'btn'} onClick={() => turnOn(false)} disabled={Boolean(busy)}>
                  {busy === 'on' ? '켜는 중…' : peek.count > 0 ? '지금 곡은 두고 켜기' : '켜기'}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {msg && <p className="col-msg">{msg}</p>}
      {error && (error.reauth
        ? <p className="col-msg err">{error.message} <a href="/api/auth/login">Spotify 다시 연결</a></p>
        : <p className="col-msg err">{error.message}</p>)}
    </div>
  );
}
