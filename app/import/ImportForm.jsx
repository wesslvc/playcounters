'use client';

import { useState } from 'react';

const BATCH = 1500;

export default function ImportForm() {
  const [status, setStatus] = useState('idle');   // idle | working | done | error
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [inserted, setInserted] = useState(0);

  async function handleFiles(event) {
    const files = [...event.target.files].filter((f) => f.name.endsWith('.json'));
    if (!files.length) {
      setStatus('error');
      setMessage('.json 파일을 선택해 주세요. zip은 먼저 풀어야 합니다.');
      return;
    }

    setStatus('working');
    setProgress(0);
    setInserted(0);
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

    let done = 0;
    let total = 0;
    for (let i = 0; i < music.length; i += BATCH) {
      const batch = music.slice(i, i + BATCH);
      setMessage(`올리는 중… ${(i + batch.length).toLocaleString()} / ${music.length.toLocaleString()}`);
      try {
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || res.status);
        total += json.inserted ?? 0;
      } catch (e) {
        setStatus('error');
        setMessage(`업로드가 중단됐습니다: ${e.message}. 다시 올리면 이어서 진행됩니다.`);
        return;
      }
      done += batch.length;
      setProgress(Math.round((done / music.length) * 100));
      setInserted(total);
    }

    setStatus('done');
    setMessage(`${total.toLocaleString()}건을 넣었습니다.`);
  }

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
        <h2>Spotify JSON 파일 올리기</h2>
        <p>
          <code>Streaming_History_Audio_*.json</code> 파일을 고르세요. 여러 개를
          한 번에 선택해도 됩니다. 원래 재생 날짜가 그대로 들어가고, 이미 있는
          기록은 자동으로 건너뜁니다.
        </p>

        <input
          type="file"
          accept=".json,application/json"
          multiple
          onChange={handleFiles}
          disabled={status === 'working'}
        />

        {status === 'working' && (
          <>
            <div className="bar"><div style={{ width: progress + '%' }} /></div>
            <p className="note">{message}</p>
          </>
        )}
        {status === 'done' && (
          <>
            <p className="note" style={{ marginTop: 10 }}>{message}</p>
            <a className="btn" href="/" style={{ marginTop: 12 }}>순위 보기</a>
          </>
        )}
        {status === 'error' && <p className="err" style={{ marginTop: 10 }}>{message}</p>}
      </div>

      <div className="panel">
        <h2>파일이 없다면</h2>
        <p>
          Spotify 계정 → 개인정보 설정 → 데이터 다운로드에서 &ldquo;확장 스트리밍
          기록&rdquo;만 체크하고 신청하세요. 보통 며칠, 최대 30일 걸립니다. 받은
          zip을 풀면 안에 json 파일들이 들어 있습니다.
        </p>
        <a className="btn ghost" href="https://www.spotify.com/account/privacy/" target="_blank" rel="noreferrer">
          Spotify 개인정보 설정 열기
        </a>
      </div>

      <p className="foot">
        파일은 브라우저에서 읽어 곡·가수·시각만 서버로 보냅니다.
        IP 주소 같은 나머지 항목은 올라가지 않습니다.
      </p>
    </div>
  );
}
