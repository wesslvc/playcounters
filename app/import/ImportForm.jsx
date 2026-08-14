'use client';

import { useState } from 'react';
import { blankStats, consume, flush } from '@/lib/youtube';

const BATCH = 1500;

export default function ImportForm() {
  const [status, setStatus] = useState('idle');   // idle | working | done | error
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [plainYouTube, setPlainYouTube] = useState(false);

  /** Post one batch, returning how many rows landed. */
  async function send(batch, source) {
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch, source }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.status);
    return json.inserted ?? 0;
  }

  async function handleSpotify(event) {
    const files = [...event.target.files].filter((f) => f.name.endsWith('.json'));
    event.target.value = '';
    if (!files.length) {
      setStatus('error');
      setMessage('.json 파일을 선택해 주세요. zip은 먼저 풀어야 합니다.');
      return;
    }

    setStatus('working');
    setProgress(0);
    setMessage('파일을 읽는 중…');

    let all = [];
    for (const file of files) {
      try {
        const parsed = JSON.parse(await file.text());
        if (!Array.isArray(parsed)) throw new Error('array 아님');
        all = all.concat(parsed);
      } catch {
        setStatus('error');
        setMessage(`${file.name} 을 읽지 못했습니다. Spotify의 확장 스트리밍 기록 파일이 맞는지 확인해 주세요.`);
        return;
      }
    }

    // Podcasts and audiobooks have no track name — drop them before uploading
    // so we're not sending megabytes the server will throw away anyway.
    const music = all.filter((r) => r.master_metadata_track_name && r.ts);
    if (!music.length) {
      setStatus('error');
      setMessage('음악 재생 기록이 없는 파일입니다. Streaming_History_Audio 로 시작하는 파일을 올려 주세요.');
      return;
    }

    let total = 0;
    for (let i = 0; i < music.length; i += BATCH) {
      const batch = music.slice(i, i + BATCH);
      setMessage(`올리는 중… ${(i + batch.length).toLocaleString()} / ${music.length.toLocaleString()}`);
      try {
        total += await send(batch, 'spotify');
      } catch (e) {
        setStatus('error');
        setMessage(`업로드가 중단됐습니다: ${e.message}. 다시 올리면 이어서 진행됩니다.`);
        return;
      }
      setProgress(Math.round(((i + batch.length) / music.length) * 100));
    }

    setStatus('done');
    setMessage(`${total.toLocaleString()}건을 넣었습니다.`);
  }

  /**
   * Takeout's watch history is HTML and can run to hundreds of megabytes, so
   * it's streamed and decoded incrementally. A TextDecoder in stream mode is
   * what makes that safe: slicing raw bytes would cut multi-byte Korean
   * characters in half at chunk boundaries.
   */
  async function handleYouTube(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) {
      setStatus('error');
      setMessage('watch-history.html 파일을 선택해 주세요. zip은 먼저 풀어야 합니다.');
      return;
    }

    setStatus('working');
    setProgress(0);
    setMessage('파일을 읽는 중…');

    const stats = blankStats();
    const opts = { includePlainYouTube: plainYouTube, stats };
    const reader = file.stream().getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let pending = [];
    let read = 0;
    let total = 0;
    let found = 0;

    const drain = async (force) => {
      while (pending.length >= BATCH || (force && pending.length)) {
        const batch = pending.slice(0, BATCH);
        pending = pending.slice(BATCH);
        total += await send(batch, 'youtube');
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        read += value.byteLength;
        buffer += decoder.decode(value, { stream: true });

        const { rows, remainder } = consume(buffer, opts);
        buffer = remainder;
        pending.push(...rows);
        found += rows.length;

        await drain(false);
        setProgress(Math.round((read / file.size) * 100));
        setMessage(`읽는 중… ${found.toLocaleString()}건 발견 · ${Math.round((read / file.size) * 100)}%`);
      }

      buffer += decoder.decode();
      const last = consume(buffer, opts);
      pending.push(...last.rows, ...flush(last.remainder, opts));
      await drain(true);

      // Durations come from the gap between consecutive plays, so they can
      // only be worked out once every row is in.
      setMessage('재생 시간 계산 중…');
      await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'youtube', finalize: true }),
      });
    } catch (e) {
      setStatus('error');
      setMessage(`업로드가 중단됐습니다: ${e.message}. 다시 올리면 이어서 진행됩니다.`);
      return;
    }

    if (!total && !found) {
      // Say which stage discarded everything: "found nothing" alone gives no
      // way to tell a wrong file from a format this parser no longer matches.
      setStatus('error');
      setMessage(
        stats.cells === 0
          ? '이 파일에서 활동 기록을 찾지 못했습니다. Takeout의 watch-history.html이 맞는지 확인해 주세요.'
          : `기록 ${stats.cells.toLocaleString()}개를 읽었지만 넣을 수 있는 음악이 없습니다. ` +
            `(음악 아님 ${stats.product.toLocaleString()} · 링크 없음 ${stats.nolink.toLocaleString()} · ` +
            `이름 없음 ${stats.noname.toLocaleString()} · 날짜 못읽음 ${stats.nodate.toLocaleString()}) ` +
            (stats.product === stats.cells
              ? 'YouTube Music 항목이 하나도 없습니다 — 위의 “일반 YouTube 영상도 포함”을 켜고 다시 시도해 보세요.'
              : '')
      );
      return;
    }

    setStatus('done');
    setProgress(100);
    setMessage(`${total.toLocaleString()}건을 넣었습니다.`);
  }

  const busy = status === 'working';

  return (
    <div className="wrap">
      <nav className="nav">
        <a className="pill" href="/">← 홈</a>
      </nav>

      <header>
        <p className="eyebrow">가져오기</p>
        <h1>예전 기록<br />합치기</h1>
      </header>

      <div className="panel">
        <h2>Spotify — JSON</h2>
        <p>
          <code>Streaming_History_Audio_*.json</code> 파일을 고르세요. 여러 개를
          한 번에 선택해도 됩니다. 원래 재생 날짜가 그대로 들어가고, 이미 있는
          기록은 자동으로 건너뜁니다.
        </p>
        <input
          type="file"
          accept=".json,application/json"
          multiple
          onChange={handleSpotify}
          disabled={busy}
        />
      </div>

      <div className="panel">
        <h2>YouTube Music — HTML</h2>
        <p>
          Google Takeout에서 받은 <code>watch-history.html</code>을 고르세요.
          파일이 수백 MB여도 브라우저에서 조금씩 읽어 올리니 그대로 두시면 됩니다.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={plainYouTube}
            onChange={(e) => setPlainYouTube(e.target.checked)}
            disabled={busy}
          />
          일반 YouTube 영상도 포함 (기본은 YouTube Music만)
        </label>
        <input
          type="file"
          accept=".html,text/html"
          onChange={handleYouTube}
          disabled={busy}
        />
        <p className="note" style={{ marginTop: 10 }}>
          Takeout에는 재생 시간이 없지만, <b>다음 곡이 시작된 시각</b>으로
          역산합니다. 그래서 유튜브 기록에도 Spotify와 똑같이 30초 규칙이
          적용되고, 넘긴 곡은 순위에서 빠집니다.
        </p>
      </div>

      {status !== 'idle' && (
        <div className="panel">
          {busy && <div className="bar"><div style={{ width: progress + '%' }} /></div>}
          <p className={status === 'error' ? 'err' : 'note'}>{message}</p>
          {status === 'done' && <a className="btn" href="/" style={{ marginTop: 12 }}>순위 보기</a>}
        </div>
      )}

      <div className="panel">
        <h2>파일이 없다면</h2>
        <p>
          <b>Spotify</b> — 계정 → 개인정보 설정 → 데이터 다운로드에서 &ldquo;확장 스트리밍
          기록&rdquo;만 체크하고 신청하세요. 보통 며칠, 최대 30일 걸립니다.
        </p>
        <p>
          <b>YouTube</b> — takeout.google.com에서 &ldquo;YouTube 및 YouTube Music&rdquo;만
          선택하고, 그 안에서 &ldquo;기록&rdquo;만 고르면 파일이 훨씬 작아집니다.
        </p>
        <a className="btn ghost" href="https://www.spotify.com/account/privacy/" target="_blank" rel="noreferrer">
          Spotify 개인정보 설정
        </a>
        {' '}
        <a className="btn ghost" href="https://takeout.google.com/" target="_blank" rel="noreferrer">
          Google Takeout
        </a>
      </div>

      <p className="foot">
        파일은 브라우저에서 읽어 곡·가수·시각만 서버로 보냅니다.
        IP 주소 같은 나머지 항목은 올라가지 않습니다.
      </p>
    </div>
  );
}
