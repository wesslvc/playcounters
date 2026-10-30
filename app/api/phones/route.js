import { NextResponse } from 'next/server';
import { listDossiers } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** Every researched phone, newest research first. */
export async function GET() {
  try {
    const phones = await listDossiers();
    return NextResponse.json({ phones });
  } catch (e) {
    return NextResponse.json({ phones: [], error: e.message }, { status: 500 });
  }
}
