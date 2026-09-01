/*
 * Bracket seeding. SPEC.md §6.1.
 *
 * Two jobs:
 *   1. Standard bracket order, so seed 1 and seed 2 can only meet in the final.
 *   2. Two entries from the same team must not meet in round 1. With 8 entries
 *      from 4 teams that means each team's pair lands in opposite halves.
 *
 * Pure. No database, no randomness — the same input always produces the same
 * bracket, which is what makes it testable and what makes a regenerated bracket
 * identical to the one people were looking at.
 */

export type SeedableEntry = {
  id: string;
  teamId: string;
  /** Optional pre-assigned seed. Entries without one are ordered as given. */
  seed?: number | null;
};

/** The next power of two at or above n. Bracket size. */
export function bracketSize(entryCount: number): number {
  if (entryCount < 1) return 0;
  let size = 1;
  while (size < entryCount) size *= 2;
  return size;
}

/**
 * Standard single-elimination seed order for a bracket of the given size.
 *
 * Returns seed numbers (1-indexed) in slot order, so slots 0 and 1 are the first
 * round-1 match. For size 8: [1, 8, 5, 4, 3, 6, 7, 2] — the usual arrangement
 * where 1 and 2 are at opposite ends.
 */
export function seedSlotOrder(size: number): number[] {
  if (size < 1) return [];
  let order = [1];
  while (order.length < size) {
    const round = order.length * 2;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed, round + 1 - seed);
    }
    order = next;
  }

  // Cheap invariant, kept in production. Everything downstream assumes the
  // order is a permutation of 1..size; if it is not, generation produces a
  // bracket with duplicate or missing seeds, which shows up much later as a
  // bracket that cannot be played rather than as an obvious error here.
  const seen = new Set(order);
  if (seen.size !== size || order.some((seed) => seed < 1 || seed > size)) {
    throw new Error(`seedSlotOrder(${size}) produced a bad order: ${order.join(',')}`);
  }

  return order;
}

/**
 * Places entries into bracket slots so that, as far as the shape allows:
 *   - a team's entries land in opposite halves (SPEC.md §6.1), and
 *   - no round-1 match contains two entries from the same team.
 *
 * Works by assigning seed numbers 1..N and then mapping them through the
 * standard slot order. That indirection is what makes byes correct for free:
 * the missing seeds are always the weakest ones, and in a standard bracket the
 * weakest seeds sit opposite the strongest, so the top seeds are the ones who
 * get a walkover — exactly what SPEC.md §6.1 asks for.
 *
 * Deterministic: the same entries always produce the same bracket.
 */
export function assignBracketSlots(entries: SeedableEntry[]): (SeedableEntry | null)[] {
  const size = bracketSize(entries.length);
  if (size === 0) return [];

  const slotOrder = seedSlotOrder(size);

  // An explicit, complete seeding is the admin's call and is used as given.
  if (entries.length > 0 && entries.every((entry) => typeof entry.seed === 'number')) {
    const bySeed = [...entries].sort((a, b) => (a.seed as number) - (b.seed as number));
    return slotOrder.map((seed) => bySeed[seed - 1] ?? null);
  }

  const half = size / 2;

  /*
   * Seeds actually handed out are exactly 1..N, so the seeds left over are
   * always N+1..size — the weakest. In a standard bracket those sit opposite
   * the strongest, so the byes land on the top seeds with no special casing.
   *
   * Restricting the pool first is what makes that true. Choosing freely from
   * all `size` seeds to balance the halves would leave a middling seed unused
   * and hand the bye to the wrong entry.
   */
  const seedsByHalf: number[][] = [[], []];
  slotOrder.forEach((seed, slot) => {
    if (seed > entries.length) return;
    seedsByHalf[slot < half ? 0 : 1].push(seed);
  });
  for (const list of seedsByHalf) list.sort((a, b) => a - b);

  // Biggest teams first so their entries get the widest spread. Ties broken by
  // team id so Map iteration order cannot change the result.
  const byTeam = new Map<string, SeedableEntry[]>();
  for (const entry of entries) {
    const bucket = byTeam.get(entry.teamId);
    if (bucket) bucket.push(entry);
    else byTeam.set(entry.teamId, [entry]);
  }
  const groups = [...byTeam.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([, group]) => group);

  const taken = [0, 0];
  const seedOfEntry = new Map<string, number>();

  for (const group of groups) {
    // Start on whichever half has more room, so the halves stay balanced even
    // when every team has a single entry. Then alternate, which puts a team's
    // two entries in opposite halves — the beer pong case.
    let side = seedsByHalf[0].length - taken[0] >= seedsByHalf[1].length - taken[1] ? 0 : 1;

    for (const entry of group) {
      let placed = false;
      for (let attempt = 0; attempt < 2 && !placed; attempt += 1) {
        if (taken[side] < seedsByHalf[side].length) {
          seedOfEntry.set(entry.id, seedsByHalf[side][taken[side]]);
          taken[side] += 1;
          placed = true;
        }
        side = side === 0 ? 1 : 0;
      }
      if (!placed) throw new Error('assignBracketSlots: ran out of seeds');
    }
  }

  const entryOfSeed = new Map<number, SeedableEntry>();
  for (const entry of entries) {
    const seed = seedOfEntry.get(entry.id);
    if (seed !== undefined) entryOfSeed.set(seed, entry);
  }

  const slots = slotOrder.map((seed) => entryOfSeed.get(seed) ?? null);
  repairRoundOneClashes(slots);
  return slots;
}

/**
 * Swaps entries between round-1 matches until no match holds two entries from
 * the same team, or no swap can help.
 *
 * Needed only for lopsided shapes — a team with three or more entries in an
 * eight-slot bracket cannot be spread by halves alone. Bounded and
 * deterministic: it scans matches in order and takes the first swap that
 * removes a clash without creating one.
 */
function repairRoundOneClashes(slots: (SeedableEntry | null)[]): void {
  const matchCount = Math.floor(slots.length / 2);

  for (let m = 0; m < matchCount; m += 1) {
    const a = slots[m * 2];
    const b = slots[m * 2 + 1];
    if (!a || !b || a.teamId !== b.teamId) continue;

    for (let other = 0; other < matchCount; other += 1) {
      if (other === m) continue;

      for (const offset of [0, 1]) {
        const candidateSlot = other * 2 + offset;
        const candidate = slots[candidateSlot];
        if (!candidate || candidate.teamId === a.teamId) continue;

        // Would the swap leave the other match clean?
        const partner = slots[other * 2 + (offset === 0 ? 1 : 0)];
        if (partner && partner.teamId === b.teamId) continue;

        slots[m * 2 + 1] = candidate;
        slots[candidateSlot] = b;
        break;
      }

      const nowA = slots[m * 2];
      const nowB = slots[m * 2 + 1];
      if (!nowA || !nowB || nowA.teamId !== nowB.teamId) break;
    }
  }
}

/**
 * Checks the SPEC.md §6.1 rule directly against a finished slot assignment:
 * no round-1 match may contain two entries from the same team.
 *
 * Exists as a function rather than only a test so generation can assert it.
 */
export function findSameTeamRoundOneClash(
  slots: (SeedableEntry | null)[],
): { slotA: number; slotB: number; teamId: string } | null {
  for (let i = 0; i + 1 < slots.length; i += 2) {
    const a = slots[i];
    const b = slots[i + 1];
    if (a && b && a.teamId === b.teamId) {
      return { slotA: i, slotB: i + 1, teamId: a.teamId };
    }
  }
  return null;
}
