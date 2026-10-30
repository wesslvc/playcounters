import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { admit, cancelJob, createJob, getJob, ipHash, runSearch } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

/** Progress and result of a search job: /api/phones/search?id=... */
export async function GET(req) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  try {
    const job = await getJob(id);
    return job ? NextResponse.json(job) : NextResponse.json({ error: 'not found' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * Starts a search for the plan and answers at once with a job id; the work
 * carries on after the response (it takes minutes) and the page polls GET.
 */
export async function POST(req) {
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const p = body.plan;
  if (!p || typeof p !== 'object') return NextResponse.json({ error: 'no plan' }, { status: 400 });
  const plan = {
    brands: (Array.isArray(p.brands) ? p.brands : []).filter((x) => typeof x === 'string').slice(0, 8),
    models: (Array.isArray(p.models) ? p.models : []).filter((x) => typeof x === 'string').slice(0, 8).map((x) => x.slice(0, 80)),
    os: ['android', 'ios'].includes(p.os) ? p.os : 'any',
    form: ['bar', 'foldable', 'flip'].includes(p.form) ? p.form : 'any',
    budget_min_man: Number.isFinite(p.budget_min_man) ? p.budget_min_man : null,
    budget_max_man: Number.isFinite(p.budget_max_man) ? p.budget_max_man : null,
    chip_families: Array.isArray(p.chip_families) ? p.chip_families.filter((x) => typeof x === 'string').slice(0, 6) : [],
    include_upcoming: p.include_upcoming !== false,
    reason: String(p.reason ?? '').slice(0, 300),
    // only for phones named outright: "research this one again now"
    force: p.force === true && Array.isArray(p.models) && p.models.length > 0 && p.models.length <= 2,
  };
  const ip = ipHash(req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'anon');
  try {
    const ok = await admit(ip);
    if (!ok.ok) return NextResponse.json({ error: ok.error }, { status: 429 });
    const id = await createJob(plan, ip);
    waitUntil(runSearch(id, plan, { force: plan.force }));
    return NextResponse.json({ id }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** Stops a running job: /api/phones/search?id=... (the id is only ever given to whoever started it). */
export async function DELETE(req) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f]{16}$/.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  try {
    return NextResponse.json({ ok: await cancelJob(id) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
