/**
 * Genre → color.
 *
 * Spotify's genres are very fine-grained ("korean r&b", "chicago drill",
 * "alternative dance"), which is useful as a label and useless as a color key:
 * a listener's top 50 can easily hold forty distinct strings. So each one is
 * folded into a family, and the family fixes the hue. Two K-pop tracks come out
 * two neighbouring pinks; a rock track is unmistakably elsewhere on the wheel.
 *
 * Within a family, only lightness and a few degrees of hue move, seeded off the
 * artist's name. That keeps rows in the same family recognisably related while
 * still telling them apart, and it is stable — an artist keeps its shade across
 * reloads, periods and charts.
 */

/** Hue per family, spaced far enough apart to stay distinct side by side. */
const FAMILIES = {
  rock:       { label: '록',            hue: 2,   sat: 66 },
  jpop:       { label: 'J-POP',         hue: 20,  sat: 74 },
  hiphop:     { label: '힙합 · 랩',      hue: 38,  sat: 78 },
  jazz:       { label: '재즈 · 블루스',   hue: 52,  sat: 68 },
  folk:       { label: '포크 · 컨트리',   hue: 96,  sat: 44 },
  latin:      { label: '라틴 · 레게',     hue: 132, sat: 50 },
  electronic: { label: '일렉트로닉',      hue: 172, sat: 60 },
  indie:      { label: '인디',           hue: 198, sat: 60 },
  classical:  { label: '클래식 · OST',    hue: 222, sat: 42 },
  metal:      { label: '메탈',           hue: 236, sat: 20 },
  pop:        { label: '팝',             hue: 268, sat: 60 },
  rnb:        { label: 'R&B · 소울',     hue: 300, sat: 54 },
  kpop:       { label: 'K-POP',          hue: 332, sat: 72 },
  other:      { label: '장르 미확인',     hue: 258, sat: 5  },
};

/**
 * First match wins, so the order is the ruling: "k-pop" must be read as K-pop
 * before "pop" claims it, and "pop rock" as rock. The specific sits above the
 * general throughout.
 */
const RULES = [
  [/k-?pop|korean|k-?indie|k-?rap|trot/, 'kpop'],
  [/j-?pop|j-?rock|japanese|anime|city pop|visual kei/, 'jpop'],
  [/rap|hip ?hop|trap|drill|grime|boom bap/, 'hiphop'],
  [/r&b|rnb|soul|funk|motown|disco/, 'rnb'],
  [/metal|metalcore|hardcore|grindcore|djent/, 'metal'],
  [/punk|rock|grunge|shoegaze|britpop|emo/, 'rock'],
  [/edm|house|techno|trance|dubstep|electro|dance|drum and bass|synthwave|ambient|idm/, 'electronic'],
  [/jazz|bossa|swing|bebop|blues|ragtime/, 'jazz'],
  [/classical|orchestra|baroque|opera|choral|soundtrack|score|piano/, 'classical'],
  [/folk|country|americana|bluegrass|singer-songwriter/, 'folk'],
  [/latin|reggaeton|salsa|samba|cumbia|bachata|flamenco|tango|reggae|dancehall|afrobeat/, 'latin'],
  [/indie|lo-?fi|bedroom|dream pop|art pop|chamber pop/, 'indie'],
  [/pop/, 'pop'],
];

/**
 * Fold Spotify's genre list down to one family and one label.
 *
 * The list arrives ordered by how strongly it applies, so the first entry that
 * maps to a family wins. An artist with genres that all miss the rules keeps
 * its first genre as a label but falls to the neutral family — better than
 * guessing a hue from a string nobody recognises.
 */
export function familyOfGenres(genres) {
  const list = (genres ?? []).filter(Boolean);
  for (const g of list) {
    const lower = g.toLowerCase();
    for (const [re, family] of RULES) {
      if (re.test(lower)) return { family, genre: g };
    }
  }
  return { family: 'other', genre: list[0] ?? null };
}

/** Stable 32-bit hash (FNV-1a), so a name always seeds the same shade. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The color for one row. Lightness stays in a band that holds up against both
 * the light and the dark background, so nothing needs a per-theme override.
 */
export function genreColor(family, seed = '') {
  const f = FAMILIES[family] ?? FAMILIES.other;
  const h = hash(String(seed));
  const hue = f.hue + ((h >> 3) % 13) - 6;
  const sat = f.sat + ((h >> 9) % 9);
  const light = 48 + ((h >> 15) % 14);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

/** The flat family color, for legends and chips where no row is in play. */
export function familyColor(family) {
  const f = FAMILIES[family] ?? FAMILIES.other;
  return `hsl(${f.hue} ${f.sat}% 54%)`;
}

export function familyLabel(family) {
  return (FAMILIES[family] ?? FAMILIES.other).label;
}

export const FAMILY_KEYS = Object.keys(FAMILIES);
