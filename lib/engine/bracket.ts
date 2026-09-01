import {
  assignBracketSlots,
  bracketSize,
  findSameTeamRoundOneClash,
  seedSlotOrder,
  type SeedableEntry,
} from './seeding';

/*
 * Elimination bracket generation. SPEC.md §6.1 (double) and §6.2 (single).
 *
 * The whole skeleton is built up front — every winners match, every losers
 * match, the grand final, and the grand-final reset — with every advancement
 * pointer wired at generation time. Reporting a result is then "write the
 * entry into the target slot" and undo is "clear the target slots". The bracket
 * shape is never re-derived, which is what makes undo safe.
 *
 * Pure: no database, no ids from outside. Matches are identified by a stable
 * key (bracket/round/slot) that the persistence layer maps to uuids.
 */

export type BracketKind = 'SINGLE' | 'DOUBLE';

export type MatchBracket = 'WINNERS' | 'LOSERS' | 'GRAND_FINAL';

/** Where a result goes. Null target means the entry is out of the tournament. */
export type Advancement = {
  matchKey: string | null;
  slot: number | null;
};

export type GeneratedMatch = {
  /** `WINNERS-1-0` style. Stable, so tests and persistence can refer to it. */
  key: string;
  bracket: MatchBracket;
  round: number;
  slot: number;
  /** Entry ids, or null for a slot waiting on an upstream result or a bye. */
  participants: (string | null)[];
  winnerTo: Advancement;
  loserTo: Advancement;
  /**
   * True when generation could already settle this match: a bye, or a match
   * whose only possible participants were byes. It never enters the queue.
   */
  autoCompleted: boolean;
  /** For an auto-completed match, who advanced. Null when nobody did. */
  autoWinner: string | null;
  /**
   * Slots that can never be filled, because every feeder that could have
   * delivered somebody was itself a bye or an empty match. Replay uses this to
   * walk an entry over when its opponent's slot is dead — without it, such a
   * match waits forever for a second participant that is not coming.
   */
  deadSlots: boolean[];
  /**
   * The grand-final reset. Only used if the losers-bracket entry wins the
   * grand final, so it is generated but stays inactive otherwise.
   */
  isReset?: boolean;
};

export type GeneratedBracket = {
  kind: BracketKind;
  entryCount: number;
  size: number;
  byes: number;
  winnersRounds: number;
  losersRounds: number;
  matches: GeneratedMatch[];
  /** Slot order, for rendering and for tests. Null entries are byes. */
  slots: (string | null)[];
  /**
   * Seed number per entry id, 1 = strongest.
   *
   * Carried explicitly because a slot index is NOT a seed — slot order is the
   * standard bracket arrangement, so slot 1 holds the weakest seed, not the
   * second strongest. Anything that needs to rank entries wants this.
   */
  seedByEntry: Record<string, number>;
  /** Set when the shape made SPEC.md §6.1 separation impossible. */
  sameTeamRoundOneClash: boolean;
};

function key(bracket: MatchBracket, round: number, slot: number, reset = false): string {
  return `${bracket}-${round}-${slot}${reset ? '-RESET' : ''}`;
}

const NOWHERE: Advancement = { matchKey: null, slot: null };

/**
 * Number of matches in each losers-bracket round.
 *
 * For a bracket of size B with W winners rounds, the losers bracket has
 * 2*(W-1) rounds. Rounds come in pairs: a "minor" round where losers-bracket
 * survivors play each other, then a "major" round where each survivor meets a
 * fresh dropdown from the winners bracket. Both rounds of pair k hold
 * B / 2^(k+1) matches.
 */
export function losersRoundSizes(size: number): number[] {
  const winnersRounds = Math.log2(size);
  const sizes: number[] = [];
  for (let k = 1; k <= winnersRounds - 1; k += 1) {
    const count = size / 2 ** (k + 1);
    sizes.push(count, count);
  }
  return sizes;
}

export function generateBracket(
  entries: SeedableEntry[],
  kind: BracketKind,
): GeneratedBracket {
  // Double elimination needs a losers bracket to exist. At two entries there is
  // none — the format degenerates into "first to two wins", which is not what
  // this generator models. Beer pong is 8 and flip cup is 4, so this only rules
  // out a shape the event will not use.
  if (kind === 'DOUBLE' && entries.length < 3) {
    throw new Error(
      `generateBracket: DOUBLE needs at least 3 entries, got ${entries.length}`,
    );
  }

  const size = bracketSize(entries.length);
  if (size < 2) {
    return {
      kind,
      entryCount: entries.length,
      size,
      byes: Math.max(0, size - entries.length),
      winnersRounds: 0,
      losersRounds: 0,
      matches: [],
      slots: entries.map((entry) => entry.id),
      seedByEntry: Object.fromEntries(entries.map((entry, index) => [entry.id, index + 1])),
      sameTeamRoundOneClash: false,
    };
  }

  const placed = assignBracketSlots(entries);
  const clash = findSameTeamRoundOneClash(placed);
  const slots = placed.map((entry) => entry?.id ?? null);

  const seedOrder = seedSlotOrder(size);
  const seedByEntry: Record<string, number> = {};
  placed.forEach((entry, slot) => {
    if (entry) seedByEntry[entry.id] = seedOrder[slot];
  });

  const winnersRounds = Math.log2(size);
  const loserSizes = kind === 'DOUBLE' ? losersRoundSizes(size) : [];
  const matches: GeneratedMatch[] = [];

  // ---- winners bracket ----
  for (let round = 1; round <= winnersRounds; round += 1) {
    const count = size / 2 ** round;
    for (let slot = 0; slot < count; slot += 1) {
      const isFinal = round === winnersRounds;

      const winnerTo: Advancement = isFinal
        ? kind === 'DOUBLE'
          ? { matchKey: key('GRAND_FINAL', 1, 0), slot: 0 }
          : NOWHERE
        : { matchKey: key('WINNERS', round + 1, Math.floor(slot / 2)), slot: slot % 2 };

      matches.push({
        key: key('WINNERS', round, slot),
        bracket: 'WINNERS',
        round,
        slot,
        participants:
          round === 1 ? [slots[slot * 2] ?? null, slots[slot * 2 + 1] ?? null] : [null, null],
        winnerTo,
        loserTo: kind === 'DOUBLE' ? winnersLoserTarget(round, slot, size, loserSizes) : NOWHERE,
        autoCompleted: false,
        autoWinner: null,
        deadSlots: [false, false],
      });
    }
  }

  // ---- losers bracket ----
  loserSizes.forEach((count, index) => {
    const round = index + 1;
    const isMinor = round % 2 === 1;
    const isLast = round === loserSizes.length;

    for (let slot = 0; slot < count; slot += 1) {
      let winnerTo: Advancement;
      if (isLast) {
        winnerTo = { matchKey: key('GRAND_FINAL', 1, 0), slot: 1 };
      } else if (isMinor) {
        // A minor round's winner meets a winners-bracket dropdown in the next
        // round, always in slot 0. The dropdown takes slot 1.
        winnerTo = { matchKey: key('LOSERS', round + 1, slot), slot: 0 };
      } else {
        // A major round's winner plays another survivor in the next minor round.
        winnerTo = { matchKey: key('LOSERS', round + 1, Math.floor(slot / 2)), slot: slot % 2 };
      }

      matches.push({
        key: key('LOSERS', round, slot),
        bracket: 'LOSERS',
        round,
        slot,
        participants: [null, null],
        winnerTo,
        // A second loss ends it. This is what makes it double elimination.
        loserTo: NOWHERE,
        autoCompleted: false,
        autoWinner: null,
        deadSlots: [false, false],
      });
    }
  });

  // ---- grand final and reset ----
  if (kind === 'DOUBLE') {
    matches.push({
      key: key('GRAND_FINAL', 1, 0),
      bracket: 'GRAND_FINAL',
      round: 1,
      slot: 0,
      participants: [null, null],
      // Slot 0 is the winners-bracket entry, slot 1 the losers-bracket entry.
      // If slot 1 wins, both have one loss and the reset decides it.
      winnerTo: NOWHERE,
      loserTo: NOWHERE,
      autoCompleted: false,
      autoWinner: null,
      deadSlots: [false, false],
    });

    matches.push({
      key: key('GRAND_FINAL', 2, 0, true),
      bracket: 'GRAND_FINAL',
      round: 2,
      slot: 0,
      participants: [null, null],
      winnerTo: NOWHERE,
      loserTo: NOWHERE,
      autoCompleted: false,
      autoWinner: null,
      deadSlots: [false, false],
      isReset: true,
    });
  }

  settleByes(matches);

  return {
    kind,
    entryCount: entries.length,
    size,
    byes: size - entries.length,
    winnersRounds,
    losersRounds: loserSizes.length,
    matches,
    slots,
    seedByEntry,
    sameTeamRoundOneClash: clash !== null,
  };
}

/**
 * Where a winners-bracket loser drops to.
 *
 * Round 1 losers fill the first losers round two-by-two. Later rounds each drop
 * one-for-one into the major losers round that pairs with them: winners round r
 * drops into losers round 2*(r-1). The winners final's loser goes to the last
 * losers round.
 *
 * Winners rounds from 2 on have their dropdowns reversed, so an entry arriving
 * from the winners bracket does not immediately meet the entry it just beat.
 * Round 1 needs no such treatment: matches 2k and 2k+1 always feed the same
 * losers match whichever way round they are numbered, so reversing there only
 * relabels which losers match is which.
 */
function winnersLoserTarget(
  round: number,
  slot: number,
  size: number,
  loserSizes: number[],
): Advancement {
  if (loserSizes.length === 0) return NOWHERE;

  if (round === 1) {
    return { matchKey: key('LOSERS', 1, Math.floor(slot / 2)), slot: slot % 2 };
  }

  const targetRound = 2 * (round - 1);
  if (targetRound > loserSizes.length) return NOWHERE;

  const count = loserSizes[targetRound - 1];
  // Reverse so a dropdown does not immediately meet the entry it just beat.
  const target = count - 1 - (slot % count);
  return { matchKey: key('LOSERS', targetRound, target), slot: 1 };
}

/**
 * Resolves byes, and the empty matches they cascade into, at generation time.
 *
 * A bye auto-completes and the entry advances immediately, so no match appears
 * in the queue (SPEC.md §6.1). With enough byes a losers-bracket match can end
 * up with one participant or none at all, so this repeats until nothing more
 * can be settled rather than assuming a single pass is enough.
 */
function settleByes(matches: GeneratedMatch[]): void {
  const byKey = new Map(matches.map((match) => [match.key, match]));

  // Which slots can still receive somebody, i.e. have a live feeder.
  const feeders = new Map<string, number>();
  for (const match of matches) {
    for (const advancement of [match.winnerTo, match.loserTo]) {
      if (!advancement.matchKey || advancement.slot === null) continue;
      const slotKey = `${advancement.matchKey}#${advancement.slot}`;
      feeders.set(slotKey, (feeders.get(slotKey) ?? 0) + 1);
    }
  }

  let changed = true;
  let guard = 0;

  while (changed) {
    changed = false;
    guard += 1;
    if (guard > matches.length + 2) {
      throw new Error('settleByes: did not converge');
    }

    for (const match of matches) {
      if (match.autoCompleted) continue;
      if (match.bracket === 'GRAND_FINAL') continue; // never auto-resolved

      const present = match.participants.filter((id): id is string => id !== null);

      const waiting = match.participants.some((participant, slot) => {
        if (participant !== null) return false;
        return (feeders.get(`${match.key}#${slot}`) ?? 0) > 0;
      });

      if (waiting) continue;

      // Nobody else is coming. One participant walks through; none means the
      // match never happens and nothing advances out of it.
      if (present.length === 1) {
        match.autoCompleted = true;
        match.autoWinner = present[0];
        advance(byKey, feeders, match.winnerTo, present[0]);
        release(feeders, match.loserTo);
        changed = true;
      } else if (present.length === 0) {
        match.autoCompleted = true;
        match.autoWinner = null;
        release(feeders, match.winnerTo);
        release(feeders, match.loserTo);
        changed = true;
      }
    }
  }

  // Whatever is still empty with no feeder left can never be filled. Replay
  // needs this to walk an entry over rather than wait for a ghost.
  for (const match of matches) {
    match.deadSlots = match.participants.map(
      (participant, slot) => participant === null && (feeders.get(`${match.key}#${slot}`) ?? 0) === 0,
    );
  }
}

function advance(
  byKey: Map<string, GeneratedMatch>,
  feeders: Map<string, number>,
  target: Advancement,
  entryId: string,
): void {
  release(feeders, target);
  if (!target.matchKey || target.slot === null) return;
  const match = byKey.get(target.matchKey);
  if (match) match.participants[target.slot] = entryId;
}

/** Marks a downstream slot as no longer expecting anybody from this feeder. */
function release(feeders: Map<string, number>, target: Advancement): void {
  if (!target.matchKey || target.slot === null) return;
  const slotKey = `${target.matchKey}#${target.slot}`;
  const remaining = (feeders.get(slotKey) ?? 0) - 1;
  feeders.set(slotKey, Math.max(0, remaining));
}
