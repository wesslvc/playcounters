# 내 재생 기록

Spotify 재생 기록을 30분마다 모아 곡·가수 순위로 보여주는 웹앱.
과거 기록(확장 스트리밍 기록 JSON)도 원래 날짜 그대로 합칠 수 있습니다.

Next.js (App Router) · Supabase Postgres · Vercel · GitHub Actions.
모두 무료 티어 안에서 돌아갑니다.

---

## 왜 이런 구조인가

Spotify에는 전체 재생 기록 API가 없습니다. `recently-played`는 **최근 50곡**만
돌려주고 그보다 과거로는 페이지를 넘길 수 없습니다. 그래서 자주 긁어와 DB에
쌓는 것 말고는 방법이 없습니다.

Vercel Hobby 플랜의 크론은 **하루 한 번**만 돌아갑니다. 하루에 50곡 넘게 듣는
사람은 매일 기록이 새어나갑니다. 그래서 스케줄을 GitHub Actions에 두고
(`.github/workflows/sync.yml`), Vercel API 라우트를 30분마다 호출합니다.
Vercel 플랜은 그대로 무료입니다.

---

## 설치

### 1. Supabase

1. [supabase.com](https://supabase.com)에서 프로젝트 생성 (무료)
2. SQL Editor에 `supabase/schema.sql` 전체를 붙여넣고 실행
3. Project Settings → API에서 **Project URL**과 **service_role** 키 복사

> 무료 플랜은 프로젝트 개수가 제한돼 있습니다. 새로 만들 수 없다면 쓰던
> 프로젝트에 얹어도 됩니다 — 이 스키마가 만드는 것은 `users`, `plays` 두
> 테이블과 `top_items`, `daily_totals` 두 함수뿐이라, 이 이름들만 비어 있으면
> 충돌하지 않습니다. 다만 그 프로젝트의 service_role 키를 이 앱에 넣게 되므로,
> 앱이 뚫리면 같은 DB의 다른 데이터까지 닿는다는 점은 감안하세요.

### 2. Spotify 개발자 앱

1. [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → Create app
2. Redirect URI에 `https://<배포주소>/api/auth/callback` 등록 (오타 하나도 안 됩니다)
3. Client ID와 Client Secret 복사

> 기본은 개발 모드라 **최대 25명**까지만 로그인됩니다. 친구들 몇 명이면 충분하고,
> 그 이상은 대시보드에서 쿼터 확장을 신청해야 합니다.

### 3. Vercel

GitHub에 올린 뒤 Vercel에서 import하고, 환경변수 7개를 넣습니다
(`.env.example` 참고):

| 변수 | 값 |
|---|---|
| `SPOTIFY_CLIENT_ID` | Spotify 대시보드 |
| `SPOTIFY_CLIENT_SECRET` | Spotify 대시보드 |
| `SPOTIFY_REDIRECT_URI` | `https://<배포주소>/api/auth/callback` |
| `SUPABASE_URL` | Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase |
| `SESSION_SECRET` | 아무 긴 랜덤 문자열 |
| `CRON_SECRET` | 아무 긴 랜덤 문자열 |

랜덤 문자열 만들기: `openssl rand -base64 32`

### 4. GitHub Actions

저장소 → Settings → Secrets and variables → Actions에 두 개 추가:

- `APP_URL` — `https://<배포주소>` (끝에 슬래시 없이)
- `CRON_SECRET` — Vercel에 넣은 것과 같은 값

Actions 탭에서 **Run workflow**로 한 번 눌러 동작을 확인하세요.

---

## 쓰는 법

1. 배포 주소 접속 → **Spotify 연결**
2. 음악을 들으면 30분 안에 순위에 반영됩니다.
   기다리기 싫으면 **지금 갱신** 버튼을 누르면 즉시 가져옵니다
3. 과거 기록은 `/import`에서 채웁니다
   - **Spotify** — `Streaming_History_Audio_*.json`
   - **YouTube Music** — Google Takeout의 `watch-history.html`

순위의 막대는 1위 대비 비율입니다. 정렬 기준을 바꾸면 막대도 그 기준으로
다시 그려집니다.

가져오기는 브라우저에서 파일을 읽어 곡·가수·시각만 서버로 보냅니다.
파일에 들어있는 IP 주소 같은 항목은 올라가지 않습니다. Takeout HTML은
수백 MB가 되기도 해서 스트리밍으로 조금씩 읽습니다.

### 유튜브 기록의 한계

Takeout에는 **재생 시간이 없습니다.** 그래서 유튜브 재생은 횟수·들은 날에는
반영되지만 시간 합계에는 0으로 잡히고, 30초 규칙도 적용할 수 없어 잠깐 넘긴
곡도 1회로 셉니다. 측정 기준이 다르므로 대시보드의 **출처** 필터로
Spotify만 / YouTube만 / 합산을 나눠 볼 수 있습니다.

기본은 `YouTube Music` 항목만 가져옵니다. 일반 YouTube 영상까지 포함하면
음악이 아닌 영상도 전부 재생으로 잡히니, 필요할 때만 체크하세요.

실시간 수집은 유튜브에서 불가능합니다. 시청 기록을 주는 API가 없어서
(YouTube Data API의 해당 창구는 막혔고 YouTube Music은 공개 API가 없습니다),
Takeout 파일을 받아 넣는 것이 유일한 방법입니다.

---

## 세는 기준

- **30초 이상** 재생된 것만 셉니다 (stats.fm, .fmbot과 같은 기준)
- 팟캐스트·오디오북 제외
- 날짜는 한국 시간(`Asia/Seoul`) 기준 — 바꾸려면 `app/api/stats/route.js`의 `TZ`

라이브로 수집된 재생의 `ms_played`는 곡 길이를 씁니다. `recently-played`는
얼마나 들었는지가 아니라 무엇을 재생했는지만 알려주기 때문입니다. 가져온
과거 기록은 Spotify가 기록한 실제 재생 시간을 그대로 씁니다.

---

## 이름에 관하여

`spotistats` 같은 이름은 피하세요. Spotify 개발자 약관이 Spotify에서 파생된
이름과 로고 사용을 금지하고, stats.fm의 옛 이름이기도 해서 승인 단계에서
막히거나 나중에 도메인을 잃을 수 있습니다.
