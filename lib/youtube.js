/**
 * Parser for Google Takeout's YouTube watch history.
 *
 * Takeout hands this out as HTML, not JSON, and a heavy account's file runs to
 * hundreds of megabytes — far too big to hand to DOMParser. The markup is
 * machine-generated and perfectly regular though, so it can be scanned as text
 * in streamed chunks and never held in memory whole.
 *
 * What the format cannot tell us matters as much as what it can: there is no
 * play duration anywhere in it. Rows come out with ms_played 0 and the ranking
 * counts them by play instead, rather than inventing a listening time.
 */

/** Each entry begins with this; splitting on it isolates one record. */
const MARKER = '<div class="outer-cell';

const KST_OFFSET = 9 * 3600e3;

/** The handful of entities Takeout emits. */
function decode(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');            // last, so &amp;lt; doesn't become <
}

/**
 * Takeout writes timestamps in the account's own language and clock, e.g.
 * "2026. 8. 14. 오후 8:12:33 KST" or "Aug 14, 2026, 8:12:33 PM KST".
 * Date.parse understands neither of those reliably, so the Korean form is
 * read directly and everything else falls back.
 */
export function parseTakeoutDate(text) {
  const ko = text.match(
    /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})/
  );
  if (ko) {
    const [, y, mo, d, ap, hh, mi, ss] = ko;
    let h = Number(hh) % 12;
    if (ap === '오후') h += 12;
    const ms = Date.UTC(+y, +mo - 1, +d, h, +mi, +ss) - KST_OFFSET;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  // "... 8:12:33 PM KST" — strip the zone word and place it explicitly.
  const kst = /\bKST\b/.test(text);
  const cleaned = text.replace(/\s*\b(KST|UTC|GMT)\b.*$/, '').trim();
  const ms = Date.parse(kst ? `${cleaned} GMT+0900` : cleaned);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parseRecord(chunk, includePlainYouTube) {
  // "YouTube Music" vs plain "YouTube" — the only thing separating a song from
  // every vlog and tutorial the account ever opened.
  const title = chunk.match(/mdl-typography--title">([^<]*)/);
  const label = title ? decode(title[1]).trim() : '';
  if (label !== 'YouTube Music' && !(includePlainYouTube && label === 'YouTube')) {
    return null;
  }

  const body = chunk.match(/mdl-typography--body-1">([\s\S]*?)<\/div>/);
  if (!body) return null;
  const html = body[1];

  const links = [...html.matchAll(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
  const video = links.find((l) => l[1].includes('watch?v='));
  // Deleted and private videos are logged with no link at all.
  if (!video) return null;
  const channel = links.find((l) => /\/channel\/|youtube\.com\/@/.test(l[1]));

  const track = decode(video[2]).trim();
  // Auto-generated music channels are named "ARTIST - Topic".
  const artist = channel ? decode(channel[2]).trim().replace(/\s*-\s*Topic$/i, '') : '';
  if (!track || !artist) return null;

  // The timestamp is the bare text after the final <br>.
  const played_at = parseTakeoutDate(decode(html.split(/<br\s*\/?>/i).pop()).trim());
  if (!played_at) return null;

  return { track, artist, played_at };
}

/**
 * Pull every complete record out of `buffer`, returning what's left over so the
 * caller can prepend the next chunk to it. A record split across a chunk
 * boundary stays in the remainder until the rest of it arrives.
 */
export function consume(buffer, { includePlainYouTube = false } = {}) {
  const parts = buffer.split(MARKER);
  if (parts.length === 1) return { rows: [], remainder: buffer };

  const tail = parts.pop();
  const rows = [];
  // parts[0] is the file preamble on the first pass, '' on later ones.
  for (let i = 1; i < parts.length; i++) {
    const row = parseRecord(parts[i], includePlainYouTube);
    if (row) rows.push(row);
  }
  return { rows, remainder: MARKER + tail };
}

/** The final record has no marker after it, so it needs flushing separately. */
export function flush(remainder, { includePlainYouTube = false } = {}) {
  if (!remainder.startsWith(MARKER)) return [];
  const row = parseRecord(remainder.slice(MARKER.length), includePlainYouTube);
  return row ? [row] : [];
}
