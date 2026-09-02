import { asc, sql } from 'drizzle-orm';
import Link from 'next/link';

import { identify } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { games, matches } from '@/lib/db/schema';
import { FORMAT_LABELS, type GameFormat } from '@/lib/games';
import { EmptyState, PageHeader, SectionHeading } from '@/app/ui';

export const dynamic = 'force-dynamic';

/**
 * Every game, each one a link to its bracket or table. Its own nav slot per
 * SPEC.md §11; standings moved to /standings. Public and read-only for anyone
 * without a cookie (§3.4).
 */
export default async function GamesPage() {
  const db = getDb();

  const [identity, gameRows, matchCounts] = await Promise.all([
    identify(),
    db.select().from(games).orderBy(asc(games.sortOrder), asc(games.name)),
    db
      .select({
        gameId: matches.gameId,
        total: sql<number>`count(*)::int`,
        complete: sql<number>`count(*) filter (where ${matches.status} = 'COMPLETE')::int`,
      })
      .from(matches)
      .groupBy(matches.gameId),
  ]);

  const countsByGame = new Map(matchCounts.map((row) => [row.gameId, row]));

  // Grouped by day so three days of games do not read as one long list.
  const days = [...new Set(gameRows.map((game) => game.scheduledDay))].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-6">
      <PageHeader
        eyebrow="Every event"
        title="Games"
        action={
          <Link href="/" className="btn btn-quiet">
            Home
          </Link>
        }
      />

      {gameRows.length === 0 ? (
        <EmptyState>No games yet. An admin adds them as the weekend goes.</EmptyState>
      ) : (
        days.map((day) => (
          <section key={day ?? 'unscheduled'} className="flex flex-col gap-3">
            <SectionHeading title={day === null ? 'Not scheduled' : `Day ${day}`} />
            <ul className="flex flex-col gap-2">
              {gameRows
                .filter((game) => game.scheduledDay === day)
                .map((game) => {
                  const counts = countsByGame.get(game.id);
                  const live = game.status === 'ACTIVE';
                  const done = game.status === 'COMPLETE';
                  return (
                    <li key={game.id}>
                      <Link
                        href={`/games/${game.id}`}
                        className={`flex flex-col gap-1 ${live ? 'card' : 'card-quiet'}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-lg font-black underline">{game.name}</span>
                          <span className={`chip ${done ? 'chip-quiet' : live ? 'chip-amber' : 'chip-quiet'}`}>
                            {game.status}
                          </span>
                        </span>
                        <span className="flex flex-wrap gap-1.5">
                          <span className="chip chip-quiet">
                            {FORMAT_LABELS[game.format as GameFormat]}
                          </span>
                          {game.station && <span className="chip chip-quiet">{game.station}</span>}
                          {game.spansMultipleDays && (
                            <span className="chip chip-quiet">spans days</span>
                          )}
                          {counts && (
                            <span className="chip chip-quiet">
                              {counts.complete}/{counts.total} played
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))
      )}

      {identity?.role === 'ADMIN' && (
        <Link href="/admin/games" className="btn w-full">
          Manage games
        </Link>
      )}
    </main>
  );
}
