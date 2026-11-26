import Client from './Client';
import './exif.css';

export const metadata = {
  title: 'EXIF 프레임',
  description: '사진의 촬영 정보(카메라, 렌즈, 설정)를 읽어 프레임에 넣어 저장합니다.',
};

export default function Page() {
  return <Client />;
}
