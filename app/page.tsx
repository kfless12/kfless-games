import { eq } from 'drizzle-orm';
import Link from 'next/link';

import { signOut } from '@/app/join/actions';
import { Poller } from '@/app/poller';
import { identify, isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkDatabase } from '@/lib/db/health';
import { players, standingsOverrides, teams } from '@/lib/db/schema';
import { loadHeadToHead, loadScoringData } from '@/lib/engine/submit';
import {
  buildStationQueues,
  findMyMatches,
  findYoureUp,
  type QueueMatch,
  type YoureUp,
} from '@/lib/queue';
import { loadQueueMatches } from '@/lib/queue-db';
import { buildLeaderboard, type ScoringGame } from '@/lib/scoring';
import { EmptyState, EventMark, PlacementBadge, SectionHeading, TeamMark } from '@/app/ui';

export const dynamic = 'force-dynamic';

/**
 * The player dashboard. SPEC.md §7.2 makes this the landing page for anyone with
 * a cookie: the "you're up" banner, their next matches, the live queue, and a
 * standings snapshot.
 *
 * Public without a cookie — SPEC.md §3.4 gives PUBLIC read-only access to
 * everything but the admin console and the draft-pick action.
 */
export default async function Dashboard() {
  const [identity, database] = await Promise.all([identify(), checkDatabase()]);

  if (!database.ok) {
    return (
      <Shell>
        <p className="rounded-lg border-2 border-ink bg-ink p-4 font-mono text-sm text-paper">
          {database.error}
        </p>
      </Shell>
    );
  }

  const db = getDb();

  const [queueMatches, scoring, headToHead, overrides] = await Promise.all([
    loadQueueMatches(),
    loadScoringData(),
    loadHeadToHead(),
    db.select().from(standingsOverrides),
  ]);

  const queues = buildStationQueues(queueMatches);
  const myTeamId = identity?.teamId ?? null;
  const youreUp = findYoureUp(queues, myTeamId);
  const myMatches = findMyMatches(queueMatches, myTeamId);

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

  const [me] = identity
    ? await db
        .select({ fullName: players.fullName, photoUrl: players.photoUrl, teamName: teams.name })
        .from(players)
        .leftJoin(teams, eq(players.teamId, teams.id))
        .where(eq(players.id, identity.personId))
        .limit(1)
    : [];

  return (
    <Shell>
      {/* SPEC.md §7.2: large and unmissable, with the station name. */}
      {youreUp.length > 0 && <YoureUpBanner hits={youreUp} />}

      {identity && me ? (
        <section className="card-quiet flex flex-wrap items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-3">
            {me.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={me.photoUrl}
                alt=""
                className="team-logo size-12 rounded-full"
              />
            ) : null}
            <span className="min-w-0">
              <span className="block truncate text-lg font-black leading-tight">
                {me.fullName}
              </span>
              <span className="block truncate text-sm text-muted">
                {me.teamName ?? 'Not yet drafted'} &middot; {identity.role}
              </span>
            </span>
          </span>
          <form action={signOut}>
            <button type="submit" className="btn btn-quiet">
              Sign out
            </button>
          </form>
        </section>
      ) : (
        <section className="card">
          <p className="text-base">
            Everything here is public. Your own card, the draft, and reporting a result need
            your link.
          </p>
          <Link href="/join" className="btn btn-primary mt-3 w-full">
            Sign in
          </Link>
        </section>
      )}

      <Poller intervalMs={10_000} />

      {myMatches.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeading title="Your next matches" />
          <ul className="card flex flex-col gap-3">
            {myMatches.slice(0, 6).map((match) => (
              <li key={match.id} className="flex items-start justify-between gap-3">
                <Link href={`/games/${match.gameId}`} className="min-w-0 font-bold underline">
                  {match.sides.map((side) => side.label ?? 'TBC').join('  v  ')}
                </Link>
                <span className="shrink-0 text-right text-xs font-bold uppercase tracking-wide text-muted">
                  {match.gameName}
                  <br />
                  {match.station ?? 'no station'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Live queue"
          aside={
            <Link href="/queue" className="text-sm font-black uppercase tracking-wide underline">
              All stations
            </Link>
          }
        />

        {queues.length === 0 ? (
          <EmptyState>
            Nothing is on yet. Matches appear the moment a game is scheduled.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {queues.map((queue) => (
              <li key={queue.station} className="card-quiet">
                <p className="text-base font-black uppercase tracking-wide">{queue.station}</p>
                <dl className="mt-2 flex flex-col gap-1 text-base">
                  <QueueLine label="Now" match={queue.nowPlaying} myTeamId={myTeamId} />
                  <QueueLine label="On deck" match={queue.onDeck} myTeamId={myTeamId} />
                  <QueueLine label="In the hole" match={queue.inTheHole} myTeamId={myTeamId} />
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeading
          title="Standings"
          aside={
            <Link href="/standings" className="text-sm font-black uppercase tracking-wide underline">
              Full table
            </Link>
          }
        />
        <ol className="card flex flex-col gap-2">
          {leaderboard.map((row, index) => (
            <li key={row.teamId}>
              <Link href={`/teams/${row.teamId}`} className="flex items-center gap-3">
                <PlacementBadge placement={index + 1} />
                <TeamMark colorHex={row.colorHex} logoUrl={row.logoUrl} size={32} />
                <span className="min-w-0 flex-1 truncate font-bold underline">{row.teamName}</span>
                <span className="shrink-0 text-2xl font-black tabular-nums">
                  {row.totalPoints}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {isAdmin(identity) && (
        <Link href="/admin" className="btn w-full">
          Admin console
        </Link>
      )}
    </Shell>
  );
}

/** SPEC.md §7.2: large, unmissable, and names the station. */
function YoureUpBanner({ hits }: { hits: YoureUp[] }) {
  const onNow = hits.some((hit) => hit.slot === 'NOW_PLAYING');

  return (
    <section role="alert" className="card-shout foam-edge mt-3">
      <p className="display text-[2.6rem] text-amber-bright">
        {onNow ? "You're up" : "You're next"}
      </p>

      <ul className="mt-2 flex flex-col gap-3">
        {hits.map((hit) => (
          <li key={`${hit.match.id}-${hit.slot}`}>
            <p className="text-sm font-black uppercase tracking-widest text-amber-bright">
              {hit.slot === 'NOW_PLAYING' ? 'On now' : 'On deck'} &middot; {hit.station}
            </p>
            <p className="text-lg font-bold leading-tight">
              {hit.match.sides.map((side) => side.label ?? 'TBC').join('  v  ')}
            </p>
            <p className="text-sm opacity-80">{hit.match.gameName}</p>
          </li>
        ))}
      </ul>

      <Link href="/queue" className="btn btn-primary mt-4 w-full">
        Take me there
      </Link>
    </section>
  );
}

function QueueLine({
  label,
  match,
  myTeamId,
}: {
  label: string;
  match: QueueMatch | null;
  myTeamId: string | null;
}) {
  const isMine =
    match !== null && myTeamId !== null && match.sides.some((side) => side.teamId === myTeamId);

  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-sm font-bold uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`text-right ${isMine ? 'font-black' : ''}`}>
        {match ? match.sides.map((side) => side.label ?? 'TBC').join(' v ') : '—'}
      </dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-6">
      <header className="flex items-center gap-3">
        <EventMark size={52} />
        <div>
          <p className="eyebrow">Three days &middot; four teams &middot; seventeen players</p>
          <h1 className="display mt-0.5 text-[2.1rem]">kfless games</h1>
        </div>
      </header>
      {children}
    </main>
  );
}
