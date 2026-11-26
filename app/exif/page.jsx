import Client from './Client';
import './exif.css';

export const metadata = {
  title: '필름곳간 프레임',
  description: '한 사람이 찍고 세 사람이 보정한 사진을 촬영 정보와 크레딧을 넣은 프레임으로 만듭니다.',
};

export default function Page() {
  return <Client />;
}
