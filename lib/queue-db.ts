import { and, asc, eq, inArray, ne } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { entries, games, matchParticipants, matches, teams } from '@/lib/db/schema';
import type { MatchStatus, QueueMatch } from '@/lib/queue';

/**
 * Loads every queueable match with the bits the queue needs, in one pass.
 *
 * Everything the queue does with this is derived in lib/queue.ts, so this is the
 * only database work behind the dashboard and the queue page.
 */
export async function loadQueueMatches(): Promise<QueueMatch[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: matches.id,
      gameId: matches.gameId,
      gameName: games.name,
      gameSortOrder: games.sortOrder,
      gameStatus: games.status,
      station: matches.station,
      bracket: matches.bracket,
      round: matches.round,
      slot: matches.slot,
      status: matches.status,
      queuePosition: matches.queuePosition,
    })
    .from(matches)
    .innerJoin(games, eq(games.id, matches.gameId))
    .where(
      and(
        inArray(matches.status, ['READY', 'IN_PROGRESS']),
        // A game the admin has taken back to DRAFT is not being played.
        ne(games.status, 'DRAFT'),
      ),
    )
    .orderBy(asc(matches.round), asc(matches.slot));

  if (rows.length === 0) return [];

  const sides = await db
    .select({
      matchId: matchParticipants.matchId,
      slot: matchParticipants.slot,
      entryId: matchParticipants.entryId,
      label: entries.label,
      teamId: entries.teamId,
      teamName: teams.name,
      teamColor: teams.colorHex,
    })
    .from(matchParticipants)
    .leftJoin(entries, eq(entries.id, matchParticipants.entryId))
    .leftJoin(teams, eq(teams.id, entries.teamId))
    .where(inArray(matchParticipants.matchId, rows.map((row) => row.id)))
    .orderBy(asc(matchParticipants.slot));

  const sidesByMatch = new Map<string, QueueMatch['sides']>();
  for (const side of sides) {
    sidesByMatch.set(side.matchId, [
      ...(sidesByMatch.get(side.matchId) ?? []),
      {
        entryId: side.entryId,
        label: side.label,
        teamId: side.teamId,
        teamName: side.teamName,
        teamColor: side.teamColor,
      },
    ]);
  }

  return rows.map((row) => ({
    id: row.id,
    gameId: row.gameId,
    gameName: row.gameName,
    gameSortOrder: row.gameSortOrder,
    station: row.station,
    bracket: row.bracket,
    round: row.round,
    slot: row.slot,
    status: row.status as MatchStatus,
    queuePosition: row.queuePosition,
    sides: sidesByMatch.get(row.id) ?? [],
  }));
}

/** The teams with an entry in a match, for the §8 authorization check. */
export async function teamsInMatch(matchId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ teamId: entries.teamId })
    .from(matchParticipants)
    .innerJoin(entries, eq(entries.id, matchParticipants.entryId))
    .where(eq(matchParticipants.matchId, matchId));
  return [...new Set(rows.map((row) => row.teamId))];
}
