import { NextResponse } from 'next/server';
import { planFrom } from '@/lib/phones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 30;

const hits = new Map();
/** Best-effort, per instance: 10 requests a minute per address. */
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60e3);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 10;
}

/** Turns "게임 많이 하고 가벼운 삼성폰, 150만원 이하" into sliders, filters, brands and named models. */
export async function POST(req) {
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'anon';
  if (limited(ip)) return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? '').trim().slice(0, 400);
  const brands = (Array.isArray(body.brands) ? body.brands : []).filter((b) => typeof b === 'string').slice(0, 8);
  if (!text && !brands.length) return NextResponse.json({ error: 'empty' }, { status: 400 });
  try {
    return NextResponse.json(await planFrom(text || '추천해줘', brands));
  } catch (e) {
    return NextResponse.json({ error: String(e.message).slice(0, 160) }, { status: 502 });
  }
}
