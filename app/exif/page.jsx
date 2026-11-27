import Client from './Client';
import './exif.css';

export const metadata = {
  title: '필름곳간 프레임',
  description: '한 사람이 찍고 세 사람이 보정한 사진을 촬영 정보와 크레딧을 넣은 프레임으로 만듭니다.',
};

// type: on the frame, Newsreader with Nanum Myeongjo for Korean; on the page,
// Wanted Sans, with Instrument Serif in its title
const FONTS = [
  'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Nanum+Myeongjo:wght@400;700;800&display=swap',
  'https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.3/packages/wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.min.css',
];

export default function Page() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      {FONTS.map((href) => <link key={href} rel="stylesheet" href={href} />)}
      <Client />
    </>
  );
}
