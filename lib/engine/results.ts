import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { entries, gameResults, games, matchParticipants, matches } from '@/lib/db/schema';
import { pointsForPlacement } from '@/lib/games';

import { orderPlacements, type Elimination, type Placement } from './placement';

/*
 * Reporting, editing and undoing a result, against the persisted match graph.
 *
 * SPEC.md §6.1 is the design: because the whole graph exists in advance,
 * reporting a result is "write the entry into the target slot" and undo is
 * "clear the target slots". Nothing re-derives the bracket shape.
 *
 * SPEC.md §8 makes undo recursive: clearing a result has to clear the
 * downstream slots it populated and reset those matches to PENDING — and if a
 * downstream match already has a result of its own, that goes first, because it
 * was decided by a participant that is about to disappear.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type MatchRow = typeof matches.$inferSelect;
export type ParticipantRow = typeof matchParticipants.$inferSelect;

/** The grand-final reset lives at GRAND_FINAL round 2. */
function isResetMatch(match: Pick<MatchRow, 'bracket' | 'round'>): boolean {
  return match.bracket === 'GRAND_FINAL' && match.round === 2;
}

async function loadParticipants(tx: Tx, matchId: string): Promise<ParticipantRow[]> {
  return tx
    .select()
    .from(matchParticipants)
    .where(eq(matchParticipants.matchId, matchId))
    .orderBy(asc(matchParticipants.slot));
}

// ---------------------------------------------------------------------------
// Undo — SPEC.md §8
// ---------------------------------------------------------------------------

export type UndoSummary = {
  /** Every match whose result was cleared, this one first. */
  clearedMatchIds: string[];
  /** Slots emptied downstream, as "<matchId>#<slot>". */
  clearedSlots: string[];
};

/**
 * Clears one match's result and everything downstream of it.
 *
 * Depth-first: a downstream match that already has a result is undone before
 * its participant is removed, so the graph is never left holding a result that
 * was decided by somebody who is no longer in the match.
 */
export async function undoMatchResult(tx: Tx, matchId: string): Promise<UndoSummary> {
  const summary: UndoSummary = { clearedMatchIds: [], clearedSlots: [] };
  await undoInto(tx, matchId, summary, new Set());
  return summary;
}

async function undoInto(
  tx: Tx,
  matchId: string,
  summary: UndoSummary,
  visiting: Set<string>,
): Promise<void> {
  if (visiting.has(matchId)) return; // pointer cycles cannot happen, but do not hang if one does
  visiting.add(matchId);

  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) return;

  const participants = await loadParticipants(tx, matchId);
  const winner = participants.find((participant) => participant.isWinner === true);
  const loser = participants.find(
    (participant) => participant.isWinner === false && participant.entryId !== null,
  );

  // Follow the two pointers this match feeds and take back whoever it sent.
  const targets: { matchId: string | null; slot: number | null; entryId: string | null }[] = [
    { matchId: match.winnerToMatchId, slot: match.winnerToSlot, entryId: winner?.entryId ?? null },
    { matchId: match.loserToMatchId, slot: match.loserToSlot, entryId: loser?.entryId ?? null },
  ];

  for (const target of targets) {
    if (!target.matchId || target.slot === null || !target.entryId) continue;
    await clearDownstreamSlot(tx, target.matchId, target.slot, target.entryId, summary, visiting);
  }

  /*
   * The grand final's reset is populated conditionally rather than by a
   * pointer, so undoing the grand final has to clear it explicitly. Without
   * this, undoing a grand final that went to a reset would leave the reset
   * standing with both finalists still in it.
   */
  if (match.bracket === 'GRAND_FINAL' && !isResetMatch(match)) {
    const [reset] = await tx
      .select()
      .from(matches)
      .where(
        and(eq(matches.gameId, match.gameId), eq(matches.bracket, 'GRAND_FINAL'), eq(matches.round, 2)),
      )
      .limit(1);

    if (reset) {
      if (reset.status === 'COMPLETE') await undoInto(tx, reset.id, summary, visiting);
      await tx
        .update(matchParticipants)
        .set({ entryId: null, score: null, rank: null, isWinner: null })
        .where(eq(matchParticipants.matchId, reset.id));
      await tx
        .update(matches)
        .set({ status: 'PENDING', completedAt: null })
        .where(eq(matches.id, reset.id));
      summary.clearedSlots.push(`${reset.id}#0`, `${reset.id}#1`);
    }
  }

  // Finally clear this match's own result, keeping its participants in place.
  await tx
    .update(matchParticipants)
    .set({ score: null, rank: null, isWinner: null })
    .where(eq(matchParticipants.matchId, matchId));

  const filled = participants.filter((participant) => participant.entryId !== null).length;
  await tx
    .update(matches)
    .set({ status: filled === 2 ? 'READY' : 'PENDING', completedAt: null })
    .where(eq(matches.id, matchId));

  summary.clearedMatchIds.push(matchId);
  visiting.delete(matchId);
}

/** Removes one entry from one downstream slot, undoing that match first if needed. */
async function clearDownstreamSlot(
  tx: Tx,
  downstreamMatchId: string,
  slot: number,
  entryId: string,
  summary: UndoSummary,
  visiting: Set<string>,
): Promise<void> {
  const [participant] = await tx
    .select()
    .from(matchParticipants)
    .where(
      and(eq(matchParticipants.matchId, downstreamMatchId), eq(matchParticipants.slot, slot)),
    )
    .limit(1);

  // Somebody else is in that slot now, so this result did not put them there.
  if (!participant || participant.entryId !== entryId) return;

  const [downstream] = await tx
    .select()
    .from(matches)
    .where(eq(matches.id, downstreamMatchId))
    .limit(1);

  if (downstream?.status === 'COMPLETE') {
    await undoInto(tx, downstreamMatchId, summary, visiting);
  }

  await tx
    .update(matchParticipants)
    .set({ entryId: null, score: null, rank: null, isWinner: null })
    .where(eq(matchParticipants.id, participant.id));

  await tx
    .update(matches)
    .set({ status: 'PENDING', completedAt: null })
    .where(eq(matches.id, downstreamMatchId));

  summary.clearedSlots.push(`${downstreamMatchId}#${slot}`);
}

// ---------------------------------------------------------------------------
// Applying a result
// ---------------------------------------------------------------------------

/** Writes the winner and loser onward, and marks any filled match READY. */
export async function propagateResult(tx: Tx, matchId: string): Promise<void> {
  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) return;

  const participants = await loadParticipants(tx, matchId);
  const winner = participants.find((participant) => participant.isWinner === true);
  const loser = participants.find(
    (participant) => participant.isWinner === false && participant.entryId !== null,
  );

  if (match.winnerToMatchId && match.winnerToSlot !== null && winner?.entryId) {
    await fillSlot(tx, match.winnerToMatchId, match.winnerToSlot, winner.entryId);
  }
  if (match.loserToMatchId && match.loserToSlot !== null && loser?.entryId) {
    await fillSlot(tx, match.loserToMatchId, match.loserToSlot, loser.entryId);
  }

  /*
   * Grand-final reset. If the losers-bracket side (slot 1) wins the grand
   * final, both sides hold one loss and the reset decides it. A static pointer
   * cannot express that condition, so it lives here — the same place the pure
   * replay puts it.
   */
  if (match.bracket === 'GRAND_FINAL' && !isResetMatch(match) && winner?.entryId) {
    const winnerCameFromLosersBracket = winner.slot === 1;
    if (winnerCameFromLosersBracket) {
      const [reset] = await tx
        .select()
        .from(matches)
        .where(
          and(
            eq(matches.gameId, match.gameId),
            eq(matches.bracket, 'GRAND_FINAL'),
            eq(matches.round, 2),
          ),
        )
        .limit(1);

      if (reset) {
        for (const participant of participants) {
          if (participant.entryId) {
            await fillSlot(tx, reset.id, participant.slot, participant.entryId);
          }
        }
      }
    }
  }
}

async function fillSlot(tx: Tx, matchId: string, slot: number, entryId: string): Promise<void> {
  await tx
    .update(matchParticipants)
    .set({ entryId })
    .where(and(eq(matchParticipants.matchId, matchId), eq(matchParticipants.slot, slot)));

  const participants = await loadParticipants(tx, matchId);
  const filled = participants.filter((participant) => participant.entryId !== null).length;

  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (match?.status === 'COMPLETE') return;

  // SPEC.md §6.1: a match becomes READY when all its slots are filled, and only
  // READY matches enter the queue.
  await tx
    .update(matches)
    .set({ status: filled === 2 ? 'READY' : 'PENDING' })
    .where(eq(matches.id, matchId));
}

// ---------------------------------------------------------------------------
// Placement derivation from the persisted graph
// ---------------------------------------------------------------------------

export type GamePlacements = {
  placements: Placement[];
  championEntryId: string | null;
  /** True when every match that needs a result has one. */
  complete: boolean;
  outstanding: number;
};

/**
 * Placements for a bracket game, read straight out of the persisted rows.
 *
 * The ordering rule itself lives in lib/engine/placement.ts, shared with the
 * pure replay, so brackets and standings cannot drift apart.
 */
export async function derivePlacementsFromDb(
  tx: Tx,
  gameId: string,
  format: string,
): Promise<GamePlacements> {
  const allMatches = await tx
    .select()
    .from(matches)
    .where(eq(matches.gameId, gameId))
    .orderBy(asc(matches.round), asc(matches.slot));

  const allEntries = await tx
    .select({ id: entries.id, seed: entries.seed })
    .from(entries)
    .where(eq(entries.gameId, gameId));

  const seedOf = new Map(allEntries.map((entry) => [entry.id, entry.seed ?? Number.MAX_SAFE_INTEGER]));

  const participantsByMatch = new Map<string, ParticipantRow[]>();
  if (allMatches.length > 0) {
    const rows = await tx
      .select()
      .from(matchParticipants)
      .where(inArray(matchParticipants.matchId, allMatches.map((match) => match.id)));
    for (const row of rows) {
      participantsByMatch.set(row.matchId, [...(participantsByMatch.get(row.matchId) ?? []), row]);
    }
  }

  const eliminations: Elimination[] = [];
  const losersRounds = Math.max(
    0,
    ...allMatches.filter((match) => match.bracket === 'LOSERS').map((match) => match.round),
  );

  let championEntryId: string | null = null;
  let outstanding = 0;

  for (const match of allMatches) {
    const participants = participantsByMatch.get(match.id) ?? [];
    const filled = participants.filter((participant) => participant.entryId !== null).length;
    const decided = match.status === 'COMPLETE';

    // A reset that never activated is not outstanding — it simply never happens.
    const inactiveReset = isResetMatch(match) && filled < 2;
    if (!decided && !inactiveReset && filled === 2) outstanding += 1;
    if (!decided) continue;

    const loser = participants.find(
      (participant) => participant.isWinner === false && participant.entryId !== null,
    );
    if (!loser?.entryId) continue;

    // Where a loss ends a run depends on the format. In double elimination a
    // winners-bracket loss is only a demotion.
    if (format === 'SINGLE_ELIM') {
      eliminations.push({ entryId: loser.entryId, stage: match.round });
    } else if (match.bracket === 'LOSERS') {
      eliminations.push({ entryId: loser.entryId, stage: match.round });
    } else if (match.bracket === 'GRAND_FINAL') {
      eliminations.push({
        entryId: loser.entryId,
        stage: losersRounds + (isResetMatch(match) ? 2 : 1),
      });
    }
  }

  championEntryId = await findChampion(allMatches, participantsByMatch, format);

  const placements = orderPlacements({
    allEntries: allEntries.map((entry) => entry.id),
    eliminations,
    championEntryId,
    seedOf: (entryId) => seedOf.get(entryId) ?? Number.MAX_SAFE_INTEGER,
  });

  return {
    placements,
    championEntryId,
    complete: championEntryId !== null && outstanding === 0,
    outstanding,
  };
}

async function findChampion(
  allMatches: MatchRow[],
  participantsByMatch: Map<string, ParticipantRow[]>,
  format: string,
): Promise<string | null> {
  const winnerOf = (match: MatchRow | undefined) => {
    if (!match || match.status !== 'COMPLETE') return null;
    const participants = participantsByMatch.get(match.id) ?? [];
    return participants.find((participant) => participant.isWinner === true)?.entryId ?? null;
  };

  if (format === 'SINGLE_ELIM') {
    const finalRound = Math.max(
      0,
      ...allMatches.filter((match) => match.bracket === 'WINNERS').map((match) => match.round),
    );
    return winnerOf(
      allMatches.find((match) => match.bracket === 'WINNERS' && match.round === finalRound),
    );
  }

  const reset = allMatches.find((match) => isResetMatch(match));
  const resetWinner = winnerOf(reset);
  if (resetWinner) return resetWinner;

  const grandFinal = allMatches.find(
    (match) => match.bracket === 'GRAND_FINAL' && match.round === 1,
  );
  const grandFinalWinner = winnerOf(grandFinal);
  if (!grandFinalWinner) return null;

  // If the losers side won the grand final, the reset decides it, so there is no
  // champion until the reset is played.
  const participants = grandFinal ? participantsByMatch.get(grandFinal.id) ?? [] : [];
  const winner = participants.find((participant) => participant.isWinner === true);
  if (winner?.slot === 1) return null;

  return grandFinalWinner;
}

// ---------------------------------------------------------------------------
// Writing game_results — SPEC.md §6.5
// ---------------------------------------------------------------------------

export async function writeGameResults(
  tx: Tx,
  gameId: string,
  placements: Placement[],
): Promise<number> {
  const [game] = await tx.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) return 0;

  // Rewritten wholesale, never incremented. SPEC.md §2.
  await tx.delete(gameResults).where(eq(gameResults.gameId, gameId));

  if (placements.length === 0) return 0;

  await tx.insert(gameResults).values(
    placements.map((placement) => ({
      gameId,
      entryId: placement.entryId,
      placement: placement.placement,
      pointsAwarded: pointsForPlacement(game.pointsMatrix, placement.placement),
    })),
  );

  return placements.length;
}

/** Drops a game's computed results, e.g. when an edit invalidates them. */
export async function clearGameResults(tx: Tx, gameId: string): Promise<void> {
  await tx.delete(gameResults).where(eq(gameResults.gameId, gameId));
}

/** How many of a game's matches still need a result. */
export async function countOutstanding(tx: Tx, gameId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(matches)
    .where(and(eq(matches.gameId, gameId), isNotNull(matches.id), sql`${matches.status} <> 'COMPLETE'`));
  return row?.count ?? 0;
}
