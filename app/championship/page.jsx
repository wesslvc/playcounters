import { redirect } from 'next/navigation';
import { currentUserId } from '@/lib/db';
import Championship from '@/app/Championship';

export const dynamic = 'force-dynamic';

/** Same guard as /import: /api/season already rejects anonymous requests,
    this just skips rendering a page that can only ever fail to load. */
export default function ChampionshipPage() {
  if (!currentUserId()) redirect('/');
  return <Championship />;
}
