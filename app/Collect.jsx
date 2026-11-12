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

/** Which of your playlists feed the gathering one: ticked by hand, the ones that look made by Spotify unticked to begin with. */
function Sources({ survey, picked, setPicked, autoNew, setAutoNew }) {
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <>
      <div className="col-src-head">
        <span>{picked.size}개 플리에서 모아요</span>
        <span>
          <button className="linkish" onClick={() => setPicked(new Set(survey.playlists.filter((p) => !p.reason).map((p) => p.id)))}>직접 만든 것만</button>
          <button className="linkish" onClick={() => setPicked(new Set())}>모두 해제</button>
        </span>
      </div>
      <ul className="col-src">
        {survey.playlists.map((p) => (
          <li key={p.id}>
            <label>
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <span className="col-src-nm"><b>{p.name}</b><small>{p.count != null ? `${p.count}곡` : ''}{p.reason ? ` · ${p.reason}` : ''}</small></span>
            </label>
          </li>
        ))}
      </ul>
      <label className="col-auto">
        <input type="checkbox" checked={autoNew} onChange={(e) => setAutoNew(e.target.checked)} />
        <span>앞으로 새로 만드는 플리도 모으기 <small>(이름이 라디오·믹스 같은 건 빼고)</small></span>
      </label>
    </>
  );
}

/**
 * The gathering playlist: every song you put into the playlists you made
 * yourself also goes into the one picked here, checked with every sync. You
 * tick which playlists count; turning it on first shows what they already
 * hold that it lacks, to bring over now or leave. Everything it added can be
 * taken out again.
 */
export default function Collect({ lists }) {
  const mine = useMemo(() => (lists ?? []).filter((p) => p.mine), [lists]);
  const [st, setSt] = useState(undefined);
  const [view, setView] = useState('main');
  const [target, setTarget] = useState('');
  const [survey, setSurvey] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [autoNew, setAutoNew] = useState(true);
  const [peek, setPeek] = useState(null);
  const [undoCount, setUndoCount] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  const reload = async () => setSt((await call('GET')).settings);
  useEffect(() => { call('GET').then((j) => setSt(j.settings)).catch(() => setSt(null)); }, []);
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
  const openSetup = () => run('survey', async () => {
    setView('setup');
    setPeek(null);
    setSurvey(null);
    const j = await call('GET', null, `?setup=${encodeURIComponent(target)}`);
    setSurvey(j);
    setPicked(new Set(j.playlists.filter((p) => p.on).map((p) => p.id)));
    setAutoNew(j.autoNew);
  });
  const look = () => run('peek', async () => setPeek(await call('POST', { action: 'preview', target, sources: [...picked] })));
  const turnOn = (backfill) => run(backfill ? 'fill' : 'on', async () => {
    const j = await call('POST', { action: 'enable', target, sources: [...picked], autoNew, backfill });
    setView('main');
    setMsg(backfill ? `${j.added.toLocaleString()}곡을 넣고 켰어요.` : '켰어요. 앞으로 넣는 곡부터 모아요.');
    await reload();
  });
  const saveSources = () => run('save', async () => {
    await call('POST', { action: 'sources', sources: [...picked], autoNew });
    setView('main');
    setMsg('모을 플리를 바꿨어요. 앞으로 넣는 곡부터 적용돼요.');
    await reload();
  });
  const now = () => run('run', async () => {
    const j = await call('POST', { action: 'run' });
    setMsg(j.removed != null ? `${j.removed}곡을 뺐어요.` : j.added ? `${j.added}곡을 새로 넣었어요.` : '새로 넣을 곡이 없어요.');
    await reload();
  });
  const askUndo = () => run('count', async () => {
    setView('undo');
    setUndoCount(null);
    setUndoCount((await call('GET', null, '?added=1')).count);
  });
  const undo = () => run('undo', async () => {
    const j = await call('POST', { action: 'undo' });
    setView('main');
    setMsg(j.busy ? '이미 빼는 중이에요. 잠시 뒤 새로고침해 보세요.'
      : j.already ? `이미 빠져 있어요 (${ago(j.already.at)} ${j.already.count.toLocaleString()}곡을 뺐어요).`
        : j.removed ? `${j.removed.toLocaleString()}곡을 뺐어요. 자동 모으기는 꺼 뒀어요.` : '뺄 곡이 없어요.');
    await reload();
  });
  const off = () => run('off', async () => { await call('POST', { action: 'disable' }); await reload(); });

  if (st === undefined || !mine.length) return null;
  const name = (id) => mine.find((p) => p.id === id)?.name ?? '';
  const editing = st?.enabled && st.target === target;

  return (
    <div className="col">
      <div className="col-head">
        <b>자동 모으기</b>
        <small>직접 만든 플리에 넣는 곡을, 고른 플리에도 자동으로 넣어요</small>
      </div>

      {st?.pendingUndo && (
        <div className="col-warn">
          <p><b>{st.targetName ?? name(st.target)}</b>에 자동으로 넣었던 곡을 빼는 중이에요. 다음 동기화(20분 안)에 빠져요.</p>
          <button className="btn" onClick={undo} disabled={Boolean(busy)}>{busy === 'undo' ? '빼는 중…' : '지금 빼기'}</button>
        </div>
      )}

      {view === 'undo' ? (
        <>
          <p className="col-sub">
            {undoCount == null ? '자동으로 넣은 곡을 세는 중…'
              : <><b>{st.targetName ?? name(st.target)}</b>에 자동으로 넣은 곡 <b>{undoCount.toLocaleString()}곡</b>을 뺄까요? 손으로 넣은 곡은 그대로예요. 자동 모으기도 꺼져요.</>}
          </p>
          <div className="col-actions">
            <button className="btn" onClick={undo} disabled={Boolean(busy) || !undoCount}>{busy === 'undo' ? '빼는 중…' : `${(undoCount ?? 0).toLocaleString()}곡 빼기`}</button>
            <button className="btn ghost" onClick={() => setView('main')} disabled={busy === 'undo'}>취소</button>
          </div>
        </>
      ) : view === 'setup' ? (
        <>
          <p className="col-sub"><b>{name(target)}</b>에 모을 플리를 골라 주세요. 라디오·믹스처럼 보이거나 곡이 한 번에 저장된 플리는 처음엔 빼 뒀어요.</p>
          {!survey ? <p className="col-sub">내 플리들을 살펴보는 중…</p> : (
            <Sources survey={survey} picked={picked} setPicked={(f) => { setPicked(f); setPeek(null); }} autoNew={autoNew} setAutoNew={setAutoNew} />
          )}
          {peek && (
            <>
              <p className="col-sub">고른 {peek.sources}개 플리에 있는데 <b>{name(target)}</b>에 없는 곡이 <b>{peek.count.toLocaleString()}곡</b> 있어요</p>
              {peek.sample?.length > 0 && (
                <ul className="col-recent">
                  {peek.sample.map((r, i) => <li key={`${r.track}|${i}`}><b>{r.track}</b><span>{r.artist} · {r.from}</span></li>)}
                </ul>
              )}
            </>
          )}
          <div className="col-actions">
            {editing ? (
              <button className="btn" onClick={saveSources} disabled={!survey || Boolean(busy)}>{busy === 'save' ? '저장하는 중…' : '저장'}</button>
            ) : !peek ? (
              <button className="btn" onClick={look} disabled={!survey || !picked.size || Boolean(busy)}>{busy === 'peek' ? '살펴보는 중…' : '넣을 곡 확인하기'}</button>
            ) : (
              <>
                {peek.count > 0 && (
                  <button className="btn" onClick={() => turnOn(true)} disabled={Boolean(busy)}>{busy === 'fill' ? '넣는 중…' : `${peek.count.toLocaleString()}곡 넣고 켜기`}</button>
                )}
                <button className={peek.count > 0 ? 'btn ghost' : 'btn'} onClick={() => turnOn(false)} disabled={Boolean(busy)}>
                  {busy === 'on' ? '켜는 중…' : peek.count > 0 ? '지금 곡은 두고 켜기' : '켜기'}
                </button>
              </>
            )}
            <button className="btn ghost" onClick={() => setView('main')} disabled={busy === 'fill' || busy === 'on'}>취소</button>
          </div>
        </>
      ) : st?.enabled ? (
        <>
          <p className="col-on"><b>{st.targetName ?? name(st.target)}</b>에 모으는 중{Array.isArray(st.sources) ? ` · 플리 ${st.sources.length}개에서` : ''}</p>
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
            <button className="btn ghost" onClick={() => { setTarget(st.target); openSetup(); }} disabled={Boolean(busy)}>모을 플리 고르기</button>
            <button className="btn ghost" onClick={off} disabled={Boolean(busy)}>끄기</button>
          </div>
          <button className="linkish col-undo" onClick={askUndo} disabled={Boolean(busy)}>자동으로 넣은 곡 빼기</button>
        </>
      ) : (
        <>
          {st?.problem && <p className="col-sub err">{st.problem}</p>}
          {st?.undone && !st.pendingUndo && <p className="col-sub">{ago(st.undone.at)} {st.targetName ?? ''}에서 자동으로 넣었던 {st.undone.count.toLocaleString()}곡을 뺐어요.</p>}
          <label className="col-pick">
            <span>모을 플리</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">고르세요</option>
              {mine.map((p) => <option key={p.id} value={p.id}>{p.name}{p.count != null ? ` (${p.count}곡)` : ''}</option>)}
            </select>
          </label>
          <div className="col-actions">
            <button className="btn" onClick={openSetup} disabled={!target || Boolean(busy)}>다음: 어느 플리에서 모을지 고르기</button>
          </div>
          {st?.target && !st.pendingUndo && (st.total > 0 || (st.windows ?? []).length > 0) && (
            <button className="linkish col-undo" onClick={askUndo} disabled={Boolean(busy)}>자동으로 넣은 곡 빼기</button>
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
