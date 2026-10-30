import { NextResponse } from 'next/server';
import { buildReport, saveReport } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Collects and stores a fresh report. Vercel's cron calls it daily with
 * `Authorization: Bearer $CRON_SECRET`; to run it by hand, open
 * /api/phones/refresh?secret=<PHONES_REFRESH_SECRET>. Each run costs several web-search
 * calls, so it is never open to the public.
 */
export async function GET(req) {
  const given = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? new URL(req.url).searchParams.get('secret');
  // CRON_SECRET is what Vercel's cron sends; PHONES_REFRESH_SECRET is for running it by hand
  const allowed = [process.env.CRON_SECRET, process.env.PHONES_REFRESH_SECRET].filter(Boolean);
  if (!given || !allowed.includes(given)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const report = await buildReport();
    await saveReport(report);
    return NextResponse.json({ ok: true, phones: report.phones.length, failed: report.failed, generated_at: report.generated_at });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
