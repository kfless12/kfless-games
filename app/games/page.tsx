import { asc, sql } from 'drizzle-orm';
import Link from 'next/link';

import { identify } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { games, matches, standingsOverrides } from '@/lib/db/schema';
import { FORMAT_LABELS, type GameFormat } from '@/lib/games';
import { loadHeadToHead, loadScoringData } from '@/lib/engine/submit';
import { buildLeaderboard, type ScoringGame } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

/**
 * Games and standings. SPEC.md §11 gives this a nav slot; public and read-only
 * for anyone without a cookie (§3.4).
 */
export default async function GamesPage() {
  const db = getDb();

  const [identity, scoring, headToHead, overrides, gameRows, matchCounts] = await Promise.all([
    identify(),
    loadScoringData(),
    loadHeadToHead(),
    db.select().from(standingsOverrides),
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

  const leaderboard = buildLeaderboard({
    teams: scoring.teams,
    games: scoring.games as unknown as ScoringGame[],
    entries: scoring.entries,
    results: scoring.results,
    headToHead,
    overrides: overrides.map((row) => ({
      teamId: row.teamId,
      priority: row.priority,
      reason: row.reason,
    })),
  });

  const scoredGames = scoring.games.filter((game) => game.status === 'COMPLETE').length;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-5 py-10">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-muted">Standings</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">Games</h1>
        </div>
        <Link href="/" className="text-base font-bold underline">
          Home
        </Link>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">
          Leaderboard
          <span className="ml-2 text-base font-normal text-muted">
            {scoredGames === 0
              ? 'nothing scored yet'
              : `${scoredGames} game${scoredGames === 1 ? '' : 's'} scored`}
          </span>
        </h2>

        <ol className="flex flex-col gap-2">
          {leaderboard.map((row, index) => (
            <li
              key={row.teamId}
              className="flex flex-col gap-1 rounded-lg border-2 border-rule p-4"
            >
              <div className="flex items-center gap-3">
                <span className="w-6 shrink-0 text-lg font-black tabular-nums">{index + 1}</span>
                {row.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.logoUrl}
                    alt=""
                    className="size-9 shrink-0 rounded-lg border-2 border-rule object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="inline-block size-4 shrink-0 rounded-full"
                    style={{ backgroundColor: row.colorHex }}
                  />
                )}
                <span className="min-w-0 flex-1 text-lg font-bold">{row.teamName}</span>
                <span className="shrink-0 text-2xl font-black tabular-nums">
                  {row.totalPoints}
                </span>
              </div>

              <p className="pl-9 text-sm text-muted">
                {row.firsts} first{row.firsts === 1 ? '' : 's'} &middot; {row.seconds} second
                {row.seconds === 1 ? '' : 's'}
                {row.perGame.length > 0 &&
                  ` · ${row.perGame.map((game) => `${game.gameName} ${game.points}`).join(', ')}`}
              </p>

              {row.overrideReason && (
                <p className="pl-9 text-sm font-semibold">
                  Tie broken by the admin: {row.overrideReason}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Games</h2>
        {gameRows.length === 0 ? (
          <p className="rounded-lg border-2 border-rule p-4 text-base">No games yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {gameRows.map((game) => {
              const counts = countsByGame.get(game.id);
              return (
                <li key={game.id} className="rounded-lg border-2 border-rule p-4">
                  <Link href={`/games/${game.id}`} className="flex flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-lg font-bold underline">{game.name}</span>
                      <span className="text-sm font-bold uppercase tracking-wide text-muted">
                        {game.status}
                      </span>
                    </span>
                    <span className="text-base text-muted">
                      {FORMAT_LABELS[game.format as GameFormat]}
                      {game.station && ` · ${game.station}`}
                      {counts && ` · ${counts.complete}/${counts.total} played`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {identity?.role === 'ADMIN' && (
        <Link
          href="/admin/games"
          className="flex h-12 items-center justify-center rounded-lg border-2 border-ink text-base font-bold"
        >
          Manage games
        </Link>
      )}
    </main>
  );
}
