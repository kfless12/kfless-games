import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState, PageHeader, PlacementBadge, SectionHeading, TeamMark } from '@/app/ui';
import { canActForTeam, identify } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { players, standingsOverrides, teams } from '@/lib/db/schema';
import { loadHeadToHead, loadScoringData } from '@/lib/engine/submit';
import { buildLeaderboard, type ScoringGame } from '@/lib/scoring';
import { isUuid } from '@/lib/uuid';

export const dynamic = 'force-dynamic';

/**
 * A team's profile: identity, where it sits, and the roster. Public per
 * SPEC.md §3.4.
 *
 * The points come from buildLeaderboard rather than a query of their own, so
 * this page and /standings can never disagree — same derivation, same
 * tie-breakers (CLAUDE.md invariant 1).
 */
export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const db = getDb();
  const [identity, teamRows, roster, scoring, headToHead, overrides] = await Promise.all([
    identify(),
    db.select().from(teams).where(eq(teams.id, id)).limit(1),
    db
      .select()
      .from(players)
      .where(eq(players.teamId, id))
      // Captain first, then draft order, so the roster reads the way it was built.
      .orderBy(asc(players.draftPickNumber), asc(players.fullName)),
    loadScoringData(),
    loadHeadToHead(),
    db.select().from(standingsOverrides),
  ]);

  const team = teamRows[0];
  if (!team) notFound();

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

  const position = leaderboard.findIndex((row) => row.teamId === team.id);
  const standing = position === -1 ? null : leaderboard[position];

  const captains = roster.filter((player) => player.isCaptain);
  const drafted = roster.filter((player) => !player.isCaptain);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-6">
      <PageHeader
        eyebrow="Team"
        title={team.name}
        action={
          <Link href="/standings" className="btn btn-quiet">
            Standings
          </Link>
        }
      />

      <section className="card flex items-center gap-4">
        <TeamMark colorHex={team.colorHex} logoUrl={team.logoUrl} size={72} />
        <div className="min-w-0 flex-1">
          {team.motto ? (
            <p className="text-lg font-bold italic leading-tight">
              &ldquo;{team.motto}&rdquo;
            </p>
          ) : (
            <p className="text-base text-muted">No motto yet.</p>
          )}
          <p className="mt-1 text-sm text-muted">
            Draft position {team.draftPosition} &middot; {roster.length} player
            {roster.length === 1 ? '' : 's'}
          </p>
        </div>
      </section>

      {standing && (
        <section className="flex flex-col gap-3">
          <SectionHeading title="Where they stand" />
          <div className="card-quiet flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <PlacementBadge placement={position + 1} />
              <span className="flex-1 text-base font-bold">
                {position === 0 ? 'Leading' : `${position + 1} of ${leaderboard.length}`}
              </span>
              <span className="text-3xl font-black tabular-nums">{standing.totalPoints}</span>
            </div>

            <p className="flex flex-wrap gap-1.5">
              {standing.firsts > 0 && (
                <span className="chip" style={{ backgroundColor: 'var(--gold)', color: 'var(--ink)' }}>
                  {standing.firsts} &times; 1st
                </span>
              )}
              {standing.seconds > 0 && (
                <span
                  className="chip"
                  style={{ backgroundColor: 'var(--silver)', color: 'var(--ink)' }}
                >
                  {standing.seconds} &times; 2nd
                </span>
              )}
              {standing.perGame.length === 0 ? (
                <span className="text-base text-muted">No points scored yet.</span>
              ) : (
                standing.perGame.map((game) => (
                  <Link key={game.gameId} href={`/games/${game.gameId}`} className="chip chip-quiet">
                    {game.gameName} {game.points}
                  </Link>
                ))
              )}
            </p>

            {standing.overrideReason && (
              <p className="text-sm font-bold">Tie broken by the admin: {standing.overrideReason}</p>
            )}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionHeading title="Roster" aside={<span className="text-sm text-muted">tap for a card</span>} />

        {roster.length === 0 ? (
          <EmptyState>Nobody on this team yet. The draft fills it in.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...captains, ...drafted].map((player) => (
              <li key={player.id}>
                <Link href={`/players/${player.id}`} className="card-quiet flex items-center gap-3">
                  {player.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={player.photoUrl} alt="" className="team-logo size-12 rounded-full" />
                  ) : (
                    <div
                      aria-hidden
                      className="size-12 shrink-0 rounded-full border-2 border-dashed border-rule"
                    />
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-black underline">
                      {player.fullName}
                    </span>
                    {player.nickname && (
                      <span className="block truncate text-sm text-muted">
                        &ldquo;{player.nickname}&rdquo;
                      </span>
                    )}
                  </span>

                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {player.isCaptain && <span className="chip chip-quiet">Captain</span>}
                    {player.isMisterIrrelevant && (
                      <span className="chip chip-amber">Irrelevant</span>
                    )}
                    {player.draftPickNumber !== null && !player.isMisterIrrelevant && (
                      <span className="text-sm tabular-nums text-muted">
                        #{player.draftPickNumber}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        Only for the viewer's OWN team. canActForTeam is true for an admin on
        every team, but /me edits the team the viewer belongs to — offering it
        here on someone else's team would send them somewhere that edits the
        wrong one. The admin console is the route for editing another team.
      */}
      {identity?.teamId === team.id && canActForTeam(identity, team.id) && (
        <Link href="/me" className="btn btn-primary w-full">
          Edit this team
        </Link>
      )}
    </main>
  );
}
