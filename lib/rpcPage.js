import { db } from './db';

/**
 * PostgREST caps any single response at the project's configured max rows,
 * whatever a `p_limit` argument or the lack of one asks for. A single-request
 * `.rpc()` call silently comes back truncated past that cap rather than
 * erroring, which is what once quietly capped every ranked list at ~1,000 no
 * matter how far 펼치기 was pushed, and just as silently truncated things
 * like the previous window's list or a full calendar of days.
 *
 * This pages through with `.range()` in slices safely under any realistic
 * cap, and keeps going until either `want` rows are in hand or a slice comes
 * back short of a full page — the only reliable "nothing more exists"
 * signal, since asking for more than exists just returns what's there.
 */
const RPC_PAGE = 500;
/** Pages fetched at once after the first. Each page re-runs the whole
    function server-side (range is just an offset), so a long list fetched
    one slice at a time pays that cost serially — dozens of times for a
    full listening history. */
const WAVE = 4;

export async function rpcAll(name, params, want) {
  const fetchPage = async (start) => {
    const size = Math.min(RPC_PAGE, want - start);
    const { data, error } = await db.rpc(name, params).range(start, start + size - 1);
    return { size, data: data ?? [], error };
  };

  // Most calls fit in one page, so start with just that one rather than
  // firing a wave of requests that would come back empty.
  const first = await fetchPage(0);
  if (first.error) return { data: null, error: first.error };
  const out = [...first.data];
  if (first.data.length < first.size) return { data: out, error: null };

  let next = RPC_PAGE;
  while (next < want) {
    const starts = [];
    for (let i = 0; i < WAVE && next + i * RPC_PAGE < want; i++) starts.push(next + i * RPC_PAGE);
    const pages = await Promise.all(starts.map(fetchPage));
    for (const pg of pages) {
      if (pg.error) return { data: null, error: pg.error };
      out.push(...pg.data);
      // A short page is the only reliable "nothing more exists" signal.
      if (pg.data.length < pg.size) return { data: out, error: null };
    }
    next += starts.length * RPC_PAGE;
  }
  return { data: out, error: null };
}
