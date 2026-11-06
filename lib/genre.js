/**
 * Genre classification, and a separate color for each artist.
 *
 * Genre names arrive from whichever source answered — MusicBrainz's
 * community tags ("k-pop", "city pop", "hyperpop") or, when it has nothing,
 * Deezer's coarser album buckets ("Rap/Hip Hop", "Asian Music"). Both get
 * folded into one small set of families here, so the label shown next to a
 * row ("NewJeans · K-POP") reads the same regardless of which source
 * answered for it.
 *
 * The family also decides which part of the color wheel an artist's color
 * comes from — see artistColor below.
 */

/** Genre family → its Korean label. */
const FAMILIES = {
  rock:       '록',
  jpop:       'J-POP',
  hiphop:     '힙합 · 랩',
  jazz:       '재즈 · 블루스',
  folk:       '포크 · 컨트리',
  latin:      '라틴 · 월드',
  electronic: '일렉트로닉',
  indie:      '인디',
  classical:  '클래식 · OST',
  metal:      '메탈',
  pop:        '팝',
  rnb:        'R&B · 소울',
  kpop:       'K-POP',
  asian:      '아시아 음악',
  other:      '장르 미확인',
};

/**
 * First match wins, so the order is the ruling: "k-pop" must be read as K-pop
 * before "pop" claims it, and "pop rock" as rock. The specific sits above the
 * general throughout.
 *
 * The vocabulary covers both what Deezer files albums under and the finer
 * strings other sources use, so a genre name does not have to be Deezer's to
 * land somewhere sensible.
 */
const RULES = [
  [/k-?pop|korean|k-?indie|k-?rap|trot/, 'kpop'],
  [/j-?pop|j-?rock|japanese|anime|city pop|visual kei/, 'jpop'],
  [/rap|hip ?hop|trap|drill|grime|boom bap/, 'hiphop'],
  [/r&b|rnb|soul|funk|motown|disco/, 'rnb'],
  [/metal|metalcore|hardcore|grindcore|djent/, 'metal'],
  [/punk|rock|grunge|shoegaze|britpop|emo|alternative/, 'rock'],
  [/edm|house|techno|trance|dubstep|electro|dance|drum and bass|synthwave|ambient|idm/, 'electronic'],
  [/jazz|bossa|swing|bebop|blues|ragtime/, 'jazz'],
  [/classical|orchestra|baroque|opera|choral|soundtrack|score|films?\/games|piano/, 'classical'],
  [/folk|country|americana|bluegrass|singer-songwriter/, 'folk'],
  [/latin|reggaeton|salsa|samba|cumbia|bachata|flamenco|tango|reggae|dancehall|afrobeat|african|brazilian|indian|world/, 'latin'],
  [/indie|lo-?fi|bedroom|dream pop|art pop|chamber pop/, 'indie'],
  [/pop/, 'pop'],
  // Deezer files most of East Asia here, so it sits below the specific
  // K-pop and J-pop rules and catches whatever they didn't.
  [/asian/, 'asian'],
];

/**
 * Fold a list of genre names down to one family and one label.
 *
 * The list arrives ordered by how strongly it applies, so the first entry that
 * maps to a family wins. A genre that misses every rule keeps its own name as a
 * label but falls to the neutral family — better than guessing a hue from a
 * string nobody recognises.
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

export function familyLabel(family) {
  return FAMILIES[family] ?? FAMILIES.other;
}

export const FAMILY_KEYS = Object.keys(FAMILIES);

/**
 * Nine shades — [hue offset, lightness, chroma] — built so any two differ in
 * at least two of the three. Lightness stays mid-to-bright throughout.
 */
const SHADES = [
  [-10, 0.71, 0.155], [0, 0.78, 0.19], [10, 0.64, 0.12],
  [-10, 0.78, 0.12], [0, 0.64, 0.155], [10, 0.71, 0.19],
  [0, 0.71, 0.12], [10, 0.78, 0.155], [-10, 0.64, 0.19],
];

/**
 * The color for one artist, from their name alone: a hue anywhere on the
 * wheel and one of the nine shades, so artists sit clearly apart and an
 * artist's color never changes. Genre doesn't move it — pulling a genre's
 * artists into one sector made, say, every K-pop act the same pink, and the
 * spread-out colors read better. Genre stays a label (familyLabel).
 */
export function artistColor(name) {
  const h = hash(String(name ?? ''));
  const [, l, c] = SHADES[h % SHADES.length];
  return `oklch(${l} ${c} ${h % 360})`;
}

