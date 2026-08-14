import { redirect } from 'next/navigation';
import { currentUserId } from '@/lib/db';
import ImportForm from './ImportForm';

export const dynamic = 'force-dynamic';

/**
 * /api/import already rejects anonymous posts, so this guard is about not
 * wasting the visitor's time: without it the upload form renders, parses a
 * multi-megabyte export in the browser, and only then fails on a 401.
 */
export default function ImportPage() {
  if (!currentUserId()) redirect('/');
  return <ImportForm />;
}
