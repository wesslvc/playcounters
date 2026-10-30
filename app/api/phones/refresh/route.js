import { NextResponse } from 'next/server';
import { createJob, ipHash, refreshWatched, runSearch, getJob } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

/**
 * Owner-only. Vercel's cron calls it daily with `Authorization: Bearer $CRON_SECRET`
 * and it brings the followed phones up to date. By hand, with
 * ?secret=<CRON_SECRET or PHONES_REFRESH_SECRET>:
 *   (nothing)            refresh followed phones
 *   &brands=Samsung,Apple  run a search for those brands now (seeds the library)
 */
export async function GET(req) {
  const url = new URL(req.url);
  const given = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? url.searchParams.get('secret');
  const allowed = [process.env.CRON_SECRET, process.env.PHONES_REFRESH_SECRET].filter(Boolean);
  if (!given || !allowed.includes(given)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const brands = (url.searchParams.get('brands') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (brands.length) {
      const plan = { brands, models: [], os: 'any', form: 'any', budget_min_man: null, budget_max_man: null, chip_families: [], include_upcoming: true, reason: '' };
      const id = await createJob(plan, ipHash('owner'));
      await runSearch(id, plan);
      return NextResponse.json({ ok: true, job: await getJob(id) });
    }
    return NextResponse.json({ ok: true, ...(await refreshWatched()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
