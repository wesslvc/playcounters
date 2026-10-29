import './globals.css';

export const metadata = {
  title: 'playcounters',
  description: 'Spotify 재생 기록을 실시간으로 모아 순위로 보여줍니다.',
  // Saved to the home screen it opens full screen, under its own name.
  appleWebApp: { capable: true, title: 'playcounters', statusBarStyle: 'default' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F6F4' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0B0C' },
  ],
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
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
