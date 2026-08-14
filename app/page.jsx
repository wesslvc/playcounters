import { currentUserId } from '@/lib/db';
import Dashboard from './Dashboard';

export const dynamic = 'force-dynamic';

export default function Home({ searchParams }) {
  const signedIn = Boolean(currentUserId());

  if (signedIn) return <Dashboard />;

  const failed = searchParams?.error;

  return (
    <div className="wrap">
      <header>
        <p className="eyebrow">Spotify 재생 기록</p>
        <h1>내가 <em>진짜</em><br />들은 것</h1>
      </header>

      <div className="panel">
        <h2>Spotify 계정으로 시작하기</h2>
        <p>
          연결하면 30분마다 재생 기록을 모읍니다. 곡·가수 순위, 들은 날짜 수,
          하루별 재생량을 볼 수 있어요.
        </p>
        {failed && (
          <p className="err">
            {failed === 'denied' ? '연결이 취소됐습니다.' : '로그인에 실패했습니다. 다시 시도해 주세요.'}
          </p>
        )}
        <a className="btn" href="/api/auth/login">Spotify 연결</a>
      </div>

      <div className="panel">
        <h2>예전 기록도 넣을 수 있습니다</h2>
        <p>
          Spotify에서 받은 &ldquo;확장 스트리밍 기록&rdquo; JSON 파일을 올리면
          원래 날짜 그대로 합쳐집니다. 연결 후 가져오기 화면에서 하세요.
        </p>
      </div>

      <p className="foot">
        30초 이상 재생된 것만 셉니다. 팟캐스트와 오디오북은 빠집니다.
      </p>
    </div>
  );
}
