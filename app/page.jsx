import { currentUserId } from '@/lib/db';
import App from './App';
import Landing from './Landing';

export const dynamic = 'force-dynamic';

export default function Home({ searchParams }) {
  if (currentUserId()) return <App initialTab="chart" />;
  return <Landing failed={searchParams?.error} />;
}
