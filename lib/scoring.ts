/*
 * The leaderboard. SPEC.md §6.5.
 *
 * Pure, and computed entirely from game_results and match rows at read time.
 * There is no stored total anywhere — that is the whole reason undo works
 * (SPEC.md §2), so nothing in here may ever be cached into a column.
 *
 * Aggregation across a team's entries happens here, at read time, per
 * SPEC.md §6.5 step 4.
 */

export type EntryAggregation = 'SUM' | 'BEST';

export type ScoringGame = {
  id: string;
  name: string;
  format: string;
  entryAggregation: EntryAggregation;
  pointsMatrix: unknown;
  pointsPerWin?: number | null;
  /** Only a COMPLETE game contributes; see SPEC.md §6.5. */
  status: string;
  sortOrder: number;
};

export type ScoringEntry = { id: string; gameId: string; teamId: string };

export type ScoringResult = {
  gameId: string;
  entryId: string;
  placement: number;
  pointsAwarded: number;
};

/** Wins between two teams in round-robin play, for tie-breaker 4. */
export type HeadToHead = { teamA: string; teamB: string; winsA: number; winsB: number };

/** SPEC.md §6.5 tie-breaker 5. A reason is required, so it is not optional here. */
export type StandingsOverride = { teamId: string; priority: number; reason: string };

export type ScoringTeam = { id: string; name: string; colorHex: string; logoUrl: string | null };

export type GameBreakdown = {
  gameId: string;
  gameName: string;
  points: number;
  /** The team's best placement in that game, across its entries. */
  bestPlacement: number | null;
  entryPlacements: { entryId: string; placement: number; points: number }[];
};

export type LeaderboardRow = {
  teamId: string;
  teamName: string;
  colorHex: string;
  logoUrl: string | null;
  totalPoints: number;
  firsts: number;
  seconds: number;
  perGame: GameBreakdown[];
  /** Set when tie-breaker 5 decided this team's position. */
  overrideReason: string | null;
};

/**
 * Points a team earned in one game, applying its entry_aggregation.
 *
 * SUM adds every entry's points; BEST takes the highest single entry. Both are
 * applied here rather than pre-aggregated, so undoing a result changes the
 * standings on the next read with nothing to unwind.
 */
export function aggregateGamePoints(
  perEntryPoints: number[],
  aggregation: EntryAggregation,
): number {
  if (perEntryPoints.length === 0) return 0;
  if (aggregation === 'BEST') return Math.max(...perEntryPoints);
  return perEntryPoints.reduce((total, points) => total + points, 0);
}

/*
 * The leaderboard sums game_results.points_awarded, which SPEC.md §4.7 calls the
 * only input to the leaderboard.
 *
 * It deliberately does NOT recompute from points_matrix. Round robin pays by
 * wins (SPEC.md §6.3) and the win count is not in game_results, so recomputing
 * would work for some formats and not others. Instead, changing a game's
 * scoring config drops its results and reopens it — the same rule as editing a
 * match result — so a stale total is impossible.
 */
export function pointsForResult(_game: ScoringGame, result: ScoringResult): number {
  return result.pointsAwarded;
}

export function buildLeaderboard(input: {
  teams: ScoringTeam[];
  games: ScoringGame[];
  entries: ScoringEntry[];
  results: ScoringResult[];
  headToHead?: HeadToHead[];
  overrides?: StandingsOverride[];
}): LeaderboardRow[] {
  const { teams, games, entries, results } = input;
  const headToHead = input.headToHead ?? [];
  const overrides = input.overrides ?? [];

  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const overrideByTeam = new Map(overrides.map((entry) => [entry.teamId, entry]));

  // Only completed games contribute. A game mid-play has no placements yet, and
  // a partially-scored game would make the board lie.
  const scoringGames = games
    .filter((game) => game.status === 'COMPLETE')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const rows: LeaderboardRow[] = teams.map((team) => {
    const perGame: GameBreakdown[] = [];

    for (const game of scoringGames) {
      const teamResults = results.filter((result) => {
        if (result.gameId !== game.id) return false;
        return entryById.get(result.entryId)?.teamId === team.id;
      });

      if (teamResults.length === 0) continue;

      const entryPlacements = teamResults
        .map((result) => ({
          entryId: result.entryId,
          placement: result.placement,
          points: pointsForResult(game, result),
        }))
        .sort((a, b) => a.placement - b.placement);

      perGame.push({
        gameId: game.id,
        gameName: game.name,
        points: aggregateGamePoints(
          entryPlacements.map((entry) => entry.points),
          game.entryAggregation,
        ),
        bestPlacement: entryPlacements[0]?.placement ?? null,
        entryPlacements,
      });
    }

    // A team's placement in a game is its best entry's placement, so a team
    // with two entries is credited with a 1st if either of them won.
    const firsts = perGame.filter((game) => game.bestPlacement === 1).length;
    const seconds = perGame.filter((game) => game.bestPlacement === 2).length;

    return {
      teamId: team.id,
      teamName: team.name,
      colorHex: team.colorHex,
      logoUrl: team.logoUrl,
      totalPoints: perGame.reduce((total, game) => total + game.points, 0),
      firsts,
      seconds,
      perGame,
      overrideReason: null,
    };
  });

  /*
   * Grouped rather than pairwise. Tie-breakers 1-3 partition the board; inside
   * each group head-to-head is a mini-table of wins against only the other
   * members of that group.
   *
   * Pairwise head-to-head is not transitive — three teams can beat each other in
   * a cycle — and sorting on a non-transitive comparator gives an order that
   * depends on the comparison sequence rather than on any rule anyone could
   * explain. A 3-way cycle turned up on the first realistic round robin played
   * through the app, so this is not a hypothetical.
   */
  const groups = new Map<string, LeaderboardRow[]>();
  for (const row of rows) {
    const key = `${row.totalPoints}|${row.firsts}|${row.seconds}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const sorted: LeaderboardRow[] = [];

  const orderedKeys = [...groups.keys()].sort((a, b) => {
    const [pointsA, firstsA, secondsA] = a.split('|').map(Number);
    const [pointsB, firstsB, secondsB] = b.split('|').map(Number);
    return pointsB - pointsA || firstsB - firstsA || secondsB - secondsA;
  });

  for (const key of orderedKeys) {
    const group = groups.get(key)!;
    const miniWins = miniTableWins(group.map((row) => row.teamId), headToHead);

    const ordered = [...group].sort((a, b) => {
      const h2h = (miniWins.get(b.teamId) ?? 0) - (miniWins.get(a.teamId) ?? 0);
      if (h2h !== 0) return h2h;

      const overrideA = overrideByTeam.get(a.teamId);
      const overrideB = overrideByTeam.get(b.teamId);
      if (overrideA && overrideB) return overrideA.priority - overrideB.priority;
      if (overrideA) return -1;
      if (overrideB) return 1;

      // Stable, so polling never reshuffles a tied board under anyone's eyes.
      return a.teamName.localeCompare(b.teamName) || a.teamId.localeCompare(b.teamId);
    });

    // Note which rows an override actually decided, so the board can say why.
    if (group.length > 1) {
      for (const row of ordered) {
        const levelOnRules = ordered.every(
          (other) => (miniWins.get(other.teamId) ?? 0) === (miniWins.get(row.teamId) ?? 0),
        );
        if (levelOnRules && overrideByTeam.has(row.teamId)) {
          row.overrideReason = overrideByTeam.get(row.teamId)!.reason;
        }
      }
    }

    sorted.push(...ordered);
  }

  return sorted;
}

/** Wins each team has against only the other members of the tied group. */
function miniTableWins(group: string[], headToHead: HeadToHead[]): Map<string, number> {
  const inGroup = new Set(group);
  const wins = new Map<string, number>(group.map((teamId) => [teamId, 0]));

  for (const record of headToHead) {
    if (!inGroup.has(record.teamA) || !inGroup.has(record.teamB)) continue;
    wins.set(record.teamA, (wins.get(record.teamA) ?? 0) + record.winsA);
    wins.set(record.teamB, (wins.get(record.teamB) ?? 0) + record.winsB);
  }

  return wins;
}
