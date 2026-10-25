import { redirect } from 'next/navigation';
import { currentUserId } from '@/lib/db';
import App from '@/app/App';

export const dynamic = 'force-dynamic';

/** One of the app's tabs, reachable at its own address. */
export default function Page() {
  if (!currentUserId()) redirect('/');
  return <App initialTab="season" />;
}
