import { asc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState, PageHeader, SectionHeading, TeamMark } from '@/app/ui';
import { canActForTeam, identify, isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { entries, games, players, teams } from '@/lib/db/schema';
import { shortEntryLabel } from '@/lib/entries';
import { isUuid } from '@/lib/uuid';

import { EntryForm, type LineupPlayer } from './entry-form';

export const dynamic = 'force-dynamic';

/**
 * The lineup console. SPEC.md §4.4: captains fill in which of their players
 * take each entry, once the admin has scheduled the game and the entries exist.
 *
 * A captain sees their own team only; the admin sees all four, because at the
 * event the admin will end up doing it for whoever has not.
 */
export default async function LineupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const db = getDb();
  const [game] = await db.select().from(games).where(eq(games.id, id)).limit(1);
  if (!game) notFound();

  const identity = await identify();
  const admin = isAdmin(identity);

  const [gameEntries, teamRows] = await Promise.all([
    db
      .select({
        id: entries.id,
        label: entries.label,
        playerIds: entries.playerIds,
        teamId: entries.teamId,
      })
      .from(entries)
      .where(eq(entries.gameId, id))
      .orderBy(asc(entries.label)),
    db.select().from(teams).orderBy(asc(teams.draftPosition)),
  ]);

  // Only the teams this person may actually act for — the rest would be a form
  // that always refuses. saveLineup re-checks server-side regardless.
  const editableTeams = teamRows.filter((team) => canActForTeam(identity, team.id));

  const roster = await db
    .select({
      id: players.id,
      fullName: players.fullName,
      nickname: players.nickname,
      teamId: players.teamId,
    })
    .from(players)
    .where(
      editableTeams.length > 0
        ? inArray(
            players.teamId,
            editableTeams.map((team) => team.id),
          )
        : eq(players.id, '00000000-0000-0000-0000-000000000000'),
    )
    .orderBy(asc(players.draftPickNumber), asc(players.fullName));

  const wholeTeamGame = game.entriesPerTeam === 1;

  const nameById = new Map(
    (
      await db
        .select({ id: players.id, fullName: players.fullName })
        .from(players)
    ).map((row) => [row.id, row.fullName]),
  );

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-6">
      <PageHeader
        eyebrow="Who is playing"
        title={`${game.name} lineup`}
        action={
          <Link href={`/games/${game.id}`} className="btn btn-quiet">
            Game
          </Link>
        }
      />

      {!identity && (
        <EmptyState>
          Sign in with your link to set a lineup. Anyone can look at the game itself.
        </EmptyState>
      )}

      {identity && editableTeams.length === 0 && (
        <EmptyState>
          Only a team captain or the admin can set a lineup. You can still see who is playing on
          the game page.
        </EmptyState>
      )}

      {identity && editableTeams.length > 0 && gameEntries.length === 0 && (
        <EmptyState>
          This game has no entries yet. The admin schedules the game first, which is what creates
          them.
        </EmptyState>
      )}

      {wholeTeamGame && editableTeams.length > 0 && gameEntries.length > 0 && (
        <p className="card-hot text-base font-bold">
          {game.name} is played by the whole team, so there is one entry per team and nothing to
          divide up. Naming players here is optional — it only changes who gets the &ldquo;you&rsquo;re
          up&rdquo; nudge.
        </p>
      )}

      {editableTeams.map((team) => {
        const teamEntries = gameEntries.filter((entry) => entry.teamId === team.id);
        if (teamEntries.length === 0) return null;

        const teamRoster: LineupPlayer[] = roster
          .filter((player) => player.teamId === team.id)
          .map(({ id: playerId, fullName, nickname }) => ({ id: playerId, fullName, nickname }));

        return (
          <section key={team.id} className="flex flex-col gap-3">
            <SectionHeading
              title={team.name}
              aside={<TeamMark colorHex={team.colorHex} logoUrl={team.logoUrl} size={28} />}
            />

            {teamRoster.length === 0 ? (
              <EmptyState>
                Nobody on this team yet — the draft fills it in before lineups matter.
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {teamEntries.map((entry) => (
                  <EntryForm
                    key={entry.id}
                    entry={{
                      id: entry.id,
                      label: entry.label,
                      shortLabel:
                        shortEntryLabel(
                          {
                            label: entry.label,
                            teamName: team.name,
                            teamDraftPosition: team.draftPosition,
                            playerNames: (entry.playerIds ?? [])
                              .map((playerId) => nameById.get(playerId))
                              .filter((name): name is string => name !== undefined),
                          },
                          wholeTeamGame,
                        ) ?? entry.label,
                      playerIds: entry.playerIds ?? [],
                    }}
                    roster={teamRoster}
                    entrySize={game.entrySize}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <p className="text-sm text-muted">
        Optional. Leave an entry blank and the whole team gets the nudge, and the captain can still
        report the score either way.
        {admin && ' As admin you can set any team’s lineup.'}
      </p>
    </main>
  );
}
