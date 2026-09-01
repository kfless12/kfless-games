/*
 * Ranked free-for-all. SPEC.md §6.4.
 *
 * All entries compete at once in a single heat. The admin assigns placement
 * 1..N directly, so there is nothing to derive from match results — the only
 * work here is validating that what the admin submitted is a real ordering.
 *
 * `rawScore` (a time, a count) is carried alongside and displayed, but never
 * used for ordering. SPEC.md §6.4 is explicit about that.
 */

export type FfaEntryResult = {
  entryId: string;
  placement: number;
  rawScore?: number | null;
};

export type FfaValidation =
  | { ok: true; placements: { entryId: string; placement: number }[] }
  | { ok: false; errors: string[] };

/** One heat holding every entry. */
export function generateFfaHeat(entryIds: string[]): {
  key: string;
  round: number;
  slot: number;
  participants: string[];
} | null {
  if (entryIds.length === 0) return null;
  return { key: 'HEAT-1-0', round: 1, slot: 0, participants: [...entryIds] };
}

/**
 * Checks the admin's ordering is a permutation of 1..N over exactly the entries
 * in the game — no gaps, no duplicates, nobody missing, nobody invented.
 */
export function validateFfaPlacements(
  entryIds: string[],
  submitted: FfaEntryResult[],
): FfaValidation {
  const errors: string[] = [];
  const expected = new Set(entryIds);

  const seenEntries = new Set<string>();
  for (const row of submitted) {
    if (!expected.has(row.entryId)) errors.push(`${row.entryId} is not in this game`);
    if (seenEntries.has(row.entryId)) errors.push(`${row.entryId} appears twice`);
    seenEntries.add(row.entryId);
  }

  for (const entryId of entryIds) {
    if (!seenEntries.has(entryId)) errors.push(`${entryId} has no placement`);
  }

  const placements = submitted.map((row) => row.placement).sort((a, b) => a - b);
  const wanted = Array.from({ length: entryIds.length }, (_, i) => i + 1);
  if (placements.join(',') !== wanted.join(',')) {
    errors.push(`placements must be exactly 1..${entryIds.length}, got ${placements.join(',')}`);
  }

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };

  return {
    ok: true,
    placements: [...submitted]
      .sort((a, b) => a.placement - b.placement)
      .map((row) => ({ entryId: row.entryId, placement: row.placement })),
  };
}
