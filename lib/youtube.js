/**
 * Parser for Google Takeout's YouTube watch history.
 *
 * Takeout hands this out as HTML, not JSON, and a heavy account's file runs to
 * hundreds of megabytes — far too big to hand to DOMParser. The markup is
 * machine-generated and regular enough to scan as text in streamed chunks, so
 * it never has to be held in memory whole.
 *
 * The markup is matched loosely on purpose. Takeout's class names, wrapper
 * depth and phrasing all vary by export version and account language — the
 * Korean export reads "…을(를) 시청했습니다." with the title first — so this
 * looks for the things that are actually stable: a watch link, a channel
 * link, and a timestamp somewhere in the same record.
 *
 * What the format cannot tell us matters as much as what it can: there is no
 * play duration anywhere in it. Rows come out with ms_played 0 and the ranking
 * counts them by play instead, rather than inventing a listening time.
 */

/** Each entry begins with this; splitting on it isolates one record. */
const MARKER = '<div class="outer-cell';

const KST_OFFSET = 9 * 3600e3;

const KO_DATE = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})/;
const EN_DATE = /\b([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM))/;

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

/** Link text can carry nested markup; only the words matter. */
const textOf = (html) => decode(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

/**
 * Takeout writes timestamps in the account's own language and clock, e.g.
 * "2026. 5. 19. 오후 9:09:24 KST" or "May 19, 2026, 9:09:24 PM KST".
 * Date.parse handles neither reliably, so the Korean form is read directly.
 *
 * Searches anywhere in the record rather than trusting a fixed position —
 * the timestamp's placement relative to <br> tags is not stable.
 */
export function findTimestamp(text) {
  const ko = text.match(KO_DATE);
  if (ko) {
    const [, y, mo, d, ap, hh, mi, ss] = ko;
    let h = Number(hh) % 12;
    if (ap === '오후') h += 12;
    const ms = Date.UTC(+y, +mo - 1, +d, h, +mi, +ss) - KST_OFFSET;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  const en = text.match(EN_DATE);
  if (en) {
    const ms = Date.parse(/\bKST\b/.test(text) ? `${en[1]} GMT+0900` : en[1]);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

/** Kept for callers that pass just the timestamp string. */
export const parseTakeoutDate = findTimestamp;

/**
 * "YouTube Music" or plain "YouTube". Every record also carries a "제품:
 * YouTube" caption, so this reads the heading and falls back to the text
 * ahead of the first link rather than scanning the whole cell.
 */
function productOf(chunk) {
  const heading = chunk.match(/mdl-typography--title[^>]*>\s*([^<]{1,40})/);
  if (heading) {
    const label = decode(heading[1]).trim();
    if (label) return label;
  }
  const firstLink = chunk.indexOf('<a');
  const head = firstLink > 0 ? chunk.slice(0, firstLink) : chunk.slice(0, 400);
  if (/YouTube\s*Music/i.test(head)) return 'YouTube Music';
  if (/YouTube/i.test(head)) return 'YouTube';
  return '';
}

/**
 * @returns a row, or a string naming the stage that rejected it — the import
 *   screen reports those counts when nothing parses, so a format change says
 *   where it broke instead of just "found nothing".
 */
function parseRecord(chunk, includePlainYouTube) {
  const product = productOf(chunk);
  const isMusic = /^YouTube\s*Music$/i.test(product);
  if (!isMusic && !(includePlainYouTube && /^YouTube$/i.test(product))) return 'product';

  const links = [...chunk.matchAll(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
  const video = links.find((l) => /watch\?v=|youtu\.be\//.test(l[1]));
  // Deleted and private videos are logged with no link at all.
  if (!video) return 'nolink';

  const channel = links.find((l) => /\/channel\/|youtube\.com\/@|\/user\/|\/c\//.test(l[1]));
  const track = textOf(video[2]);
  // Auto-generated music channels are named "ARTIST - Topic".
  const artist = channel ? textOf(channel[2]).replace(/\s*-\s*Topic$/i, '').trim() : '';
  if (!track || !artist) return 'noname';

  const played_at = findTimestamp(chunk);
  if (!played_at) return 'nodate';

  return { track, artist, played_at };
}

const blankStats = () => ({ cells: 0, product: 0, nolink: 0, noname: 0, nodate: 0, ok: 0 });

function run(chunks, includePlainYouTube, stats) {
  const rows = [];
  for (const chunk of chunks) {
    stats.cells++;
    const got = parseRecord(chunk, includePlainYouTube);
    if (typeof got === 'string') stats[got]++;
    else { rows.push(got); stats.ok++; }
  }
  return rows;
}

/**
 * Pull every complete record out of `buffer`, returning what's left over so the
 * caller can prepend the next chunk to it. A record split across a chunk
 * boundary stays in the remainder until the rest of it arrives.
 */
export function consume(buffer, { includePlainYouTube = false, stats = blankStats() } = {}) {
  const parts = buffer.split(MARKER);
  if (parts.length === 1) return { rows: [], remainder: buffer, stats };

  const tail = parts.pop();
  // parts[0] is the file preamble on the first pass, '' on later ones.
  const rows = run(parts.slice(1), includePlainYouTube, stats);
  return { rows, remainder: MARKER + tail, stats };
}

/** The final record has no marker after it, so it needs flushing separately. */
export function flush(remainder, { includePlainYouTube = false, stats = blankStats() } = {}) {
  if (!remainder.startsWith(MARKER)) return [];
  return run([remainder.slice(MARKER.length)], includePlainYouTube, stats);
}

export { blankStats };

/* ---------------- JSON export ----------------
   Takeout offers the same history as JSON, and it is worth reading because it
   is the one remaining place a repeat might survive that the HTML drops. The
   records are cleaner too: `time` is a real ISO instant rather than a phrase
   in the account's language.

   The title still arrives wrapped in that language — "Watched Bloom" or
   "Bloom을(를) 시청했습니다." — so the wrapper is stripped rather than parsed. */

const WATCHED_PATTERNS = [
  /^Watched\s+/,
  /을\(를\)\s*시청했습니다\.?$/,
  /를\s*시청했습니다\.?$/,
  /\s*시청했습니다\.?$/,
];

function stripWatched(title) {
  let t = String(title ?? '').trim();
  for (const re of WATCHED_PATTERNS) t = t.replace(re, '');
  return t.trim();
}

/**
 * @param entries parsed watch-history.json
 * @returns { rows, stats } in the same shape the HTML path produces, so the
 *   import screen can report either without special-casing.
 */
export function parseJson(entries, { includePlainYouTube = false } = {}) {
  const stats = blankStats();
  const rows = [];

  for (const e of Array.isArray(entries) ? entries : []) {
    stats.cells++;

    const product = String(e?.header ?? '').trim();
    const isMusic = /^YouTube\s*Music$/i.test(product);
    if (!isMusic && !(includePlainYouTube && /^YouTube$/i.test(product))) {
      stats.product++;
      continue;
    }
    // Deleted and private videos keep a title but lose the link.
    if (!e?.titleUrl) { stats.nolink++; continue; }

    const track = stripWatched(e.title);
    // Auto-generated music channels are named "ARTIST - Topic".
    const artist = String(e?.subtitles?.[0]?.name ?? '')
      .replace(/\s*-\s*Topic$/i, '').trim();
    if (!track || !artist) { stats.noname++; continue; }

    const ms = Date.parse(e.time);
    if (!Number.isFinite(ms)) { stats.nodate++; continue; }

    rows.push({ track, artist, played_at: new Date(ms).toISOString() });
    stats.ok++;
  }

  return { rows, stats };
}
