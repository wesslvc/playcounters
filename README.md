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
2. 음악을 들으면 30분 안에 순위에 반영됩니다
3. 과거 기록은 `/import`에서 `Streaming_History_Audio_*.json` 업로드

가져오기는 브라우저에서 파일을 읽어 곡·가수·시각만 서버로 보냅니다.
파일에 들어있는 IP 주소 같은 항목은 올라가지 않습니다.

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
