import { asc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CompleteControls } from '@/app/games/complete-controls';
import { FfaForm, type FfaEntry } from '@/app/games/ffa-form';
import { MatchCard, type MatchCardData } from '@/app/games/match-card';
import { identify, isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { entries, gameResults, games, matchParticipants, matches, teams } from '@/lib/db/schema';
import { roundRobinStandings } from '@/lib/engine/submit';
import { FORMAT_LABELS, formatPointsMatrix, type GameFormat } from '@/lib/games';
import { isUuid } from '@/lib/uuid';

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

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-5 py-10">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-muted">
            {FORMAT_LABELS[game.format as GameFormat]}
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">{game.name}</h1>
        </div>
        <Link href="/games" className="text-base font-bold underline">
          Standings
        </Link>
      </header>

      <p className="text-base text-muted">
        {game.status}
        {game.station && ` · ${game.station}`}
        {game.scheduledDay !== null && ` · day ${game.scheduledDay}`}
        {' · '}points {formatPointsMatrix(game.pointsMatrix)}
      </p>

      {allMatches.length === 0 && (
        <p className="rounded-lg border-2 border-rule p-4 text-base">
          Not scheduled yet. An admin builds the bracket from{' '}
          <Link href="/admin/games" className="underline">
            manage games
          </Link>
          .
        </p>
      )}

      {results.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">Final placings</h2>
          <ol className="flex flex-col gap-1">
            {results.map((result) => (
              <li
                key={result.entryId}
                className="flex items-baseline justify-between gap-3 border-b border-rule pb-1 text-base"
              >
                <span>
                  <span className="mr-2 font-black tabular-nums">{result.placement}</span>
                  {entryById.get(result.entryId)?.label ?? 'Unknown'}
                </span>
                <span className="font-bold tabular-nums">{result.pointsAwarded} pts</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {admin && allMatches.length > 0 && (
        <CompleteControls gameId={game.id} status={game.status} outstanding={outstanding} />
      )}

      {rr && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">Table</h2>
          <ul className="flex flex-col gap-1">
            {rr.outcome.standings.map((row, index) => (
              <li
                key={row.entryId}
                className="flex items-baseline justify-between gap-3 border-b border-rule pb-1 text-base"
              >
                <span>
                  <span className="mr-2 font-bold tabular-nums">{index + 1}</span>
                  {entryById.get(row.entryId)?.label ?? 'Unknown'}
                </span>
                <span className="tabular-nums text-muted">
                  {row.wins}W {row.losses}L &middot; {row.differential > 0 ? '+' : ''}
                  {row.differential}
                </span>
              </li>
            ))}
          </ul>
          {rr.outcome.unresolvedTies.length > 0 && (
            <p className="rounded-lg border-2 border-ink p-3 text-base font-semibold">
              {rr.outcome.unresolvedTies[0].length} entries are level on wins, head-to-head and
              differential. SPEC calls for a coin flip &mdash; the admin decides.
            </p>
          )}
        </section>
      )}

      {heat && ffaEntries.length > 0 && admin && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">Finishing order</h2>
          <FfaForm matchId={heat.id} entries={ffaEntries} />
        </section>
      )}

      {!heat && cards.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">Matches</h2>
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
