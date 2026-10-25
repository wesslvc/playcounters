/** The signed-out front page. */
export default function Landing({ failed }) {
  return (
    <div className="landing">
      <div className="landing-in">
        <p className="landing-mark">playcounters</p>
        <h1>들은 만큼,<br />기록됩니다.</h1>
        <p className="landing-lede">
          Spotify 재생 기록을 20분마다 모아 곡과 가수의 순위, 매달 열리는 그랑프리,
          분기별 리플레이, 그리고 깨지지 않은 기록들로 보여 줍니다.
        </p>
        {failed && (
          <p className="err">{failed === 'denied' ? '연결이 취소됐습니다.' : '로그인에 실패했습니다. 다시 시도해 주세요.'}</p>
        )}
        <a className="btn" href="/api/auth/login">Spotify로 시작하기</a>
        <dl className="landing-list">
          <div><dt>차트</dt><dd>전체부터 하루까지, 원하는 기간의 순위</dd></div>
          <div><dt>챔피언십</dt><dd>매달 TOP 10에 F1 포인트, 시즌과 통산 스탠딩</dd></div>
          <div><dt>리플레이</dt><dd>3개월마다 정리되는 순위와 플레이리스트</dd></div>
          <div><dt>Awards</dt><dd>최단기간 100회, 최장 연속 1위 같은 부문별 기록</dd></div>
        </dl>
        <p className="landing-foot">
          예전 기록은 Spotify의 확장 스트리밍 기록 JSON으로 원래 날짜 그대로 합칠 수 있습니다.
          30초 이상 재생된 것만 셉니다.
        </p>
      </div>
    </div>
  );
}
