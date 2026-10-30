import { NextResponse } from 'next/server';
import { activeJob, ipHash, listDossiers } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** Every researched phone, newest research first. */
export async function GET(req) {
  try {
    const ip = ipHash(req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'anon');
    const [phones, active] = await Promise.all([listDossiers(), activeJob(ip)]);
    return NextResponse.json({ phones, active });
  } catch (e) {
    return NextResponse.json({ phones: [], error: e.message }, { status: 500 });
  }
}
