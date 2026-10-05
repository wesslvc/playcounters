import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { rpcAll } from '@/lib/rpcPage';
import { genresFor } from '@/lib/families';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Seoul';

const DEFAULT_LIMIT = 1000;
// High enough that 펼치기 reaches the true end of anyone's real history rather
// than stopping at an arbitrary wall.
const MAX_LIMIT = 50000;

export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const mode = q.get('mode') === 'artists' ? 'artists' : 'tracks';
  // Spotify and YouTube aren't measured the same way, so they can be read apart.
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';
  // YouTube counts are calibrated against Recap when asked for; Spotify rows
  // are unaffected either way. Harmless without a calibration too — the
  // per-play estimate is then the recorded value, so the flag changes nothing.
  const estimate = q.get('estimate') === '1';
  // The per-item day list is the largest thing here and only the span graph
  // needs it, so it is opt-in rather than always sent.
  const withDays = q.get('days') === '1';
  const from = q.get('from') || '1970-01-01T00:00:00Z';
  const to   = q.get('to')   || new Date(Date.now() + 864e5).toISOString();

  const asked = Number(q.get('limit'));
  const limit = Number.isFinite(asked) && asked > 0
    ? Math.min(asked, MAX_LIMIT)
    : DEFAULT_LIMIT;

  // The equivalent window immediately before this one, so the client can rank
  // both and show movement. Absent for "전체", which has no before.
  const prevFrom = q.get('prevFrom');
  const prevTo = q.get('prevTo');
  const wantPrev = Boolean(prevFrom && prevTo);
  // The calendar covers all of history and never changes with the selected
  // period, so the client asks for it once (and again when the source
  // changes or after a sync) instead of on every period switch.
  const wantCal = q.get('cal') === '1';

  const [items, daily, total, prev, prior, calendar, calibrated, user] = await Promise.all([
    rpcAll('top_items', {
      p_user: userId, p_from: from, p_to: to, p_mode: mode, p_tz: TZ,
      p_limit: limit, p_source: src, p_days: withDays, p_estimate: estimate,
    }, limit),
    // Unbounded, and it's what the header totals are summed from — a
    // multi-year "전체" easily passes 1,000 distinct days, so this needs the
    // same paging or the plays/minutes/days figures silently undercount.
    rpcAll('daily_totals', { p_user: userId, p_from: from, p_to: to, p_tz: TZ, p_source: src, p_estimate: estimate }, MAX_LIMIT),
    db.rpc('item_count', { p_user: userId, p_from: from, p_to: to, p_mode: mode, p_tz: TZ, p_source: src }),
    wantPrev
      ? rpcAll('top_items', {
          p_user: userId, p_from: prevFrom, p_to: prevTo,
          p_mode: mode, p_tz: TZ, p_limit: limit, p_source: src,
          p_estimate: estimate,
        }, limit)
      : Promise.resolve({ data: null, error: null }),
    // Only worth asking when there's a previous window to compare against —
    // it's what tells "missing from last window" apart from "never played
    // before," and the first is meaningless without the second. Unbounded in
    // principle, so it's asked for up to the same generous ceiling as
    // everything else here rather than a made-up smaller one.
    wantPrev
      ? rpcAll('prior_items', { p_user: userId, p_before: from, p_mode: mode, p_tz: TZ, p_source: src }, MAX_LIMIT)
      : Promise.resolve({ data: null, error: null }),
    // Spans all of history regardless of the selected period, so this is the
    // one most likely of all to pass the cap — and a truncated year would
    // simply vanish from the picker with nothing on screen to say so.
    wantCal
      ? rpcAll('play_calendar', { p_user: userId, p_tz: TZ, p_source: src }, MAX_LIMIT)
      : Promise.resolve({ data: null, error: null }),
    db.rpc('has_youtube_estimate', { p_user: userId }),
    db.from('users').select('display_name, avatar_url, last_synced_at').eq('id', userId).single(),
  ]);

  if (items.error)  return NextResponse.json({ error: items.error.message }, { status: 500 });
  if (daily.error)  return NextResponse.json({ error: daily.error.message }, { status: 500 });

  const rows = items.data || [];
  const days = daily.data || [];
  const genres = await genresFor(rows.map((r) => r.artist));

  return NextResponse.json({
    user: user.data ?? null,
    items: rows,
    // Cached genres (and shades) for these artists, so colors are right on
    // first paint.
    genres,
    daily: days,
    // Ranking depends on the metric the client is sorting by, so send the raw
    // previous window and let it rank both the same way.
    prev: prev.error ? null : prev.data,
    // Every item with any play before this window started, regardless of how
    // long ago — what the client checks before calling something NEW rather
    // than just absent from the immediately preceding window.
    prior: prior.error ? null : prior.data,
    // Every day that holds plays, newest first. The year/month/day picker
    // derives its options from this, so it can never offer an empty date.
    // Independent of the selected period.
    // null when not asked for, so the client keeps the one it already holds.
    calendar: !wantCal ? null : calendar.error ? [] : (calendar.data ?? []),
    // Whether a Recap calibration exists, so the UI only offers the estimate
    // when there is something real behind it.
    calibrated: calibrated.error ? false : Boolean(calibrated.data),
    // What the numbers below actually are, not what was asked for: without a
    // calibration the estimate resolves to the recorded figures.
    estimate: estimate && !calibrated.error && Boolean(calibrated.data),
    summary: {
      // Rounded once over the whole window rather than once a day, so the
      // header agrees with the rows underneath it.
      plays:   Math.round(days.reduce((s, d) => s + Number(d.plays), 0)),
      minutes: Math.round(days.reduce((s, d) => s + Number(d.minutes), 0)),
      days:    days.length,
      // The real distinct count; `shown` is how much of it the list holds.
      items:   total.error ? rows.length : Number(total.data),
      shown:   rows.length,
      // Whether YouTube plays are part of these totals, so the header can say
      // so only when they are.
      yt:      days.some((d) => d.yt),
    },
  });
}
