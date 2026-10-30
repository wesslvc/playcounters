import { NextResponse } from 'next/server';
import { buildReport, saveReport, loadStatus, takeLock, dropLock } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

async function collect() {
  const report = await buildReport();
  await saveReport(report);
  return report;
}

/**
 * Vercel's cron calls this daily with `Authorization: Bearer $CRON_SECRET`;
 * /api/phones/refresh?secret=<CRON_SECRET or PHONES_REFRESH_SECRET> runs it by
 * hand. No cooldown for these — only the owner has the secret.
 */
export async function GET(req) {
  const given = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? new URL(req.url).searchParams.get('secret');
  const allowed = [process.env.CRON_SECRET, process.env.PHONES_REFRESH_SECRET].filter(Boolean);
  if (!given || !allowed.includes(given)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const report = await collect();
    return NextResponse.json({ ok: true, phones: report.phones.length, failed: report.failed, generated_at: report.generated_at });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

/**
 * The page's button. Each run costs several web-search calls, so anyone may
 * press it but only when nothing is running and the last collection is more
 * than three hours old. The page doesn't wait on this response; it polls
 * /api/phones for the new report.
 */
export async function POST() {
  try {
    const st = await loadStatus();
    if (st.running) return NextResponse.json({ ok: false, error: 'running' }, { status: 409 });
    if (Date.now() < st.nextAt) return NextResponse.json({ ok: false, error: 'cooldown', nextAt: st.nextAt }, { status: 429 });
    await takeLock();
    try {
      const report = await collect();
      return NextResponse.json({ ok: true, phones: report.phones.length, generated_at: report.generated_at });
    } finally {
      await dropLock();
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
