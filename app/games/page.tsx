import { asc, sql } from 'drizzle-orm';
import Link from 'next/link';

import { identify } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { games, matches, standingsOverrides } from '@/lib/db/schema';
import { FORMAT_LABELS, type GameFormat } from '@/lib/games';
import { loadHeadToHead, loadScoringData } from '@/lib/engine/submit';
import { buildLeaderboard, type ScoringGame } from '@/lib/scoring';
import { EmptyState, PageHeader, PlacementBadge, SectionHeading, TeamMark } from '@/app/ui';

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
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-6">
      <PageHeader
        eyebrow="Who is winning"
        title="Standings"
        action={
          <Link href="/" className="btn btn-quiet">
            Home
          </Link>
        }
      />

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Leaderboard"
          aside={
            <span className="text-sm text-muted">
              {scoredGames === 0
                ? 'nothing scored yet'
                : `${scoredGames} game${scoredGames === 1 ? '' : 's'} scored`}
            </span>
          }
        />

        {scoredGames === 0 && (
          <EmptyState>
            No points yet. A game pays out when an admin marks it complete.
          </EmptyState>
        )}

        <ol className="flex flex-col gap-2">
          {leaderboard.map((row, index) => (
            <li key={row.teamId} className={index === 0 && scoredGames > 0 ? 'card-hot' : 'card-quiet'}>
              <div className="flex items-center gap-3">
                <PlacementBadge placement={index + 1} />
                <TeamMark colorHex={row.colorHex} logoUrl={row.logoUrl} size={40} />
                <span className="min-w-0 flex-1 truncate text-lg font-black">{row.teamName}</span>
                <span className="shrink-0 text-3xl font-black tabular-nums">
                  {row.totalPoints}
                </span>
              </div>

              <p className="mt-1 flex flex-wrap gap-1.5">
                {row.firsts > 0 && (
                  <span className="chip" style={{ backgroundColor: 'var(--gold)', color: 'var(--ink)' }}>
                    {row.firsts} &times; 1st
                  </span>
                )}
                {row.seconds > 0 && (
                  <span className="chip" style={{ backgroundColor: 'var(--silver)', color: 'var(--ink)' }}>
                    {row.seconds} &times; 2nd
                  </span>
                )}
                {row.perGame.map((game) => (
                  <span key={game.gameId} className="chip chip-quiet">
                    {game.gameName} {game.points}
                  </span>
                ))}
              </p>

              {row.overrideReason && (
                <p className="mt-1 text-sm font-bold">
                  Tie broken by the admin: {row.overrideReason}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Games" />
        {gameRows.length === 0 ? (
          <EmptyState>No games yet. An admin adds them as the weekend goes.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {gameRows.map((game) => {
              const counts = countsByGame.get(game.id);
              const done = game.status === 'COMPLETE';
              return (
                <li key={game.id} className="card-quiet">
                  <Link href={`/games/${game.id}`} className="flex flex-col gap-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-lg font-black underline">{game.name}</span>
                      <span className={`chip ${done ? 'chip-amber' : 'chip-quiet'}`}>
                        {game.status}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <span className="chip chip-quiet">
                        {FORMAT_LABELS[game.format as GameFormat]}
                      </span>
                      {game.station && <span className="chip chip-quiet">{game.station}</span>}
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
        )}
      </section>

      {identity?.role === 'ADMIN' && (
        <Link href="/admin/games" className="btn w-full">
          Manage games
        </Link>
      )}
    </main>
  );
}
