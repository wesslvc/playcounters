import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { cookies } from 'next/headers';

/**
 * Server-only client. The service role key bypasses RLS — never ship it to
 * the browser.
 *
 * Built lazily: Next.js evaluates route modules while collecting page data at
 * build time, and creating the client up front makes the build fail on any
 * machine without the env vars set.
 */
let _client = null;
function client() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

export const db = new Proxy({}, {
  get: (_t, prop) => {
    const value = client()[prop];
    return typeof value === 'function' ? value.bind(client()) : value;
  },
});

const COOKIE = 'sid';

/* ---------------- session cookie ----------------
   value = <userId>.<hmac>. No library, no server state.       */

function sign(value) {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(value)
    .digest('base64url');
}

export function sessionCookie(userId) {
  return {
    name: COOKIE,
    value: `${userId}.${sign(userId)}`,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  };
}

/** Returns the signed-in user's id, or null. */
export function currentUserId() {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const id = raw.slice(0, i);
  const mac = raw.slice(i + 1);
  const good = sign(id);
  // constant-time compare; timingSafeEqual throws on length mismatch
  if (mac.length !== good.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  return id;
}

export const clearedCookie = {
  name: COOKIE, value: '', httpOnly: true, secure: true,
  sameSite: 'lax', path: '/', maxAge: 0,
};
