import { NextResponse } from 'next/server';
import { watch } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** Tells the daily refresh which phones people are following. */
export async function POST(req) {
  const { ids } = await req.json().catch(() => ({}));
  const list = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string').slice(0, 30) : [];
  if (!list.length) return NextResponse.json({ ok: true, watching: 0 });
  try {
    return NextResponse.json({ ok: true, watching: await watch(list) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
