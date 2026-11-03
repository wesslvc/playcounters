import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { admit, createJob, ipHash, needsCalibration, runCalibrate } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

/**
 * Has the judge weigh every researched phone against the others. Only runs
 * when some phone hasn't been judged since it was last researched, so asking
 * again costs nothing; the answer is a job id the page polls like a search.
 */
export async function POST(req) {
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const ip = ipHash(req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'anon');
  try {
    const st = await needsCalibration();
    if (!st.stale || st.count < 2) return NextResponse.json({ skipped: true });
    const ok = await admit(ip);
    if (!ok.ok) return NextResponse.json({ error: ok.error }, { status: 429 });
    const id = await createJob({ kind: 'calibrate' }, ip);
    waitUntil(runCalibrate(id));
    return NextResponse.json({ id }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
