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

export async function rpcAll(name, params, want) {
  const out = [];
  while (out.length < want) {
    const page = Math.min(RPC_PAGE, want - out.length);
    const { data, error } = await db.rpc(name, params).range(out.length, out.length + page - 1);
    if (error) return { data: null, error };
    const got = data ?? [];
    out.push(...got);
    if (got.length < page) break; // short page: truly exhausted, not just paused
  }
  return { data: out, error: null };
}
