import { NextResponse } from 'next/server';
import { loadReport } from '@/lib/phones';

export const dynamic = 'force-dynamic';

/** The latest collected report, as stored by /api/phones/refresh. */
export async function GET() {
  try {
    const report = await loadReport();
    return NextResponse.json({ report });
  } catch (e) {
    return NextResponse.json({ report: null, error: e.message }, { status: 500 });
  }
}
