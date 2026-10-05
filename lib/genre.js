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
 * Each family's sector of the color wheel, as an OKLCH hue. Nine sectors with
 * clear gaps between them, so two genres never read as the same color —
 * pop red, hip-hop orange, R&B/jazz gold, folk/latin green, indie teal,
 * electronic sky, rock/metal blue, J-pop/Asian/OST violet, K-pop pink.
 * Closely related genres share a sector rather than sitting a hair apart.
 */
const SECTORS = {
  pop: 22, hiphop: 55, rnb: 88, jazz: 88, folk: 140, latin: 140, indie: 178,
  electronic: 218, rock: 258, metal: 258, classical: 298, jpop: 298, asian: 298,
  kpop: 342,
};
/** How far an artist's hue may sit from their sector's centre, either way. */
const SPREAD = 9;
/** Lightness and chroma steps: all mid-to-bright, so no artist's color goes
    dark against the dark theme or washes out against the light one. OKLCH
    keeps them equally bright whatever the hue — a blue and a yellow at one
    lightness really do look equally light. */
const LIGHTNESS = [0.64, 0.68, 0.72, 0.76];
const CHROMA = [0.13, 0.16, 0.19];

/** Families learned so far, by artist name — filled by whoever looked them up. */
const families = new Map();

export function rememberFamily(artist, family) {
  if (artist && family) families.set(artist, family);
}

/**
 * The color for one artist: a stable shade within their genre's sector —
 * hue, lightness and chroma all varied by name, so artists of one genre look
 * related but tell apart, and two tracks by one artist always match. An
 * artist whose genre isn't known (yet, or at all) takes a hue from anywhere
 * on the wheel at the same brightness, rather than a placeholder grey.
 */
export function artistColor(name) {
  const h = hash(String(name ?? ''));
  const centre = SECTORS[families.get(name)];
  const hue = centre == null
    ? h % 360
    : (centre - SPREAD + (h % (2 * SPREAD + 1)) + 360) % 360;
  const l = LIGHTNESS[(h >>> 9) % LIGHTNESS.length];
  const c = CHROMA[(h >>> 17) % CHROMA.length];
  return `oklch(${l} ${c} ${hue})`;
}

