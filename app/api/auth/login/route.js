import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('client_id', process.env.SPOTIFY_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', process.env.SPOTIFY_REDIRECT_URI);
  url.searchParams.set('scope', 'user-read-recently-played user-read-email');
  url.searchParams.set('show_dialog', 'false');
  return NextResponse.redirect(url.toString());
}
