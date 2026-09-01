/*
 * Turning "who went out when" into final placements.
 *
 * Shared by the pure replay (lib/engine/replay.ts) and the database path
 * (lib/engine/results.ts), so there is exactly one definition of the ordering
 * rule. Duplicating it would be the ideal way to have brackets and standings
 * quietly disagree.
 *
 * SPEC.md §6.1: placements derive from elimination order — last remaining is
 * 1st, the grand final's loser is 2nd, and so on back down. §6.2 adds that
 * entries knocked out at the same stage are ordered by seed, so placements are
 * a unique 1..N and every rung of points_matrix stays meaningful.
 */

export type Elimination = {
  entryId: string;
  /** How far they got. Higher survived longer, so places better. */
  stage: number;
};

export type Placement = { entryId: string; placement: number };

export function orderPlacements(input: {
  /** Every entry in the game. */
  allEntries: string[];
  eliminations: Elimination[];
  /** Null while the game is unfinished. */
  championEntryId: string | null;
  /** Seed number, 1 = strongest. Used only to break same-stage ties. */
  seedOf: (entryId: string) => number;
}): Placement[] {
  const { allEntries, eliminations, championEntryId, seedOf } = input;

  const stageOf = new Map(eliminations.map((entry) => [entry.entryId, entry.stage]));

  // Anyone still standing outranks everyone knocked out. Usually that is just
  // the champion; on an unfinished bracket it is everyone left in it.
  const survivors = allEntries
    .filter((entryId) => !stageOf.has(entryId))
    .sort((a, b) => seedOf(a) - seedOf(b));

  const knockedOut = [...eliminations]
    .sort((a, b) => b.stage - a.stage || seedOf(a.entryId) - seedOf(b.entryId))
    .map((entry) => entry.entryId);

  const ranked = [...survivors, ...knockedOut];

  // The champion leads, whatever else happened.
  if (championEntryId) {
    const index = ranked.indexOf(championEntryId);
    if (index > 0) {
      ranked.splice(index, 1);
      ranked.unshift(championEntryId);
    }
  }

  return ranked.map((entryId, index) => ({ entryId, placement: index + 1 }));
}
