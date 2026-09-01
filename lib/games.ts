/*
 * Game configuration parsing. SPEC.md §4.3 and §6.5.
 *
 * Pure, so the admin form's validation is testable without a request. The
 * points matrix is the part worth being careful about: it decides what every
 * game is worth, and SPEC.md §6.5 is explicit that there is no format-based
 * weighting — a game is worth whatever its matrix says.
 */

export const GAME_FORMATS = ['DOUBLE_ELIM', 'SINGLE_ELIM', 'ROUND_ROBIN', 'RANKED_FFA'] as const;
export type GameFormat = (typeof GAME_FORMATS)[number];

export const ENTRY_AGGREGATIONS = ['SUM', 'BEST'] as const;
export type EntryAggregation = (typeof ENTRY_AGGREGATIONS)[number];

export const FORMAT_LABELS: Record<GameFormat, string> = {
  DOUBLE_ELIM: 'Double elimination',
  SINGLE_ELIM: 'Single elimination',
  ROUND_ROBIN: 'Round robin',
  RANKED_FFA: 'Ranked free-for-all',
};

/** Highest placement a points matrix may define. 4 teams x 2 entries is 8. */
export const MAX_PLACEMENTS = 16;

export type PointsMatrix = Record<string, number>;

export type ParsedPointsMatrix =
  | { ok: true; matrix: PointsMatrix }
  | { ok: false; error: string };

/**
 * Parses "100, 70, 50, 30" into `{"1":100,"2":70,"3":50,"4":30}` — points for
 * 1st place first.
 *
 * A list rather than one field per placement because the number of placements
 * depends on the entry count, and typing four numbers on a phone beats
 * fourteen inputs.
 */
export function parsePointsMatrix(input: string): ParsedPointsMatrix {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, error: 'Enter the points for each placement.' };

  const parts = trimmed
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (parts.length === 0) return { ok: false, error: 'Enter the points for each placement.' };
  if (parts.length > MAX_PLACEMENTS) {
    return { ok: false, error: `That is more than ${MAX_PLACEMENTS} placements.` };
  }

  const matrix: PointsMatrix = {};
  for (const [index, part] of parts.entries()) {
    if (!/^-?\d+$/.test(part)) {
      return { ok: false, error: `"${part}" is not a whole number.` };
    }
    const value = Number(part);
    if (value < 0) return { ok: false, error: 'Points cannot be negative.' };
    if (value > 100_000) return { ok: false, error: 'That is an implausible number of points.' };
    matrix[String(index + 1)] = value;
  }

  // 1st place paying less than 2nd is almost always a typo, and it would
  // quietly invert the standings for that game.
  for (let placement = 1; placement < parts.length; placement += 1) {
    const better = matrix[String(placement)];
    const worse = matrix[String(placement + 1)];
    if (worse > better) {
      return {
        ok: false,
        error: `Placement ${placement + 1} pays more than placement ${placement}. Highest first.`,
      };
    }
  }

  return { ok: true, matrix };
}

/** Renders a stored matrix back into the form's text field. */
export function formatPointsMatrix(matrix: unknown): string {
  if (!matrix || typeof matrix !== 'object') return '';
  const entries = Object.entries(matrix as Record<string, unknown>)
    .map(([placement, points]) => [Number(placement), Number(points)] as const)
    .filter(([placement, points]) => Number.isFinite(placement) && Number.isFinite(points))
    .sort((a, b) => a[0] - b[0]);
  return entries.map(([, points]) => String(points)).join(', ');
}

/** Points for a placement, 0 if the matrix does not go that deep. */
export function pointsForPlacement(matrix: unknown, placement: number): number {
  if (!matrix || typeof matrix !== 'object') return 0;
  const value = (matrix as Record<string, unknown>)[String(placement)];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Round robin scores by wins, so it needs points_per_win and ignores
 * points_matrix. Every other format is the other way round. SPEC.md §6.3.
 */
export function scoresByWins(format: GameFormat): boolean {
  return format === 'ROUND_ROBIN';
}

export type ParsedGame = {
  name: string;
  format: GameFormat;
  entriesPerTeam: number;
  entrySize: number | null;
  pointsMatrix: PointsMatrix;
  pointsPerWin: number | null;
  entryAggregation: EntryAggregation;
  scheduledDay: number | null;
  station: string | null;
  sortOrder: number;
  spansMultipleDays: boolean;
  rules: string | null;
};

export type ParsedGameResult = { ok: true; game: ParsedGame } | { ok: false; errors: string[] };

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

export function parseGameForm(form: FormData): ParsedGameResult {
  const errors: string[] = [];

  const name = text(form, 'name');
  if (!name) errors.push('A game needs a name.');
  if (name && name.length > 80) errors.push('That name is too long.');

  const format = String(form.get('format') ?? '');
  if (!GAME_FORMATS.includes(format as GameFormat)) errors.push('Pick a format.');

  const aggregation = String(form.get('entryAggregation') ?? 'SUM');
  if (!ENTRY_AGGREGATIONS.includes(aggregation as EntryAggregation)) {
    errors.push('Pick how multiple entries combine.');
  }

  const entriesPerTeam = integer(form, 'entriesPerTeam', 'Entries per team', 1, 8, errors) ?? 1;
  const entrySize = integer(form, 'entrySize', 'Players per entry', 1, 17, errors);
  const scheduledDay = integer(form, 'scheduledDay', 'Day', 1, 3, errors);
  const sortOrder = integer(form, 'sortOrder', 'Order', 0, 999, errors) ?? 0;

  /*
   * Which scoring field is required depends on the format, so a round robin is
   * not rejected for lacking a placement matrix it will never use, and a
   * bracket is not accepted with nothing to pay out.
   */
  const winScoring = GAME_FORMATS.includes(format as GameFormat)
    ? scoresByWins(format as GameFormat)
    : false;

  let pointsPerWin: number | null = null;
  let matrix: PointsMatrix = {};

  if (winScoring) {
    pointsPerWin = integer(form, 'pointsPerWin', 'Points per win', 0, 100_000, errors);
    if (pointsPerWin === null) {
      errors.push('A round robin needs points per win — it scores by wins, not placement.');
    }
  } else {
    const parsed = parsePointsMatrix(String(form.get('pointsMatrix') ?? ''));
    if (parsed.ok) matrix = parsed.matrix;
    else errors.push(parsed.error);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    game: {
      name: name!,
      format: format as GameFormat,
      entriesPerTeam,
      entrySize,
      pointsMatrix: matrix,
      pointsPerWin,
      entryAggregation: aggregation as EntryAggregation,
      scheduledDay,
      station: text(form, 'station'),
      sortOrder,
      spansMultipleDays: form.get('spansMultipleDays') === 'on',
      rules: text(form, 'rules'),
    },
  };
}
