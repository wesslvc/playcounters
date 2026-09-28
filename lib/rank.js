/**
 * Ranking shared between the client (the list's own rank column) and the
 * season API route (Grand Prix points) — one definition, so "tied" means the
 * same thing in both places.
 */

/**
 * Standard competition ranking: rows tied on the sort value share one rank
 * number, and the rank after a tied group skips ahead by how many shared it
 * (1, 1, 3 — not 1, 1, 2), which is how a tie reads on an actual chart.
 * `rows` must already be sorted by `key` descending.
 */
export function computeRanks(rows, key) {
  const ranks = [];
  for (let i = 0; i < rows.length; i++) {
    ranks.push(
      i > 0 && Number(rows[i][key]) === Number(rows[i - 1][key])
        ? ranks[i - 1]
        : i + 1
    );
  }
  return ranks;
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
