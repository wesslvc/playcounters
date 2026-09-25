/**
 * One color system, used everywhere something is ranked: the position badge,
 * the count meter, the podium, and the trend chart's lines. Before this, each
 * of those picked colors on its own (the meter keyed off rank, the span strip
 * keyed off density, the trend chart keyed off chart order) and the same hue
 * ended up meaning three different things depending on which element you were
 * looking at. Rank position is now the single key, everywhere.
 *
 * The first three are the podium colors (gold / silver / bronze) so P1–P3
 * read the same in the list, the podium, and the chart legend. Past third,
 * the qualitative set below extends it far enough for a top-10 trend.
 */
export const RANK_COLORS = [
  '#FFC53D', // P1 — gold
  '#C9CDD6', // P2 — silver
  '#E8A672', // P3 — bronze
  '#4B3BFF', // indigo
  '#00A08C', // teal
  '#8B5CF6', // violet
  '#F0A202', // amber
  '#3FA7D6', // sky
  '#FF5C93', // pink
  '#5FBB63', // green
];

export function colorForRank(i) {
  return RANK_COLORS[i % RANK_COLORS.length];
}

export function isPodium(i) {
  return i < 3;
}
