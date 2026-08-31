import { encodePng, type Rgb } from '../lib/png';

/*
 * Placeholder profile content for the demo seed, so the draft board and roster
 * cards have something to show before the real 17 people fill theirs in.
 *
 * Everything is derived deterministically from the player's email, so a reseed
 * produces identical data and screenshots stay comparable. Nothing here is
 * random at call time.
 *
 * This only runs when SEED_FAKE_PROFILES=1 (i.e. `npm run db:demo`). The plain
 * seed leaves profiles empty, because at the actual event a half-filled card
 * with invented stats is worse than an obviously empty one.
 */

/** mulberry32 — small, deterministic, good enough for placeholder data. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

const AVATAR_SIZE = 400;
const GRID = 5;

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x];
  const m = l - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ] as const;
}

/**
 * A symmetric block pattern derived from the seed — the same idea as a GitHub
 * identicon. Mirrored down the middle so it reads as a deliberate mark rather
 * than noise, and distinct enough per person to tell 17 cards apart at a glance.
 */
export function fakeAvatarPng(seed: string): Buffer {
  const hash = hashString(seed);
  const random = seededRandom(hash);

  const hue = Math.floor(random() * 360);
  const ink = hslToRgb(hue, 0.68, 0.42);
  const paper = hslToRgb(hue, 0.35, 0.93);

  // Build the left half plus the centre column, then mirror it.
  const half = Math.ceil(GRID / 2);
  const cells: boolean[][] = [];
  for (let row = 0; row < GRID; row += 1) {
    const left: boolean[] = [];
    for (let col = 0; col < half; col += 1) left.push(random() > 0.45);
    const full = [...left];
    for (let col = GRID - half - 1; col >= 0; col -= 1) full.push(left[col]);
    cells.push(full);
  }

  const cell = AVATAR_SIZE / GRID;
  return encodePng(AVATAR_SIZE, AVATAR_SIZE, (x, y) => {
    const col = Math.min(GRID - 1, Math.floor(x / cell));
    const row = Math.min(GRID - 1, Math.floor(y / cell));
    return cells[row][col] ? ink : paper;
  });
}

/** A team logo: the team colour with a contrasting mark, so it is not a blank square. */
export function fakeTeamLogoPng(seed: string, colorHex: string): Buffer {
  const rgb = hexToRgb(colorHex);
  const random = seededRandom(hashString(seed));
  const stripes = 3 + Math.floor(random() * 4);
  const light: Rgb = [
    Math.min(255, rgb[0] + 90),
    Math.min(255, rgb[1] + 90),
    Math.min(255, rgb[2] + 90),
  ] as const;

  const size = 400;
  return encodePng(size, size, (x, y) => {
    const band = Math.floor(((x + y) / (size * 2)) * stripes * 2) % 2 === 0;
    const inCircle = (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size * 0.42) ** 2;
    if (!inCircle) return [246, 246, 248] as const;
    return band ? rgb : light;
  });
}

function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ] as const;
}

// ---------------------------------------------------------------------------
// Text and ratings
// ---------------------------------------------------------------------------

const HOMETOWNS = ['Somerville', 'Providence', 'Ann Arbor', 'Boise', 'Athens', 'Duluth', 'Tempe', 'Erie'];
const COLLEGES = ['State', 'Tech', 'Community College', 'Nowhere State', 'the School of Hard Knocks'];
const BEVERAGES = ['Cold lager', 'Whatever is closest', 'Hazy IPA', 'Light beer, unashamed', 'Cider', 'Tequila, briefly'];
const CELEBRATIONS = ['The slow clap', 'Silent point at the sky', 'Shirt over the head', 'A single push-up', 'The worm', 'Dead-eyed stare'];
const SONGS = ['Sandstorm', 'Eye of the Tiger', 'Thunderstruck', 'Mr. Brightside', 'Enter Sandman', 'Danza Kuduro'];
const OPENERS = [
  'Deceptively competent.',
  'A physical specimen, allegedly.',
  'Peaks early and often.',
  'Unbeaten in games nobody was scoring.',
  'Brings intensity that the moment rarely calls for.',
  'Has a system. Will explain it.',
];
const CLOSERS = [
  'Claims to have never lost a flip cup anchor leg, loudly and often.',
  'Considers hydration a tactical concession.',
  'Will talk through the entire match and call it strategy.',
  'Best used early, before the wheels come off.',
  'Statistically average, emotionally elite.',
  'Has peaked in a backyard before and intends to again.',
];

export type FakeProfile = {
  nickname: string;
  height: string;
  weight: number;
  hometown: string;
  college: string;
  preferredBeverage: string;
  signatureCelebration: string;
  walkoutSong: string;
  scoutingReport: string;
  personalRecordBeers: number;
  beerPong: number;
  chugging: number;
  flipCup: number;
  endurance: number;
  clutch: number;
  trashTalk: number;
  handEye: number;
  recovery: number;
};

const NICKNAME_FIRST = ['The', 'Big', 'Sir', 'Captain', 'Lil', 'Mad'];
const NICKNAME_SECOND = ['Wall', 'Cannon', 'Professor', 'Freight Train', 'Mongoose', 'Anvil', 'Whisper', 'Tornado'];

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)];
}

/** A rating in 1-100, matching the players_ratings_range check constraint. */
function rating(random: () => number): number {
  return 25 + Math.floor(random() * 75);
}

export function fakeProfile(seed: string): FakeProfile {
  const random = seededRandom(hashString(`profile:${seed}`));

  return {
    nickname: `${pick(random, NICKNAME_FIRST)} ${pick(random, NICKNAME_SECOND)}`,
    height: `${5 + Math.floor(random() * 2)}'${Math.floor(random() * 12)}"`,
    weight: 150 + Math.floor(random() * 90),
    hometown: pick(random, HOMETOWNS),
    college: pick(random, COLLEGES),
    preferredBeverage: pick(random, BEVERAGES),
    signatureCelebration: pick(random, CELEBRATIONS),
    walkoutSong: pick(random, SONGS),
    scoutingReport: `${pick(random, OPENERS)} ${pick(random, CLOSERS)}`,
    personalRecordBeers: 4 + Math.floor(random() * 14),
    beerPong: rating(random),
    chugging: rating(random),
    flipCup: rating(random),
    endurance: rating(random),
    clutch: rating(random),
    trashTalk: rating(random),
    handEye: rating(random),
    recovery: rating(random),
  };
}
