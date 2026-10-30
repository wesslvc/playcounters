import { NextResponse } from 'next/server';
import { activeJob, listDossiers } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** Every researched phone, newest research first. */
export async function GET() {
  try {
    const [phones, active] = await Promise.all([listDossiers(), activeJob()]);
    return NextResponse.json({ phones, active });
  } catch (e) {
    return NextResponse.json({ phones: [], error: e.message }, { status: 500 });
  }
}
