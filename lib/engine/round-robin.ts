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
  const manualIndex = new Map(manualOrder.map((entryId, index) => [entryId, index]));

  /*
   * Head-to-head is applied as a mini-table within each group tied on wins,
   * not as a pairwise comparison.
   *
   * Pairwise looks simpler but is not transitive: three entries can beat each
   * other in a cycle — A beat B, B beat C, C beat A — and a sort over a
   * non-transitive comparator produces an order that depends on the comparison
   * sequence rather than on any rule. Counting wins against only the other
   * members of the tied group is the usual convention and always yields an
   * order that can be explained out loud.
   */
  const byWins = new Map<number, Standing[]>();
  for (const row of standings) {
    byWins.set(row.wins, [...(byWins.get(row.wins) ?? []), row]);
  }

  const sorted: Standing[] = [];
  const unresolvedTies: string[][] = [];

  for (const wins of [...byWins.keys()].sort((a, b) => b - a)) {
    const group = byWins.get(wins)!;
    const miniWins = miniTableWins(group.map((row) => row.entryId), matches, results);

    const ordered = [...group].sort((a, b) => {
      const h2h = (miniWins.get(b.entryId) ?? 0) - (miniWins.get(a.entryId) ?? 0);
      if (h2h !== 0) return h2h;

      if (b.differential !== a.differential) return b.differential - a.differential;

      const manualA = manualIndex.get(a.entryId);
      const manualB = manualIndex.get(b.entryId);
      if (manualA !== undefined && manualB !== undefined) return manualA - manualB;

      // Stable, so the table does not reshuffle between polls while the admin
      // is still deciding.
      return a.entryId.localeCompare(b.entryId);
    });

    sorted.push(...ordered);

    // Anything the rules left level needs the admin's coin flip (SPEC.md §6.3).
    let run: string[] = [];
    for (let i = 0; i < ordered.length; i += 1) {
      const current = ordered[i];
      const next = ordered[i + 1];
      const level =
        next !== undefined &&
        (miniWins.get(current.entryId) ?? 0) === (miniWins.get(next.entryId) ?? 0) &&
        current.differential === next.differential &&
        !(manualIndex.has(current.entryId) && manualIndex.has(next.entryId));

      if (level) {
        if (run.length === 0) run.push(current.entryId);
        run.push(next.entryId);
      } else if (run.length > 0) {
        unresolvedTies.push(run);
        run = [];
      }
    }
    if (run.length > 0) unresolvedTies.push(run);
  }

  return {
    standings: sorted,
    placements: sorted.map((row, index) => ({ entryId: row.entryId, placement: index + 1 })),
    unresolvedTies,
  };
}

/** Wins each entry has against only the other members of the group. */
function miniTableWins(
  group: string[],
  matches: RoundRobinMatch[],
  results: RoundRobinResult[],
): Map<string, number> {
  const inGroup = new Set(group);
  const wins = new Map<string, number>(group.map((entryId) => [entryId, 0]));
  const byKey = new Map(matches.map((match) => [match.key, match]));

  for (const result of results) {
    const match = byKey.get(result.matchKey);
    if (!match) continue;

    const [a, b] = match.participants;
    if (!inGroup.has(a) || !inGroup.has(b)) continue;

    const [scoreA, scoreB] = result.scores;
    if (scoreA === scoreB) continue;

    const winner = scoreA > scoreB ? a : b;
    wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }

  return wins;
}
