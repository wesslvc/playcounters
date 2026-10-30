import { NextResponse } from 'next/server';

/**
 * newphoneprediction.<domain> serves the phone predictor at its root; every
 * other host keeps the playcounters app. Only the root is rewritten — /api
 * and static paths are shared, so the same deployment answers both.
 */
export function middleware(req) {
  const host = req.headers.get('host') ?? '';
  if (host.startsWith('newphoneprediction.') && req.nextUrl.pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = '/newphoneprediction';
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/'] };
