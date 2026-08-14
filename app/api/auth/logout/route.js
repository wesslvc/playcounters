import { NextResponse } from 'next/server';
import { clearedCookie } from '@/lib/db';

export const dynamic = 'force-dynamic';

export function GET(req) {
  const res = NextResponse.redirect(new URL('/', req.url));
  res.cookies.set(clearedCookie);
  return res;
}
