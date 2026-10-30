import Client from './Client';
import './np.css';

export const metadata = {
  title: 'newphoneprediction',
  description: '유출 정보와 스펙을 종합해, 취향에 맞는 최신폰 5개를 골라 비교합니다.',
};

export default function Page() {
  return <Client />;
}
