/**
 * Ranking shared between the client (the list's own rank column) and the
 * season API route (Grand Prix points) — one definition, so "tied" means the
 * same thing in both places.
 */

/**
 * Standard competition ranking: rows tied by `tie(a, b)` share one rank
 * number, and the rank after a tied group skips ahead by how many shared it
 * (1, 1, 3 — not 1, 1, 2), which is how a tie reads on an actual chart.
 * `rows` must already be sorted so a genuine tie's members sit next to each
 * other — `computeRanks` and `computeRanksBy` differ only in how strict a
 * "tie" is, not in this rule.
 */
function ranksBy(rows, tie) {
  const ranks = [];
  for (let i = 0; i < rows.length; i++) {
    ranks.push(i > 0 && tie(rows[i], rows[i - 1]) ? ranks[i - 1] : i + 1);
  }
  return ranks;
}

/** Ties on the single field `key` alone — what the ranked list uses, where
    two rows with the same play count are a real dead heat and read the
    same rank ("공동"). */
export function computeRanks(rows, key) {
  return ranksBy(rows, (a, b) => Number(a[key]) === Number(b[key]));
}

/**
 * Ties only when every one of `keys` matches — what the season standings use.
 * A plain equal play count isn't treated as a dead heat there: rows must
 * also share the same `last_at`, so whichever one reached that count later
 * sorts ahead and gets the better (not shared) rank. Practically the same
 * total heard on the same day at different times still resolves to a real
 * finishing order instead of both taking the top step.
 */
export function computeRanksBy(rows, keys) {
  return ranksBy(rows, (a, b) => keys.every((k) => a[k] === b[k]));
}

/** The FIA's own scale: 1st through 10th, nothing below. */
export const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

/** Points for a given (tie-aware) rank, 0 past 10th. A tie for a scoring
    position pays both rows that position's points rather than splitting or
    averaging them — consistent with how a tie already reads everywhere else
    in this app: the same rank means the same result. */
export function pointsForRank(rank) {
  return rank >= 1 && rank <= 10 ? F1_POINTS[rank - 1] : 0;
}

/**
 * How a Grand Prix (or a plain month) actually finished: sorted by play
 * count, ties broken by recency — reaching the same total later places
 * ahead of reaching it earlier, the way a photo finish still has a winner.
 * Only a genuinely identical last play leaves two rows sharing a rank.
 * Shared by the season route and its month-detail endpoint so a race's
 * result means the same thing wherever it's read.
 */
export function rankByPlays(rows) {
  const sorted = [...rows].sort((a, b) =>
    Number(b.plays) - Number(a.plays) || new Date(b.last_at) - new Date(a.last_at));
  const ranks = computeRanksBy(sorted, ['plays', 'last_at']);
  return { rows: sorted, ranks };
}

/**
 * One result's points shared between the artists credited on it, for the
 * constructors' standings: equal whole-point shares, any remainder going to
 * the main artist (listed first) — 25 between two is 13 and 12, between
 * three 9, 8 and 8. The result pays out the same total however many share it.
 */
export function splitPoints(points, n) {
  if (n <= 1) return [points];
  const base = Math.floor(points / n);
  const shares = Array(n).fill(base);
  shares[0] += points - base * n;
  return shares;
}
