import { NextResponse } from 'next/server';
import { loadHistory } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** Snapshots of the given phones over time, for the fit graph: /api/phones/history?ids=a,b */
export async function GET(req) {
  const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!ids.length) return NextResponse.json({ history: {} });
  try {
    return NextResponse.json({ history: await loadHistory(ids) });
  } catch (e) {
    return NextResponse.json({ history: {}, error: e.message }, { status: 500 });
  }
}
