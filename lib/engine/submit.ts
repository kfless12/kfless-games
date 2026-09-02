import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { Identity } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { entries, gameResults, games, matchParticipants, matches, teams } from '@/lib/db/schema';
import { validateFfaPlacements } from '@/lib/engine/ffa';
import {
  computeStandings,
  generateRoundRobin,
  resolveRoundRobin,
  type RoundRobinResult,
} from '@/lib/engine/round-robin';

import {
  clearGameResults,
  derivePlacementsFromDb,
  propagateResult,
  scoreByPlacement,
  scoreByWins,
  type ScoredPlacement,
  undoMatchResult,
  writeGameResults,
} from './results';

/*
 * Submitting, editing and undoing results. SPEC.md §8.
 *
 * Who may submit: the admin, plus either captain involved in the match. That is
 * checked here on the server, never inferred from what the page rendered.
 *
 * Every mutation takes a row lock on the game first, so two people reporting the
 * same match at once cannot both propagate.
 */

export type SubmitOutcome = { ok: true; notice: string } | { ok: false; error: string };

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type MatchAuthorization = {
  allowed: boolean;
  /** Teams with an entry in this match, for the error message and the UI. */
  teamIds: string[];
  reason?: string;
};

/** What the decision needs to know about one entry in the match. */
export type MatchEntryFacts = {
  teamId: string;
  /** Players the captain assigned to this entry. Empty when unassigned (§4.4). */
  playerIds: string[];
};

/**
 * SPEC.md §8: admin, a captain of either team in the match, and — for games
 * played by part of a team — any player assigned to an entry in it.
 *
 * The player clause is a deliberate widening of the original "admin or either
 * captain". A beer pong match is two named pairs; making four people find a
 * captain to write down cups is friction, and §8's whole argument is that
 * concentrating result entry in one person is the failure mode to avoid.
 *
 * A whole-team game stays captain-only, because "the team" is not a person:
 * every player is in it, so widening to players would mean anyone on either
 * side could score it, and nobody would be accountable for the number.
 *
 * Assignment is optional (§4.4) and will often be skipped, so captains keep
 * their rights unconditionally. An unassigned entry therefore behaves exactly
 * as it does today rather than becoming a match nobody can score.
 *
 * Pure decision, given the facts. The caller supplies them from a locked read.
 */
export function authorizeSubmission(input: {
  identity: Identity | null;
  entriesInMatch: MatchEntryFacts[];
  captainTeamId: string | null;
  /** True when one entry is the whole team — games.entries_per_team === 1. */
  wholeTeamGame: boolean;
}): MatchAuthorization {
  const { identity, entriesInMatch, captainTeamId, wholeTeamGame } = input;
  const teamIds = [...new Set(entriesInMatch.map((entry) => entry.teamId))];

  if (!identity) {
    return { allowed: false, teamIds, reason: 'Sign in first.' };
  }
  if (identity.role === 'ADMIN') {
    return { allowed: true, teamIds };
  }
  if (identity.role === 'CAPTAIN' && captainTeamId !== null && teamIds.includes(captainTeamId)) {
    return { allowed: true, teamIds };
  }
  if (
    !wholeTeamGame &&
    entriesInMatch.some((entry) => entry.playerIds.includes(identity.personId))
  ) {
    return { allowed: true, teamIds };
  }

  return {
    allowed: false,
    teamIds,
    reason: wholeTeamGame
      ? 'Only the admin or a captain playing in this match can report it.'
      : 'Only the admin, a captain, or a player in this match can report it.',
  };
}

/**
 * Serialises every mutation for one game. Two captains reporting the same match
 * at the same instant must not both propagate their winner onward.
 */
async function lockGame(tx: Tx, gameId: string) {
  await tx.execute(sql`select 1 from ${games} where ${games.id} = ${gameId} for update`);
  const [game] = await tx.select().from(games).where(eq(games.id, gameId)).limit(1);
  return game;
}

async function entryFactsInMatch(tx: Tx, matchId: string): Promise<MatchEntryFacts[]> {
  const rows = await tx
    .select({ teamId: entries.teamId, playerIds: entries.playerIds })
    .from(matchParticipants)
    .innerJoin(entries, eq(entries.id, matchParticipants.entryId))
    .where(eq(matchParticipants.matchId, matchId));
  return rows.map((row) => ({ teamId: row.teamId, playerIds: row.playerIds ?? [] }));
}

// ---------------------------------------------------------------------------
// Bracket and round-robin results
// ---------------------------------------------------------------------------

export type ReportInput = {
  matchId: string;
  /** Entry that won. Required for bracket matches. */
  winnerEntryId?: string;
  /** Optional score per entry id — cups, points, whatever the game counts. */
  scores?: Record<string, number>;
};

export async function reportMatchResult(
  identity: Identity | null,
  input: ReportInput,
): Promise<SubmitOutcome & { gameId?: string; wasEdit?: boolean }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [match] = await tx.select().from(matches).where(eq(matches.id, input.matchId)).limit(1);
    if (!match) return { ok: false as const, error: 'That match no longer exists.' };

    const game = await lockGame(tx, match.gameId);
    if (!game) return { ok: false as const, error: 'That game no longer exists.' };

    const involved = await entryFactsInMatch(tx, match.id);
    const authorization = authorizeSubmission({
      identity,
      entriesInMatch: involved,
      captainTeamId: identity?.teamId ?? null,
      wholeTeamGame: game.entriesPerTeam === 1,
    });
    if (!authorization.allowed) {
      return { ok: false as const, error: authorization.reason ?? 'Not allowed.' };
    }

    const participants = await tx
      .select()
      .from(matchParticipants)
      .where(eq(matchParticipants.matchId, match.id))
      .orderBy(asc(matchParticipants.slot));

    const present = participants.filter((participant) => participant.entryId !== null);
    if (present.length < 2) {
      return { ok: false as const, error: 'This match is still waiting for both entries.' };
    }

    const wasEdit = match.status === 'COMPLETE';

    // An edit has to take back whatever the old result sent onward before the
    // new one is applied. SPEC.md §8.
    if (wasEdit) {
      await undoMatchResult(tx, match.id);
    }

    const winnerEntryId = input.winnerEntryId ?? winnerFromScores(present, input.scores);
    if (!winnerEntryId) {
      return { ok: false as const, error: 'Say who won.' };
    }
    if (!present.some((participant) => participant.entryId === winnerEntryId)) {
      return { ok: false as const, error: 'That entry is not in this match.' };
    }

    for (const participant of participants) {
      if (!participant.entryId) continue;
      const score = input.scores?.[participant.entryId];
      await tx
        .update(matchParticipants)
        .set({
          score: typeof score === 'number' ? score : null,
          isWinner: participant.entryId === winnerEntryId,
        })
        .where(eq(matchParticipants.id, participant.id));
    }

    await tx
      .update(matches)
      .set({ status: 'COMPLETE', completedAt: new Date() })
      .where(eq(matches.id, match.id));

    await propagateResult(tx, match.id);

    // SPEC.md §8: editing a result after a game is COMPLETE means the admin has
    // to re-mark it complete, which recomputes game_results. Dropping them here
    // is what makes the standings honest in the meantime.
    if (game.status === 'COMPLETE') {
      await clearGameResults(tx, game.id);
      await tx
        .update(games)
        .set({ status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(games.id, game.id));
    } else if (game.status === 'SCHEDULED') {
      await tx
        .update(games)
        .set({ status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(games.id, game.id));
    }

    return {
      ok: true as const,
      gameId: game.id,
      wasEdit,
      notice: wasEdit ? 'Result changed.' : 'Result saved.',
    };
  });
}

/** With no explicit winner, the higher score wins. A draw has no winner. */
function winnerFromScores(
  present: { entryId: string | null }[],
  scores: Record<string, number> | undefined,
): string | null {
  if (!scores) return null;

  let best: { entryId: string; score: number } | null = null;
  let tied = false;

  for (const participant of present) {
    if (!participant.entryId) continue;
    const score = scores[participant.entryId];
    if (typeof score !== 'number') return null;

    if (!best || score > best.score) {
      best = { entryId: participant.entryId, score };
      tied = false;
    } else if (score === best.score) {
      tied = true;
    }
  }

  return best && !tied ? best.entryId : null;
}

export async function undoMatch(
  identity: Identity | null,
  matchId: string,
): Promise<SubmitOutcome & { gameId?: string; cleared?: number }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    if (!match) return { ok: false as const, error: 'That match no longer exists.' };
    if (match.status !== 'COMPLETE') {
      return { ok: false as const, error: 'That match has no result to undo.' };
    }

    const game = await lockGame(tx, match.gameId);
    if (!game) return { ok: false as const, error: 'That game no longer exists.' };

    const involved = await entryFactsInMatch(tx, match.id);
    const authorization = authorizeSubmission({
      identity,
      entriesInMatch: involved,
      captainTeamId: identity?.teamId ?? null,
      wholeTeamGame: game.entriesPerTeam === 1,
    });
    if (!authorization.allowed) {
      return { ok: false as const, error: authorization.reason ?? 'Not allowed.' };
    }

    const summary = await undoMatchResult(tx, matchId);

    // Undoing anything invalidates a computed result set.
    await clearGameResults(tx, game.id);
    if (game.status === 'COMPLETE') {
      await tx
        .update(games)
        .set({ status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(games.id, game.id));
    }

    const downstream = summary.clearedMatchIds.length - 1;
    return {
      ok: true as const,
      gameId: game.id,
      cleared: summary.clearedMatchIds.length,
      notice:
        downstream > 0
          ? `Undone, along with ${downstream} match${downstream === 1 ? '' : 'es'} that depended on it.`
          : 'Undone.',
    };
  });
}

// ---------------------------------------------------------------------------
// Ranked free-for-all — SPEC.md §6.4
// ---------------------------------------------------------------------------

export async function reportFfaResult(
  identity: Identity | null,
  input: { matchId: string; placements: { entryId: string; placement: number; rawScore?: number | null }[] },
): Promise<SubmitOutcome & { gameId?: string }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [match] = await tx.select().from(matches).where(eq(matches.id, input.matchId)).limit(1);
    if (!match) return { ok: false as const, error: 'That heat no longer exists.' };

    const game = await lockGame(tx, match.gameId);
    if (!game) return { ok: false as const, error: 'That game no longer exists.' };

    // A heat holds every team, so only the admin can report it — "either captain
    // involved" does not narrow anything down when all four are in it.
    if (identity?.role !== 'ADMIN') {
      return { ok: false as const, error: 'Only the admin can report a free-for-all heat.' };
    }

    const participants = await tx
      .select()
      .from(matchParticipants)
      .where(eq(matchParticipants.matchId, match.id))
      .orderBy(asc(matchParticipants.slot));

    const entryIds = participants
      .map((participant) => participant.entryId)
      .filter((entryId): entryId is string => entryId !== null);

    const validation = validateFfaPlacements(entryIds, input.placements);
    if (!validation.ok) return { ok: false as const, error: validation.errors.join(' ') };

    const byEntry = new Map(input.placements.map((row) => [row.entryId, row]));
    for (const participant of participants) {
      if (!participant.entryId) continue;
      const row = byEntry.get(participant.entryId);
      await tx
        .update(matchParticipants)
        .set({
          rank: row?.placement ?? null,
          // rawScore is displayed but never orders anything (SPEC.md §6.4).
          score: typeof row?.rawScore === 'number' ? row.rawScore : null,
          isWinner: row?.placement === 1,
        })
        .where(eq(matchParticipants.id, participant.id));
    }

    await tx
      .update(matches)
      .set({ status: 'COMPLETE', completedAt: new Date() })
      .where(eq(matches.id, match.id));

    if (game.status === 'COMPLETE') await clearGameResults(tx, game.id);
    await tx
      .update(games)
      .set({ status: 'ACTIVE', updatedAt: new Date() })
      .where(eq(games.id, game.id));

    return { ok: true as const, gameId: game.id, notice: 'Heat recorded.' };
  });
}

// ---------------------------------------------------------------------------
// Marking a game complete — SPEC.md §6.5
// ---------------------------------------------------------------------------

export type CompleteOutcome =
  | { ok: true; notice: string; resultCount: number }
  | { ok: false; error: string };

export async function completeGame(
  identity: Identity | null,
  gameId: string,
  coinFlipOrder: string[] = [],
): Promise<CompleteOutcome> {
  if (identity?.role !== 'ADMIN') return { ok: false, error: 'Admin only.' };

  const db = getDb();

  return db.transaction(async (tx) => {
    const game = await lockGame(tx, gameId);
    if (!game) return { ok: false as const, error: 'That game no longer exists.' };

    const allMatches = await tx.select().from(matches).where(eq(matches.gameId, gameId));
    if (allMatches.length === 0) {
      return { ok: false as const, error: 'Schedule the game first.' };
    }

    const gameEntries = await tx
      .select({ id: entries.id, seed: entries.seed })
      .from(entries)
      .where(eq(entries.gameId, gameId));

    let scored: ScoredPlacement[];

    if (game.format === 'RANKED_FFA') {
      const heat = allMatches[0];
      if (heat.status !== 'COMPLETE') {
        return { ok: false as const, error: 'The heat has no result yet.' };
      }
      const rows = await tx
        .select()
        .from(matchParticipants)
        .where(eq(matchParticipants.matchId, heat.id));

      const placements = rows
        .filter((row) => row.entryId !== null && row.rank !== null)
        .map((row) => ({ entryId: row.entryId!, placement: row.rank! }))
        .sort((a, b) => a.placement - b.placement);

      if (placements.length !== gameEntries.length) {
        return { ok: false as const, error: 'Not every entry has a placement.' };
      }

      scored = scoreByPlacement(game.pointsMatrix, placements);
    } else if (game.format === 'ROUND_ROBIN') {
      const outstanding = allMatches.filter((match) => match.status !== 'COMPLETE').length;
      if (outstanding > 0) {
        return {
          ok: false as const,
          error: `${outstanding} match${outstanding === 1 ? '' : 'es'} still to play.`,
        };
      }

      // SPEC.md §6.3: a round robin pays per win, so it cannot be scored until
      // the admin has said what a win is worth.
      if (game.pointsPerWin === null) {
        return {
          ok: false as const,
          error: 'Set the points per win first — a round robin scores by wins, not placement.',
        };
      }

      const generated = generateRoundRobin(gameEntries.map((entry) => entry.id));
      const results = await roundRobinResults(tx, allMatches, generated);
      const outcome = resolveRoundRobin(
        gameEntries.map((entry) => entry.id),
        generated,
        results,
        coinFlipOrder,
      );

      if (outcome.unresolvedTies.length > 0 && coinFlipOrder.length === 0) {
        const tie = outcome.unresolvedTies[0];
        return {
          ok: false as const,
          error: `${tie.length} entries are level on every tie-breaker. A coin flip is needed before this can be marked complete.`,
        };
      }

      const winsByEntry = new Map(
        outcome.standings.map((row) => [row.entryId, row.wins]),
      );
      scored = scoreByWins(game.pointsPerWin, outcome.placements, winsByEntry);
    } else {
      const derived = await derivePlacementsFromDb(tx, gameId, game.format);
      if (!derived.complete) {
        return {
          ok: false as const,
          error:
            derived.outstanding > 0
              ? `${derived.outstanding} match${derived.outstanding === 1 ? '' : 'es'} still to play.`
              : 'The bracket has no winner yet.',
        };
      }
      scored = scoreByPlacement(game.pointsMatrix, derived.placements);
    }

    const resultCount = await writeGameResults(tx, gameId, scored);

    await tx
      .update(games)
      .set({ status: 'COMPLETE', updatedAt: new Date() })
      .where(eq(games.id, gameId));

    return {
      ok: true as const,
      resultCount,
      notice: `${game.name} is complete. ${resultCount} placements scored.`,
    };
  });
}

/** Reads round-robin scores back into the shape the pure resolver expects. */
async function roundRobinResults(
  tx: Tx,
  allMatches: { id: string; round: number; slot: number; status: string }[],
  generated: { key: string; round: number; slot: number; participants: [string, string] }[],
): Promise<RoundRobinResult[]> {
  const rows = await tx
    .select()
    .from(matchParticipants)
    .where(inArray(matchParticipants.matchId, allMatches.map((match) => match.id)));

  const byMatch = new Map<string, typeof rows>();
  for (const row of rows) {
    byMatch.set(row.matchId, [...(byMatch.get(row.matchId) ?? []), row]);
  }

  const results: RoundRobinResult[] = [];

  for (const generatedMatch of generated) {
    // Match up by (round, slot), which is how persist.ts wrote them.
    const dbMatch = allMatches.find(
      (match) => match.round === generatedMatch.round && match.slot === generatedMatch.slot,
    );
    if (!dbMatch || dbMatch.status !== 'COMPLETE') continue;

    const participants = (byMatch.get(dbMatch.id) ?? []).sort((a, b) => a.slot - b.slot);
    const scoreFor = (entryId: string) =>
      participants.find((participant) => participant.entryId === entryId)?.score ?? 0;
    const winnerId = participants.find((participant) => participant.isWinner)?.entryId ?? null;

    const [a, b] = generatedMatch.participants;
    let scoreA = scoreFor(a);
    let scoreB = scoreFor(b);

    // With no scores entered, synthesise 1-0 from the winner so wins still count.
    if (scoreA === 0 && scoreB === 0 && winnerId) {
      scoreA = winnerId === a ? 1 : 0;
      scoreB = winnerId === b ? 1 : 0;
    }

    results.push({ matchKey: generatedMatch.key, scores: [scoreA, scoreB] });
  }

  return results;
}

/** Standings for a round-robin game, for display. SPEC.md §6.3. */
export async function roundRobinStandings(gameId: string) {
  const db = getDb();
  const gameEntries = await db
    .select({ id: entries.id, teamId: entries.teamId, label: entries.label })
    .from(entries)
    .where(eq(entries.gameId, gameId));

  const allMatches = await db.select().from(matches).where(eq(matches.gameId, gameId));
  const generated = generateRoundRobin(gameEntries.map((entry) => entry.id));

  const results = await db.transaction(async (tx) => roundRobinResults(tx, allMatches, generated));

  return {
    entries: gameEntries,
    standings: computeStandings(gameEntries.map((entry) => entry.id), generated, results),
    outcome: resolveRoundRobin(gameEntries.map((entry) => entry.id), generated, results),
  };
}

/** Head-to-head records between teams from round-robin games, for SPEC.md §6.5. */
export async function loadHeadToHead(): Promise<
  { teamA: string; teamB: string; winsA: number; winsB: number }[]
> {
  const db = getDb();

  const rows = await db
    .select({
      matchId: matches.id,
      teamId: entries.teamId,
      isWinner: matchParticipants.isWinner,
    })
    .from(matches)
    .innerJoin(games, eq(games.id, matches.gameId))
    .innerJoin(matchParticipants, eq(matchParticipants.matchId, matches.id))
    .innerJoin(entries, eq(entries.id, matchParticipants.entryId))
    .where(and(eq(games.format, 'ROUND_ROBIN'), eq(matches.status, 'COMPLETE')));

  const byMatch = new Map<string, { teamId: string; isWinner: boolean | null }[]>();
  for (const row of rows) {
    byMatch.set(row.matchId, [
      ...(byMatch.get(row.matchId) ?? []),
      { teamId: row.teamId, isWinner: row.isWinner },
    ]);
  }

  const tally = new Map<string, { teamA: string; teamB: string; winsA: number; winsB: number }>();

  for (const sides of byMatch.values()) {
    if (sides.length !== 2) continue;
    const [first, second] = sides;
    if (first.teamId === second.teamId) continue; // same team's two entries

    const [teamA, teamB] = [first.teamId, second.teamId].sort();
    const key = `${teamA}|${teamB}`;
    const record = tally.get(key) ?? { teamA, teamB, winsA: 0, winsB: 0 };

    const winner = sides.find((side) => side.isWinner === true);
    if (winner) {
      if (winner.teamId === teamA) record.winsA += 1;
      else record.winsB += 1;
    }

    tally.set(key, record);
  }

  return [...tally.values()];
}

/** Everything the leaderboard needs. SPEC.md §6.5, computed at read time. */
export async function loadScoringData() {
  const db = getDb();

  const [allTeams, allGames, allEntries, allResults] = await Promise.all([
    db
      .select({
        id: teams.id,
        name: teams.name,
        colorHex: teams.colorHex,
        logoUrl: teams.logoUrl,
      })
      .from(teams)
      .orderBy(asc(teams.draftPosition)),
    db.select().from(games).orderBy(asc(games.sortOrder), asc(games.name)),
    db.select({ id: entries.id, gameId: entries.gameId, teamId: entries.teamId }).from(entries),
    db
      .select({
        gameId: gameResults.gameId,
        entryId: gameResults.entryId,
        placement: gameResults.placement,
        pointsAwarded: gameResults.pointsAwarded,
      })
      .from(gameResults),
  ]);

  return { teams: allTeams, games: allGames, entries: allEntries, results: allResults };
}
