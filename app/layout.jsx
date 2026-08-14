import './globals.css';

export const metadata = {
  title: '내 재생 기록',
  description: 'Spotify 재생 기록을 실시간으로 모아 순위로 보여줍니다.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
