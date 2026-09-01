import { asc, sql } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { identify, isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { entries, games, matches } from '@/lib/db/schema';
import { formatPointsMatrix, type GameFormat } from '@/lib/games';

import { GameForm } from './game-form';
import { EmptyState, PageHeader } from '@/app/ui';

import { GameRow, type GameRowData } from './game-row';

export const dynamic = 'force-dynamic';

/** SPEC.md §4.3: games are admin-managed and can be added at any time. */
export default async function AdminGamesPage() {
  const identity = await identify();
  if (!isAdmin(identity)) notFound();

  const db = getDb();

  const rows = await db
    .select()
    .from(games)
    .orderBy(asc(games.sortOrder), asc(games.name));

  /*
   * Counts come from their own grouped queries rather than correlated
   * subqueries inside the select. The subquery form silently returned zero for
   * every game — the table reference inside the sql template did not bind to
   * the outer row — and a bracket that exists but reads as "0 matches" is
   * exactly the kind of quiet wrongness worth avoiding.
   */
  const [entryCounts, matchCounts] = await Promise.all([
    db
      .select({ gameId: entries.gameId, count: sql<number>`count(*)::int` })
      .from(entries)
      .groupBy(entries.gameId),
    db
      .select({
        gameId: matches.gameId,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${matches.status} = 'COMPLETE')::int`,
      })
      .from(matches)
      .groupBy(matches.gameId),
  ]);

  const entriesByGame = new Map(entryCounts.map((row) => [row.gameId, row.count]));
  const matchesByGame = new Map(
    matchCounts.map((row) => [row.gameId, { total: row.total, completed: row.completed }]),
  );

  const list: GameRowData[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    format: row.format as GameFormat,
    entriesPerTeam: row.entriesPerTeam,
    entrySize: row.entrySize,
    pointsMatrix: formatPointsMatrix(row.pointsMatrix),
    pointsPerWin: row.pointsPerWin,
    entryAggregation: row.entryAggregation,
    scheduledDay: row.scheduledDay,
    station: row.station,
    sortOrder: row.sortOrder,
    spansMultipleDays: row.spansMultipleDays,
    rules: row.rules,
    status: row.status,
    entryCount: entriesByGame.get(row.id) ?? 0,
    matchCount: matchesByGame.get(row.id)?.total ?? 0,
    completedCount: matchesByGame.get(row.id)?.completed ?? 0,
  }));

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-6">
      <PageHeader
        eyebrow="Add them as you go"
        title="Games"
        action={
          <Link href="/admin" className="btn btn-quiet">
            Console
          </Link>
        }
      />

      <p className="text-base text-muted">
        Add games as you go. Scheduling one builds its entries and its whole match graph up
        front, so results only ever fill in slots that already exist.
      </p>

      <GameForm mode="create" />

      {list.length === 0 ? (
        <EmptyState>
          No games yet. Beer pong is double elimination with 2 entries per team.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((game) => (
            <GameRow key={game.id} game={game} />
          ))}
        </ul>
      )}
    </main>
  );
}
