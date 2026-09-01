/*
 * Round robin. SPEC.md §6.3.
 *
 * Every entry plays every other once — 4 entries is 6 matches. Standings are
 * Wins / Losses / differential, and placement is standings order.
 *
 * Tie-breakers, in the order SPEC.md §6.3 gives them:
 *   1. head-to-head record among the tied entries only
 *   2. differential
 *   3. coin flip, which this module surfaces to the admin rather than deciding
 *
 * Pure. The coin flip is returned as an unresolved tie, never invented here.
 */

export type RoundRobinMatch = {
  key: string;
  round: number;
  slot: number;
  participants: [string, string];
};

/**
 * Circle method, so each entry plays at most once per round and the rounds are
 * schedulable. An odd number of entries gets a bye each round.
 */
export function generateRoundRobin(entryIds: string[]): RoundRobinMatch[] {
  if (entryIds.length < 2) return [];

  const BYE = '__bye__';
  const wheel = [...entryIds];
  if (wheel.length % 2 === 1) wheel.push(BYE);

  const half = wheel.length / 2;
  const rounds = wheel.length - 1;
  const matches: RoundRobinMatch[] = [];

  const rotating = [...wheel];
  for (let round = 1; round <= rounds; round += 1) {
    let slot = 0;
    for (let i = 0; i < half; i += 1) {
      const a = rotating[i];
      const b = rotating[rotating.length - 1 - i];
      if (a !== BYE && b !== BYE) {
        matches.push({
          key: `RR-${round}-${slot}`,
          round,
          slot,
          participants: [a, b],
        });
        slot += 1;
      }
    }
    // Rotate everything but the first position.
    rotating.splice(1, 0, rotating.pop()!);
  }

  return matches;
}

export type RoundRobinResult = {
  matchKey: string;
  /** Score per participant, in the same order as the match's participants. */
  scores: [number, number];
};

export type Standing = {
  entryId: string;
  played: number;
  wins: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  differential: number;
};

export function computeStandings(
  entryIds: string[],
  matches: RoundRobinMatch[],
  results: RoundRobinResult[],
): Standing[] {
  const table = new Map<string, Standing>(
    entryIds.map((entryId) => [
      entryId,
      {
        entryId,
        played: 0,
        wins: 0,
        losses: 0,
        scoreFor: 0,
        scoreAgainst: 0,
        differential: 0,
      },
    ]),
  );

  const byKey = new Map(matches.map((match) => [match.key, match]));

  for (const result of results) {
    const match = byKey.get(result.matchKey);
    if (!match) continue;

    const [a, b] = match.participants;
    const [scoreA, scoreB] = result.scores;
    const rowA = table.get(a);
    const rowB = table.get(b);
    if (!rowA || !rowB) continue;

    rowA.played += 1;
    rowB.played += 1;
    rowA.scoreFor += scoreA;
    rowA.scoreAgainst += scoreB;
    rowB.scoreFor += scoreB;
    rowB.scoreAgainst += scoreA;

    // A draw leaves both without a win. SPEC.md §6.3 does not mention draws;
    // cup games do not produce them, and the tie-breakers handle equal records.
    if (scoreA > scoreB) {
      rowA.wins += 1;
      rowB.losses += 1;
    } else if (scoreB > scoreA) {
      rowB.wins += 1;
      rowA.losses += 1;
    }
  }

  for (const row of table.values()) {
    row.differential = row.scoreFor - row.scoreAgainst;
  }

  return [...table.values()];
}

/** Head-to-head wins between two entries, from the played results only. */
function headToHead(
  a: string,
  b: string,
  matches: RoundRobinMatch[],
  results: RoundRobinResult[],
): { aWins: number; bWins: number } {
  const byKey = new Map(matches.map((match) => [match.key, match]));
  let aWins = 0;
  let bWins = 0;

  for (const result of results) {
    const match = byKey.get(result.matchKey);
    if (!match) continue;
    const [x, y] = match.participants;
    if (!((x === a && y === b) || (x === b && y === a))) continue;

    const [scoreX, scoreY] = result.scores;
    if (scoreX === scoreY) continue;
    const winner = scoreX > scoreY ? x : y;
    if (winner === a) aWins += 1;
    else bWins += 1;
  }

  return { aWins, bWins };
}

export type RoundRobinPlacement = {
  entryId: string;
  placement: number;
};

export type RoundRobinOutcome = {
  standings: Standing[];
  placements: RoundRobinPlacement[];
  /**
   * Groups of entries the tie-breakers could not separate. SPEC.md §6.3 says
   * the admin resolves these with a coin flip, so they are reported rather
   * than broken arbitrarily. Placements still assign an order so the table can
   * render, but the admin is told it needs a decision.
   */
  unresolvedTies: string[][];
};

/**
 * Standings order, applying SPEC.md §6.3's tie-breakers.
 *
 * `manualOrder` lets the admin's coin flip decide a group: entries listed
 * earlier in it win the tie. Anything still tied is reported back.
 */
export function resolveRoundRobin(
  entryIds: string[],
  matches: RoundRobinMatch[],
  results: RoundRobinResult[],
  manualOrder: string[] = [],
): RoundRobinOutcome {
  const standings = computeStandings(entryIds, matches, results);
  const rank = new Map(standings.map((row) => [row.entryId, row]));
  const manualIndex = new Map(manualOrder.map((entryId, index) => [entryId, index]));

  const sorted = [...standings].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;

    const h2h = headToHead(a.entryId, b.entryId, matches, results);
    if (h2h.aWins !== h2h.bWins) return h2h.bWins - h2h.aWins;

    if (b.differential !== a.differential) return b.differential - a.differential;

    const manualA = manualIndex.get(a.entryId);
    const manualB = manualIndex.get(b.entryId);
    if (manualA !== undefined && manualB !== undefined) return manualA - manualB;

    // Stable, so the table does not reshuffle between polls while the admin is
    // still deciding.
    return a.entryId.localeCompare(b.entryId);
  });

  // Anything the rules left level needs the admin's coin flip.
  const unresolvedTies: string[][] = [];
  let group: string[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const tiedWithNext =
      next !== undefined &&
      current.wins === next.wins &&
      current.differential === next.differential &&
      headToHead(current.entryId, next.entryId, matches, results).aWins ===
        headToHead(current.entryId, next.entryId, matches, results).bWins &&
      !(manualIndex.has(current.entryId) && manualIndex.has(next.entryId));

    if (tiedWithNext) {
      if (group.length === 0) group.push(current.entryId);
      group.push(next.entryId);
    } else if (group.length > 0) {
      unresolvedTies.push(group);
      group = [];
    }
  }
  if (group.length > 0) unresolvedTies.push(group);

  void rank;

  return {
    standings: sorted,
    placements: sorted.map((row, index) => ({ entryId: row.entryId, placement: index + 1 })),
    unresolvedTies,
  };
}
