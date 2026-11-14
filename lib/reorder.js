/**
 * The arithmetic of a playlist reorder, kept apart from Spotify and the model
 * so it can be checked on its own.
 */

/** Two tempos apart, counting half or double time as the same pulse (85 and 170 run together). */
export function tempoGap(a, b) {
  if (a == null || b == null) return null;
  return Math.min(Math.abs(a - b), Math.abs(a - 2 * b), Math.abs(2 * a - b));
}

/**
 * How smoothly an order runs: the average tempo jump (BPM) and energy jump
 * (0-100) between neighbours, over the pairs that have numbers.
 */
export function smoothness(seq) {
  let bpm = 0;
  let nb = 0;
  let energy = 0;
  let ne = 0;
  for (let i = 1; i < seq.length; i += 1) {
    const g = tempoGap(seq[i - 1]?.tempo, seq[i]?.tempo);
    if (g != null) { bpm += g; nb += 1; }
    if (seq[i - 1]?.energy != null && seq[i]?.energy != null) {
      energy += Math.abs(seq[i - 1].energy - seq[i].energy) * 100;
      ne += 1;
    }
  }
  return { bpm: nb ? Math.round(bpm / nb) : null, energy: ne ? Math.round(energy / ne) : null };
}

/** Each entry made unique by how many times it has come up already: a song in twice is two places. */
export const tagged = (uris) => {
  const seen = new Map();
  return uris.map((u) => {
    const n = seen.get(u) ?? 0;
    seen.set(u, n + 1);
    return `${u}#${n}`;
  });
};

/**
 * The order to aim for, fitted to the playlist as it is now: entries asked
 * for that are no longer there are dropped, entries there that weren't asked
 * for (added since) keep their order at the end.
 */
export function fitTarget(current, target) {
  const left = new Map();
  for (const k of current) left.set(k, (left.get(k) ?? 0) + 1);
  const out = [];
  for (const k of target) {
    if (left.get(k) > 0) { out.push(k); left.set(k, left.get(k) - 1); }
  }
  for (const k of current) {
    if (left.get(k) > 0) { out.push(k); left.set(k, left.get(k) - 1); }
  }
  return out;
}

/**
 * Moves that turn `current` into `target`, front to back: at each place
 * still wrong, the entry that belongs there is lifted from further down and
 * put in, along with any run of entries after it that stays together.
 * Spotify's reorder takes exactly this (range_start, range_length,
 * insert_before), and moving entries rather than replacing the list keeps
 * each one's "added" date.
 */
export function movesFor(current, target) {
  const cur = [...current];
  const moves = [];
  for (let i = 0; i < target.length; i += 1) {
    if (cur[i] === target[i]) continue;
    const j = cur.indexOf(target[i], i + 1);
    if (j < 0) continue;
    // the entries after it that follow it in the new order too go along in the same call
    let len = 1;
    while (i + len < target.length && j + len < cur.length && cur[j + len] === target[i + len]) len += 1;
    moves.push({ from: j, to: i, len });
    const block = cur.splice(j, len);
    cur.splice(i, 0, ...block);
    i += len - 1;
  }
  return moves;
}

/** An answer's order made whole: each index once, unknown ones dropped, the missing appended in their old order. */
export function wholeOrder(order, n) {
  const seen = new Set();
  const out = [];
  for (const raw of order ?? []) {
    const i = Number(raw);
    if (Number.isInteger(i) && i >= 0 && i < n && !seen.has(i)) { seen.add(i); out.push(i); }
  }
  for (let i = 0; i < n; i += 1) if (!seen.has(i)) out.push(i);
  return out;
}

/**
 * Several lists woven into one, `per` entries at a time, each list spread
 * evenly over the whole: one with twice the entries comes round twice as
 * often, so a big group isn't left piled up at the end. Two turns of the
 * same list are kept apart wherever another list can go between them.
 */
export function interleave(lists, per = 1) {
  const units = [];
  lists.forEach((list, g) => {
    const chunks = [];
    for (let k = 0; k < list.length; k += per) chunks.push(list.slice(k, k + per));
    chunks.forEach((c, j) => units.push({ c, at: (j + 0.5) / chunks.length, g }));
  });
  units.sort((a, b) => a.at - b.at || a.g - b.g);
  for (let k = 1; k < units.length; k += 1) {
    if (units[k].g !== units[k - 1].g) continue;
    const swap = units.findIndex((u, m) => m > k && u.g !== units[k - 1].g);
    if (swap > 0) [units[k], units[swap]] = [units[swap], units[k]];
  }
  return units.flatMap((u) => u.c);
}

/**
 * interleave, with play counts in the mix too: the groups take their turns as
 * before, and each turn alternates between a song played more than most in
 * the playlist and one played less — a favourite from one group, then a
 * lesser-heard one from the next, and so on. `isHot` says which is which.
 */
export function interleaveMixed(lists, per = 1, isHot = null) {
  if (!isHot) return interleave(lists, per);
  // whose turn each place is: the same weaving, done on the group numbers
  const turns = interleave(lists.map((l, g) => l.map(() => g)), per);
  const hot = lists.map((l) => l.filter(isHot));
  const cold = lists.map((l) => l.filter((x) => !isHot(x)));
  const out = [];
  let lastHot = false;
  for (const g of turns) {
    const want = !lastHot;
    const q = want ? (hot[g].length ? hot[g] : cold[g]) : (cold[g].length ? cold[g] : hot[g]);
    const x = q.shift();
    out.push(x);
    lastHot = isHot(x);
  }
  return out;
}
