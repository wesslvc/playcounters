import { imageFor } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 20;

/**
 * A phone's picture, fetched server-side (many sites refuse other sites'
 * hotlinks) and cached at the edge: /api/phones/img?id=<phone>&i=<n>.
 * Only pictures a dossier already names are served — it is not an open proxy.
 */
export async function GET(req) {
  const q = new URL(req.url).searchParams;
  const id = q.get('id') ?? '';
  const i = Number(q.get('i') ?? 0);
  if (!id || !Number.isInteger(i) || i < 0 || i > 8) return new Response('bad request', { status: 400 });
  const img = await imageFor(id, i).catch(() => null);
  if (!img) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
  return new Response(img.buf, {
    headers: {
      'Content-Type': img.type,
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
    },
  });
}
