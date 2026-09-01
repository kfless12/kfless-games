import Link from 'next/link';

import { getDb } from '@/lib/db';
import { standingsOverrides } from '@/lib/db/schema';
import { loadHeadToHead, loadScoringData } from '@/lib/engine/submit';
import { buildLeaderboard, type ScoringGame } from '@/lib/scoring';
import { EmptyState, PageHeader, PlacementBadge, SectionHeading, TeamMark } from '@/app/ui';

export const dynamic = 'force-dynamic';

/**
 * Standings. Its own nav slot per SPEC.md §11 — split from the games list,
 * because "who is winning" and "what is being played" are different questions
 * and stacking both under one tab buried the games. Public and read-only for
 * anyone without a cookie (§3.4).
 *
 * Every team is a link through to its profile and roster.
 */
export default async function StandingsPage() {
  const db = getDb();

  const [scoring, headToHead, overrides] = await Promise.all([
    loadScoringData(),
    loadHeadToHead(),
    db.select().from(standingsOverrides),
  ]);

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
          <Link href="/games" className="btn btn-quiet">
            Games
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
            <li key={row.teamId}>
              <Link
                href={`/teams/${row.teamId}`}
                className={`block ${index === 0 && scoredGames > 0 ? 'card-hot' : 'card-quiet'}`}
              >
                <span className="flex items-center gap-3">
                  <PlacementBadge placement={index + 1} />
                  <TeamMark colorHex={row.colorHex} logoUrl={row.logoUrl} size={40} />
                  <span className="min-w-0 flex-1 truncate text-lg font-black underline">
                    {row.teamName}
                  </span>
                  <span className="shrink-0 text-3xl font-black tabular-nums">
                    {row.totalPoints}
                  </span>
                </span>

                <span className="mt-1 flex flex-wrap gap-1.5">
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
                </span>

                {row.overrideReason && (
                  <span className="mt-1 block text-sm font-bold">
                    Tie broken by the admin: {row.overrideReason}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <p className="text-sm text-muted">
        Tap a team for its roster and player cards.
      </p>
    </main>
  );
}
