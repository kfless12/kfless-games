/*
 * The shape of a player profile form, in one place so the form, the save
 * handler, and the card renderer cannot disagree about the field list.
 *
 * Everything here is self-entered and, per SPEC.md §4.1, decorative: the
 * scouting ratings must never feed scoring, seeding, or matchmaking.
 */

export const RATING_FIELDS = [
  { key: 'beerPong', label: 'Beer pong' },
  { key: 'chugging', label: 'Chugging' },
  { key: 'flipCup', label: 'Flip cup' },
  { key: 'endurance', label: 'Endurance' },
  { key: 'clutch', label: 'Clutch' },
  { key: 'trashTalk', label: 'Trash talk' },
  { key: 'handEye', label: 'Hand-eye' },
  { key: 'recovery', label: 'Recovery' },
] as const;

export type RatingKey = (typeof RATING_FIELDS)[number]['key'];

export const TEXT_FIELDS = [
  { key: 'nickname', label: 'Nickname', placeholder: 'What people actually call you' },
  { key: 'height', label: 'Height', placeholder: `6'1"` },
  { key: 'hometown', label: 'Hometown', placeholder: '' },
  { key: 'college', label: 'College', placeholder: '' },
  { key: 'preferredBeverage', label: 'Preferred beverage', placeholder: '' },
  { key: 'signatureCelebration', label: 'Signature celebration', placeholder: '' },
  { key: 'walkoutSong', label: 'Walkout song', placeholder: '' },
] as const;

export type TextKey = (typeof TEXT_FIELDS)[number]['key'];

export const RATING_MIN = 1;
export const RATING_MAX = 100;

export type ProfileValues = {
  nickname: string | null;
  height: string | null;
  weight: number | null;
  hometown: string | null;
  college: string | null;
  preferredBeverage: string | null;
  signatureCelebration: string | null;
  walkoutSong: string | null;
  scoutingReport: string | null;
  personalRecordBeers: number | null;
} & { [K in RatingKey]: number | null };

export type ParsedProfile = { ok: true; values: ProfileValues } | { ok: false; errors: string[] };

/** Blank means "not answered", which is different from zero. */
function text(form: FormData, key: string): string | null {
  const raw = form.get(key);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function integer(
  form: FormData,
  key: string,
  label: string,
  min: number,
  max: number,
  errors: string[],
): number | null {
  const raw = text(form, key);
  if (raw === null) return null;

  if (!/^-?\d+$/.test(raw)) {
    errors.push(`${label} needs to be a whole number.`);
    return null;
  }

  const value = Number(raw);
  if (value < min || value > max) {
    errors.push(`${label} has to be between ${min} and ${max}.`);
    return null;
  }
  return value;
}

/**
 * Parses and validates a profile form. Mirrors the database check constraints
 * on the ratings so a bad value produces a readable message rather than a
 * Postgres error.
 */
export function parseProfileForm(form: FormData): ParsedProfile {
  const errors: string[] = [];

  const ratings = Object.fromEntries(
    RATING_FIELDS.map(({ key, label }) => [
      key,
      integer(form, key, label, RATING_MIN, RATING_MAX, errors),
    ]),
  ) as { [K in RatingKey]: number | null };

  const values: ProfileValues = {
    nickname: text(form, 'nickname'),
    height: text(form, 'height'),
    weight: integer(form, 'weight', 'Weight', 1, 1000, errors),
    hometown: text(form, 'hometown'),
    college: text(form, 'college'),
    preferredBeverage: text(form, 'preferredBeverage'),
    signatureCelebration: text(form, 'signatureCelebration'),
    walkoutSong: text(form, 'walkoutSong'),
    scoutingReport: text(form, 'scoutingReport'),
    personalRecordBeers: integer(form, 'personalRecordBeers', 'Personal record', 0, 1000, errors),
    ...ratings,
  };

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, values };
}
