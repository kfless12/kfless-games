import { asc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BracketView } from '@/app/games/bracket-view';
import { CompleteControls } from '@/app/games/complete-controls';
import { FfaForm, type FfaEntry } from '@/app/games/ffa-form';
import { MatchCard, type MatchCardData } from '@/app/games/match-card';
import { identify, isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { entries, gameResults, games, matchParticipants, matches, teams } from '@/lib/db/schema';
import { roundRobinStandings } from '@/lib/engine/submit';
import { FORMAT_LABELS, formatPointsMatrix, type GameFormat } from '@/lib/games';
import { isUuid } from '@/lib/uuid';
import { EmptyState, PageHeader, PlacementBadge, SectionHeading } from '@/app/ui';

export const dynamic = 'force-dynamic';

const BRACKET_LABELS: Record<string, string> = {
  WINNERS: 'Winners',
  LOSERS: 'Losers',
  GRAND_FINAL: 'Grand final',
  RR: 'Round robin',
  HEAT: 'Heat',
};

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const db = getDb();
  const [game] = await db.select().from(games).where(eq(games.id, id)).limit(1);
  if (!game) notFound();

  const identity = await identify();
  const admin = isAdmin(identity);

  const [allMatches, gameEntries, results] = await Promise.all([
    db
      .select()
      .from(matches)
      .where(eq(matches.gameId, id))
      .orderBy(asc(matches.bracket), asc(matches.round), asc(matches.slot)),
    db
      .select({
        id: entries.id,
        label: entries.label,
        seed: entries.seed,
        teamId: entries.teamId,
        teamName: teams.name,
        teamColor: teams.colorHex,
      })
      .from(entries)
      .innerJoin(teams, eq(teams.id, entries.teamId))
      .where(eq(entries.gameId, id)),
    db
      .select({
        entryId: gameResults.entryId,
        placement: gameResults.placement,
        pointsAwarded: gameResults.pointsAwarded,
      })
      .from(gameResults)
      .where(eq(gameResults.gameId, id))
      .orderBy(asc(gameResults.placement)),
  ]);

  const entryById = new Map(gameEntries.map((entry) => [entry.id, entry]));

  const participants =
    allMatches.length > 0
      ? await db
          .select()
          .from(matchParticipants)
          .where(inArray(matchParticipants.matchId, allMatches.map((match) => match.id)))
          .orderBy(asc(matchParticipants.slot))
      : [];

  const participantsByMatch = new Map<string, typeof participants>();
  for (const row of participants) {
    participantsByMatch.set(row.matchId, [...(participantsByMatch.get(row.matchId) ?? []), row]);
  }

  const cards: MatchCardData[] = allMatches.map((match) => ({
    id: match.id,
    bracket: match.bracket,
    round: match.round,
    slot: match.slot,
    status: match.status,
    station: match.station,
    sides: (participantsByMatch.get(match.id) ?? []).map((participant) => {
      const entry = participant.entryId ? entryById.get(participant.entryId) : undefined;
      return {
        entryId: participant.entryId,
        label: entry?.label ?? null,
        teamName: entry?.teamName ?? null,
        teamColor: entry?.teamColor ?? null,
        score: participant.score,
        isWinner: participant.isWinner,
      };
    }),
  }));

  /*
   * SPEC.md §8: the admin, or a captain of either team in the match. Worked out
   * per match, since a captain may report their own matches but not others'.
   * lib/engine/submit.ts re-checks it server-side regardless.
   */
  const canReport = (match: MatchCardData) => {
    if (admin) return true;
    if (identity?.role !== 'CAPTAIN' || !identity.teamId) return false;
    return match.sides.some(
      (side) => side.entryId && entryById.get(side.entryId)?.teamId === identity.teamId,
    );
  };

  const outstanding = allMatches.filter((match) => {
    if (match.status === 'COMPLETE') return false;
    const filled = (participantsByMatch.get(match.id) ?? []).filter((p) => p.entryId !== null);
    // A reset that never activated is not outstanding.
    if (match.bracket === 'GRAND_FINAL' && match.round === 2 && filled.length < 2) return false;
    return true;
  }).length;

  const heat = game.format === 'RANKED_FFA' ? allMatches[0] : null;
  const ffaEntries: FfaEntry[] = heat
    ? (participantsByMatch.get(heat.id) ?? []).map((participant) => {
        const entry = participant.entryId ? entryById.get(participant.entryId) : undefined;
        return {
          entryId: participant.entryId ?? '',
          label: entry?.label ?? 'Unknown',
          teamColor: entry?.teamColor ?? null,
          placement: participant.rank,
          rawScore: participant.score,
        };
      })
    : [];

  const rr = game.format === 'ROUND_ROBIN' ? await roundRobinStandings(id) : null;

  const isBracket = game.format === 'DOUBLE_ELIM' || game.format === 'SINGLE_ELIM';

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-6">
      <PageHeader
        eyebrow={FORMAT_LABELS[game.format as GameFormat]}
        title={game.name}
        action={
          <Link href="/games" className="btn btn-quiet">
            Back
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        <span className={`chip ${game.status === 'COMPLETE' ? 'chip-amber' : 'chip-quiet'}`}>
          {game.status}
        </span>
        {game.station && <span className="chip chip-quiet">{game.station}</span>}
        {game.scheduledDay !== null && (
          <span className="chip chip-quiet">Day {game.scheduledDay}</span>
        )}
        <span className="chip chip-quiet">
          {game.format === 'ROUND_ROBIN'
            ? game.pointsPerWin === null
              ? 'points per win not set'
              : `${game.pointsPerWin} per win`
            : formatPointsMatrix(game.pointsMatrix)}
        </span>
      </div>

      {allMatches.length === 0 && (
        <EmptyState>
          Not scheduled yet — nothing to play until an admin builds it from{' '}
          <Link href="/admin/games" className="font-bold underline">
            manage games
          </Link>
          .
        </EmptyState>
      )}

      {results.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeading title="Final placings" />
          <ol className="card flex flex-col gap-2">
            {results.map((result) => {
              const entry = entryById.get(result.entryId);
              return (
                <li key={result.entryId} className="flex items-center gap-3">
                  <PlacementBadge placement={result.placement} />
                  <span
                    aria-hidden
                    className="swatch"
                    style={{ backgroundColor: entry?.teamColor ?? 'transparent' }}
                  />
                  <span className="min-w-0 flex-1 truncate font-bold">
                    {entry?.label ?? 'Unknown'}
                  </span>
                  <span className="shrink-0 text-lg font-black tabular-nums">
                    {result.pointsAwarded}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {admin && allMatches.length > 0 && (
        <CompleteControls gameId={game.id} status={game.status} outstanding={outstanding} />
      )}

      {rr && (
        <section className="flex flex-col gap-2">
          <SectionHeading
            title="Table"
            aside={<span className="text-sm text-muted">wins decide the points</span>}
          />
          <ul className="card flex flex-col gap-2">
            {rr.outcome.standings.map((row, index) => {
              const entry = entryById.get(row.entryId);
              return (
                <li key={row.entryId} className="flex items-center gap-3">
                  <PlacementBadge placement={index + 1} />
                  <span
                    aria-hidden
                    className="swatch"
                    style={{ backgroundColor: entry?.teamColor ?? 'transparent' }}
                  />
                  <span className="min-w-0 flex-1 truncate font-bold">
                    {entry?.label ?? 'Unknown'}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted">
                    {row.wins}W {row.losses}L &middot; {row.differential > 0 ? '+' : ''}
                    {row.differential}
                  </span>
                </li>
              );
            })}
          </ul>
          {rr.outcome.unresolvedTies.length > 0 && (
            <p className="card-hot text-base font-bold">
              {rr.outcome.unresolvedTies[0].length} entries are level on wins, head-to-head and
              differential. That needs a coin flip &mdash; the admin decides.
            </p>
          )}
        </section>
      )}

      {heat && ffaEntries.length > 0 && admin && (
        <section className="flex flex-col gap-3">
          <SectionHeading title="Finishing order" />
          <FfaForm matchId={heat.id} entries={ffaEntries} />
        </section>
      )}

      {isBracket && cards.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeading
            title="Bracket"
            aside={<span className="text-sm text-muted">swipe sideways</span>}
          />
          <BracketView matches={cards} />
        </section>
      )}

      {!heat && cards.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeading title="Matches" />
          <ul className="flex flex-col gap-3">
            {cards.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                canReport={canReport(match)}
                label={`${BRACKET_LABELS[match.bracket] ?? match.bracket} round ${match.round}`}
              />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
