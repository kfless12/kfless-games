import { and, asc, eq, inArray, ne } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { entries, games, matchParticipants, matches, players, teams } from '@/lib/db/schema';
import { shortEntryLabel } from '@/lib/entries';
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
      entriesPerTeam: games.entriesPerTeam,
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
      playerIds: entries.playerIds,
      teamId: entries.teamId,
      teamName: teams.name,
      teamColor: teams.colorHex,
      teamDraftPosition: teams.draftPosition,
    })
    .from(matchParticipants)
    .leftJoin(entries, eq(entries.id, matchParticipants.entryId))
    .leftJoin(teams, eq(teams.id, entries.teamId))
    .where(inArray(matchParticipants.matchId, rows.map((row) => row.id)))
    .orderBy(asc(matchParticipants.slot));

  /*
   * Names for the assigned players, in one query rather than per entry. Only
   * needed for the initials in the short label (SPEC.md §7.4).
   */
  const assignedIds = [...new Set(sides.flatMap((side) => side.playerIds ?? []))];
  const nameById = new Map<string, string>();
  if (assignedIds.length > 0) {
    const named = await db
      .select({ id: players.id, fullName: players.fullName })
      .from(players)
      .where(inArray(players.id, assignedIds));
    for (const row of named) nameById.set(row.id, row.fullName);
  }

  const wholeTeamByMatch = new Map(rows.map((row) => [row.id, row.entriesPerTeam === 1]));

  const sidesByMatch = new Map<string, QueueMatch['sides']>();
  for (const side of sides) {
    const playerIds = side.playerIds ?? [];
    sidesByMatch.set(side.matchId, [
      ...(sidesByMatch.get(side.matchId) ?? []),
      {
        entryId: side.entryId,
        label: side.label,
        shortLabel:
          side.entryId === null
            ? null
            : shortEntryLabel(
                {
                  label: side.label,
                  teamName: side.teamName,
                  teamDraftPosition: side.teamDraftPosition,
                  // Drop ids with no name rather than rendering "?" for them.
                  playerNames: playerIds
                    .map((id) => nameById.get(id))
                    .filter((name): name is string => name !== undefined),
                },
                wholeTeamByMatch.get(side.matchId) ?? false,
              ),
        teamId: side.teamId,
        teamName: side.teamName,
        teamColor: side.teamColor,
        playerIds,
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
    wholeTeamGame: row.entriesPerTeam === 1,
    sides: sidesByMatch.get(row.id) ?? [],
  }));
}

