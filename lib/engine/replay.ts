import type { GeneratedBracket, GeneratedMatch } from './bracket';
import { orderPlacements, type Placement } from './placement';

/*
 * Replays reported results over a generated bracket skeleton.
 *
 * Pure, and always replays from the skeleton rather than mutating state in
 * place. That is what makes undo trivial: drop the last result and replay, and
 * every downstream slot is correct by construction. SPEC.md §6.1 and §8.
 */

export type ReportedResult = {
  matchKey: string;
  /** The entry that won. Must be one of that match's participants. */
  winnerEntryId: string;
};

export type ReplayedMatch = GeneratedMatch & {
  /** Filled in by the replay. */
  resolvedParticipants: (string | null)[];
  /** Dead slots, grown as walkovers and eliminations release downstream slots. */
  resolvedDeadSlots: boolean[];
  winnerEntryId: string | null;
  loserEntryId: string | null;
  /** All slots filled and no result yet — only these belong in the queue. */
  ready: boolean;
  /**
   * Decided without being played: a bye, or a match whose opponent slot can
   * never be filled because everything upstream of it was a bye. Never queued
   * and never awaits a reported result.
   */
  walkover: boolean;
};

export type ReplayState = {
  matches: ReplayedMatch[];
  byKey: Map<string, ReplayedMatch>;
  /** Losses per entry id. */
  losses: Map<string, number>;
  /** Entry ids in the order they were knocked out. Earliest out first. */
  eliminationOrder: string[];
  /**
   * Knock-outs with the stage they happened at. A higher stage means they
   * survived longer, and therefore place better. Entries knocked out at the
   * same stage are separated by seed — see derivePlacements.
   */
  eliminations: { entryId: string; stage: number }[];
  /** Set once the tournament has a winner. */
  championEntryId: string | null;
  /** True when the losers-bracket entry won the grand final. */
  resetActive: boolean;
  complete: boolean;
};

export class ReplayError extends Error {}

export function replay(bracket: GeneratedBracket, results: ReportedResult[]): ReplayState {
  const matches: ReplayedMatch[] = bracket.matches.map((match) => ({
    ...match,
    participants: [...match.participants],
    resolvedParticipants: [...match.participants],
    resolvedDeadSlots: [...match.deadSlots],
    winnerEntryId: match.autoCompleted ? match.autoWinner : null,
    loserEntryId: null,
    ready: false,
    walkover: match.autoCompleted,
  }));

  const byKey = new Map(matches.map((match) => [match.key, match]));
  const losses = new Map<string, number>();
  const eliminationOrder: string[] = [];
  const eliminations: { entryId: string; stage: number }[] = [];
  const knockOut = (entryId: string, stage: number) => {
    eliminationOrder.push(entryId);
    eliminations.push({ entryId, stage });
  };
  let resetActive = false;

  // Settled after each result, not just at the end: one result can walk
  // somebody over into the very match the next result is for. Generation has
  // already settled the round-1 byes, so there is nothing to do before the
  // first result.
  for (const result of results) {
    const match = byKey.get(result.matchKey);
    if (!match) throw new ReplayError(`no match ${result.matchKey}`);
    if (match.walkover) {
      throw new ReplayError(`${result.matchKey} was decided by a bye`);
    }
    if (match.winnerEntryId) {
      throw new ReplayError(`${result.matchKey} already has a result`);
    }

    const present = match.resolvedParticipants.filter((id): id is string => id !== null);
    if (present.length < 2) {
      throw new ReplayError(`${result.matchKey} is not ready — ${present.length} participant(s)`);
    }
    if (!present.includes(result.winnerEntryId)) {
      throw new ReplayError(`${result.winnerEntryId} is not in ${result.matchKey}`);
    }

    const loser = present.find((id) => id !== result.winnerEntryId)!;
    match.winnerEntryId = result.winnerEntryId;
    match.loserEntryId = loser;

    losses.set(loser, (losses.get(loser) ?? 0) + 1);

    // Route the winner onward.
    write(byKey, match.winnerTo, result.winnerEntryId);

    // Route the loser, or knock them out.
    if (match.loserTo.matchKey !== null) {
      write(byKey, match.loserTo, loser);
    } else if (match.bracket === 'GRAND_FINAL' && !match.isReset) {
      // The grand final's loser is only out if the winners-bracket entry won.
      // Otherwise both sides hold one loss and the reset decides it — a
      // condition a static pointer cannot express, so it lives here.
      const winnerCameFromWinners = match.resolvedParticipants[0] === result.winnerEntryId;
      if (winnerCameFromWinners) {
        knockOut(loser, eliminationStage(bracket, match));
      } else {
        resetActive = true;
        const reset = matches.find((candidate) => candidate.isReset);
        if (reset) {
          reset.resolvedParticipants[0] = match.resolvedParticipants[0];
          reset.resolvedParticipants[1] = match.resolvedParticipants[1];
        }
      }
    } else {
      knockOut(loser, eliminationStage(bracket, match));
    }

    settleWalkovers(matches);
  }

  // Readiness: SPEC.md §6.1 — a match is ready when all its slots are filled.
  for (const match of matches) {
    const filled = match.resolvedParticipants.filter((id) => id !== null).length;
    const isInactiveReset = Boolean(match.isReset) && !resetActive;
    match.ready = !match.walkover && !match.winnerEntryId && filled === 2 && !isInactiveReset;
  }

  const { championEntryId, complete } = findChampion(bracket, matches, resetActive);

  return {
    matches,
    byKey,
    losses,
    eliminationOrder,
    eliminations,
    championEntryId,
    resetActive,
    complete,
  };
}

/**
 * Walks entries over matches that can never be played.
 *
 * A bye can leave a downstream match with one real participant and one slot
 * whose every feeder was itself a bye. That match is not "waiting" — nobody is
 * coming — so the entry advances and the match never enters the queue
 * (SPEC.md §6.1). It cascades, so this repeats until nothing changes.
 */
function settleWalkovers(matches: ReplayedMatch[]): void {
  const byKey = new Map(matches.map((match) => [match.key, match]));

  // A feeder is spent once its match is decided, whether played or walked over.
  const pending = new Map<string, number>();
  for (const match of matches) {
    const decided = match.walkover || match.winnerEntryId !== null;
    if (decided) continue;
    for (const target of [match.winnerTo, match.loserTo]) {
      if (!target.matchKey || target.slot === null) continue;
      const slotKey = `${target.matchKey}#${target.slot}`;
      pending.set(slotKey, (pending.get(slotKey) ?? 0) + 1);
    }
  }

  let changed = true;
  let guard = 0;

  while (changed) {
    changed = false;
    guard += 1;
    if (guard > matches.length + 2) throw new ReplayError('settleWalkovers: did not converge');

    for (const match of matches) {
      if (match.walkover || match.winnerEntryId !== null) continue;
      // The grand final is never walked over: its slot 1 always has a feeder,
      // and the reset is activated explicitly rather than by propagation.
      if (match.bracket === 'GRAND_FINAL') continue;

      const holes = match.resolvedParticipants
        .map((participant, slot) => ({ participant, slot }))
        .filter(({ participant }) => participant === null);

      const stillComing = holes.some(
        ({ slot }) => (pending.get(`${match.key}#${slot}`) ?? 0) > 0,
      );
      if (stillComing) continue;

      for (const { slot } of holes) match.resolvedDeadSlots[slot] = true;

      const present = match.resolvedParticipants.filter((id): id is string => id !== null);
      if (present.length > 1) continue; // playable, leave it alone

      match.walkover = true;
      match.winnerEntryId = present[0] ?? null;

      for (const target of [match.winnerTo, match.loserTo]) {
        if (!target.matchKey || target.slot === null) continue;
        const slotKey = `${target.matchKey}#${target.slot}`;
        pending.set(slotKey, Math.max(0, (pending.get(slotKey) ?? 0) - 1));
      }

      if (match.winnerEntryId) {
        const target = match.winnerTo;
        if (target.matchKey && target.slot !== null) {
          const downstream = byKey.get(target.matchKey);
          if (downstream) downstream.resolvedParticipants[target.slot] = match.winnerEntryId;
        }
      }

      changed = true;
    }
  }
}

/**
 * How far an entry got before being knocked out. Bigger is better.
 *
 * Single elimination: the winners round they lost in. Double elimination:
 * losers-bracket rounds stack above the winners bracket, because surviving to
 * a later losers round means surviving longer. The grand final and its reset
 * sit above every losers round.
 */
function eliminationStage(bracket: GeneratedBracket, match: GeneratedMatch): number {
  if (bracket.kind === 'SINGLE') return match.round;

  if (match.bracket === 'LOSERS') return match.round;
  if (match.bracket === 'GRAND_FINAL') {
    return bracket.losersRounds + (match.isReset ? 2 : 1);
  }
  // A winners-bracket loss is never an elimination in double elimination.
  return 0;
}

function write(
  byKey: Map<string, ReplayedMatch>,
  target: { matchKey: string | null; slot: number | null },
  entryId: string,
): void {
  if (!target.matchKey || target.slot === null) return;
  const match = byKey.get(target.matchKey);
  if (!match) throw new ReplayError(`advancement points at missing match ${target.matchKey}`);
  match.resolvedParticipants[target.slot] = entryId;
}

function findChampion(
  bracket: GeneratedBracket,
  matches: ReplayedMatch[],
  resetActive: boolean,
): { championEntryId: string | null; complete: boolean } {
  if (bracket.kind === 'SINGLE') {
    const final = matches.find(
      (match) => match.bracket === 'WINNERS' && match.round === bracket.winnersRounds,
    );
    const winner = final?.winnerEntryId ?? null;
    return { championEntryId: winner, complete: winner !== null };
  }

  const reset = matches.find((match) => match.isReset);
  const grandFinal = matches.find(
    (match) => match.bracket === 'GRAND_FINAL' && !match.isReset,
  );

  if (resetActive) {
    const winner = reset?.winnerEntryId ?? null;
    return { championEntryId: winner, complete: winner !== null };
  }

  const winner = grandFinal?.winnerEntryId ?? null;
  return { championEntryId: winner, complete: winner !== null };
}

/**
 * Final placements, 1st first. SPEC.md §6.1: placements derive from elimination
 * order — last remaining is 1st, the grand final's loser is 2nd, and so on back
 * down through the losers bracket. §6.2 says the same for single elimination by
 * elimination round.
 *
 * Entries knocked out at the same stage are ordered by seed, so placements are
 * a unique 1..N and every rung of `points_matrix` stays meaningful.
 */
export function derivePlacements(
  bracket: GeneratedBracket,
  state: ReplayState,
): Placement[] {
  return orderPlacements({
    allEntries: bracket.slots.filter((id): id is string => id !== null),
    eliminations: state.eliminations,
    championEntryId: state.championEntryId,
    // Seed number, not slot index — those differ, and using the slot index here
    // ranked co-eliminated entries by bracket position instead of by strength.
    seedOf: (entryId) => bracket.seedByEntry[entryId] ?? Number.MAX_SAFE_INTEGER,
  });
}

/** Matches that should be in the queue right now. SPEC.md §7.1. */
export function readyMatches(state: ReplayState): ReplayedMatch[] {
  return state.matches.filter((match) => match.ready);
}
