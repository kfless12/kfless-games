/*
 * Snake draft order. SPEC.md §1.1 and §5.2.
 *
 * Pure and database-free so it can be tested directly. The counts are
 * parameters rather than constants because SPEC.md §1 says team and player
 * counts are read from the database — correctness at 4 teams and 13 picks is
 * what matters, but nothing here hardcodes it.
 *
 * At 4 teams and 13 picks:
 *
 *   Round 1  picks  1- 4   order 1 -> 4
 *   Round 2  picks  5- 8   order 4 -> 1
 *   Round 3  picks  9-12   order 1 -> 4
 *   Round 4  pick  13      order 4 -> 1   (only one pick occurs)
 *
 * So pick 13 belongs to the captain who picked 4th in round one, and that team
 * ends with 5 players. SPEC.md §1.1 is explicit that this is intentional and
 * must not be "fixed".
 */

export type DraftSlot = {
  /** 1-indexed overall pick number. */
  pickNumber: number;
  /** 1-indexed round. */
  round: number;
  /** 1-indexed position within the round, in pick order. */
  indexInRound: number;
  /** The team's `draft_position`, 1..teamCount. */
  draftPosition: number;
};

/**
 * Which draft position owns a given pick number.
 *
 * Odd rounds run forwards (1 -> teamCount), even rounds backwards.
 */
export function slotForPick(pickNumber: number, teamCount: number): DraftSlot {
  if (!Number.isInteger(pickNumber) || pickNumber < 1) {
    throw new Error(`slotForPick: pickNumber must be a positive integer, got ${pickNumber}`);
  }
  if (!Number.isInteger(teamCount) || teamCount < 1) {
    throw new Error(`slotForPick: teamCount must be a positive integer, got ${teamCount}`);
  }

  const zeroBased = pickNumber - 1;
  const round = Math.floor(zeroBased / teamCount) + 1;
  const indexInRound = (zeroBased % teamCount) + 1;
  const forwards = round % 2 === 1;
  const draftPosition = forwards ? indexInRound : teamCount - indexInRound + 1;

  return { pickNumber, round, indexInRound, draftPosition };
}

/** Every slot in the draft, in order. */
export function draftOrder(totalPicks: number, teamCount: number): DraftSlot[] {
  if (!Number.isInteger(totalPicks) || totalPicks < 0) {
    throw new Error(`draftOrder: totalPicks must be a non-negative integer, got ${totalPicks}`);
  }
  return Array.from({ length: totalPicks }, (_, i) => slotForPick(i + 1, teamCount));
}

/** How many picks each draft position gets. Index 0 is position 1. */
export function picksPerPosition(totalPicks: number, teamCount: number): number[] {
  const counts = new Array<number>(teamCount).fill(0);
  for (const slot of draftOrder(totalPicks, teamCount)) {
    counts[slot.draftPosition - 1] += 1;
  }
  return counts;
}

/**
 * The slot that is on the clock given how many picks have already been made,
 * or null when the draft is finished.
 */
export function currentSlot(
  picksMade: number,
  totalPicks: number,
  teamCount: number,
): DraftSlot | null {
  if (picksMade >= totalPicks) return null;
  return slotForPick(picksMade + 1, teamCount);
}

/** The next few slots after the one on the clock. SPEC.md §5.3 shows three. */
export function upcomingSlots(
  picksMade: number,
  totalPicks: number,
  teamCount: number,
  count = 3,
): DraftSlot[] {
  const slots: DraftSlot[] = [];
  for (let pick = picksMade + 2; pick <= totalPicks && slots.length < count; pick += 1) {
    slots.push(slotForPick(pick, teamCount));
  }
  return slots;
}

/**
 * How many picks the draft has in total: enough to fill every roster from the
 * pool of undrafted players. Derived rather than hardcoded to 13.
 */
export function totalPicksFor(playerCount: number, captainCount: number): number {
  return playerCount - captainCount;
}

// ---------------------------------------------------------------------------
// Pick authorization
//
// SPEC.md §5.2: "reject any pick where the submitting person is not the current
// picker, or where the player is already drafted. Do not rely on the UI to
// prevent this."
//
// The decision is pure and lives here so it can be tested directly. The action
// in app/draft/actions.ts supplies the facts from a locked transaction and
// applies the verdict; whether the player is still available is decided by the
// database itself, as a conditional UPDATE.
// ---------------------------------------------------------------------------

export type PickRequest = {
  status: 'NOT_STARTED' | 'LIVE' | 'COMPLETE';
  paused: boolean;
  /** The person submitting the pick. Null means nobody is signed in. */
  submitterId: string | null;
  submitterIsAdmin: boolean;
  /** Captain of the team currently on the clock, or null if nobody is. */
  onTheClockCaptainId: string | null;
  onTheClockTeamName: string | null;
};

export type PickVerdict =
  | { allowed: true; onBehalf: boolean }
  | { allowed: false; reason: string };

export function authorizePick(request: PickRequest): PickVerdict {
  if (!request.submitterId) {
    return { allowed: false, reason: 'Sign in first.' };
  }
  if (request.status !== 'LIVE') {
    return { allowed: false, reason: 'The draft is not live.' };
  }
  if (request.paused) {
    return { allowed: false, reason: 'The draft is paused.' };
  }
  if (!request.onTheClockCaptainId) {
    return { allowed: false, reason: 'Nobody is on the clock.' };
  }

  const isTheirTurn = request.submitterId === request.onTheClockCaptainId;
  if (isTheirTurn) return { allowed: true, onBehalf: false };

  // SPEC.md §5.4: the admin may pick on behalf of any captain.
  if (request.submitterIsAdmin) return { allowed: true, onBehalf: true };

  const who = request.onTheClockTeamName ?? 'another team';
  return { allowed: false, reason: `It is ${who}'s pick.` };
}
