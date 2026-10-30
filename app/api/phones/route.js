import { NextResponse } from 'next/server';
import { loadStatus } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** The latest collected report, and whether a collection is running or on cooldown. */
export async function GET() {
  try {
    return NextResponse.json(await loadStatus());
  } catch (e) {
    return NextResponse.json({ report: null, running: false, nextAt: 0, error: e.message }, { status: 500 });
  }
}
