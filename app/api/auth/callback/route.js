import { NextResponse } from 'next/server';
import { db, sessionCookie } from '@/lib/db';
import { exchangeCode, getProfile } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const code = req.nextUrl.searchParams.get('code');
  const denied = req.nextUrl.searchParams.get('error');
  if (denied || !code) {
    return NextResponse.redirect(new URL('/?error=denied', req.url));
  }

  try {
    const token = await exchangeCode(code);
    const me = await getProfile(token.access_token);

    const { data, error } = await db
      .from('users')
      .upsert(
        {
          spotify_id: me.id,
          display_name: me.display_name || me.id,
          avatar_url: me.images?.[0]?.url ?? null,
          refresh_token: token.refresh_token,
        },
        { onConflict: 'spotify_id' }
      )
      .select('id')
      .single();
    if (error) throw error;

    const res = NextResponse.redirect(new URL('/', req.url));
    res.cookies.set(sessionCookie(data.id));
    return res;
  } catch (e) {
    console.error('callback failed', e);
    return NextResponse.redirect(new URL('/?error=auth', req.url));
  }
}
