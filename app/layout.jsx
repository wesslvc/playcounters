import './globals.css';

export const metadata = {
  title: '내 재생 기록',
  description: 'Spotify 재생 기록을 실시간으로 모아 순위로 보여줍니다.',
};

/**
 * Applied before the first paint. Left to an effect it would run after the
 * page had already rendered in the wrong palette, which reads as a flash of
 * white on every load for anyone using dark mode. No stored choice means the
 * attribute stays unset and the CSS follows the system preference.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
