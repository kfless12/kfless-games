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
        <section className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-3">
            {me.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={me.photoUrl}
                alt=""
                className="size-11 shrink-0 rounded-full border-2 border-rule object-cover"
              />
            ) : null}
            <span>
              <span className="block text-lg font-bold leading-tight">{me.fullName}</span>
              <span className="block text-sm text-muted">
                {me.teamName ?? 'Not yet drafted'} &middot; {identity.role}
              </span>
            </span>
          </span>
          <span className="flex gap-2">
            <Link href="/me" className="flex h-11 items-center rounded-lg border-2 border-rule px-3 text-base font-bold">
              Me
            </Link>
            <form action={signOut}>
              <button type="submit" className="h-11 rounded-lg border-2 border-rule px-3 text-base font-bold">
                Sign out
              </button>
            </form>
          </span>
        </section>
      ) : (
        <section className="rounded-lg border-2 border-rule p-4">
          <p className="text-base">
            You&apos;re not signed in. Everything here is public; your own card, the draft, and
            reporting a result need your link.
          </p>
          <Link
            href="/join"
            className="mt-3 flex h-12 w-full items-center justify-center rounded-lg bg-ink text-base font-bold text-paper"
          >
            Sign in
          </Link>
        </section>
      )}

      <Poller intervalMs={10_000} />

      {myMatches.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">Your next matches</h2>
          <ul className="flex flex-col gap-1">
            {myMatches.slice(0, 6).map((match) => (
              <li
                key={match.id}
                className="flex items-baseline justify-between gap-3 border-b border-rule pb-1 text-base"
              >
                <Link href={`/games/${match.gameId}`} className="underline">
                  {match.sides.map((side) => side.label ?? 'TBC').join(' v ')}
                </Link>
                <span className="shrink-0 text-right text-sm text-muted">
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
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold">Live queue</h2>
          <Link href="/queue" className="text-base font-bold underline">
            All stations
          </Link>
        </div>

        {queues.length === 0 ? (
          <p className="rounded-lg border-2 border-rule p-4 text-base">
            Nothing is on yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {queues.map((queue) => (
              <li key={queue.station} className="rounded-lg border-2 border-rule p-4">
                <p className="text-base font-bold">{queue.station}</p>
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
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold">Standings</h2>
          <Link href="/games" className="text-base font-bold underline">
            Games
          </Link>
        </div>
        <ol className="flex flex-col gap-1">
          {leaderboard.map((row, index) => (
            <li
              key={row.teamId}
              className="flex items-center gap-3 border-b border-rule pb-1 text-base"
            >
              <span className="w-5 shrink-0 font-bold tabular-nums">{index + 1}</span>
              <span
                aria-hidden
                className="inline-block size-3 shrink-0 rounded-full"
                style={{ backgroundColor: row.colorHex }}
              />
              <span className="min-w-0 flex-1 font-semibold">{row.teamName}</span>
              <span className="shrink-0 text-lg font-black tabular-nums">{row.totalPoints}</span>
            </li>
          ))}
        </ol>
      </section>

      <nav className="flex flex-wrap gap-2 border-t-2 border-rule pt-4">
        <NavLink href="/queue">Queue</NavLink>
        <NavLink href="/games">Games &amp; standings</NavLink>
        <NavLink href="/draft">Draft &amp; rosters</NavLink>
        {identity && <NavLink href="/me">Me</NavLink>}
        {isAdmin(identity) && <NavLink href="/admin">Admin</NavLink>}
      </nav>
    </Shell>
  );
}

/** SPEC.md §7.2: large, unmissable, and names the station. */
function YoureUpBanner({ hits }: { hits: YoureUp[] }) {
  return (
    <section
      role="alert"
      className="rounded-lg border-4 border-ink bg-ink p-5 text-paper"
    >
      <p className="text-3xl font-black uppercase tracking-tight">
        {hits.some((hit) => hit.slot === 'NOW_PLAYING') ? "You're up" : "You're next"}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {hits.map((hit) => (
          <li key={`${hit.match.id}-${hit.slot}`} className="text-lg font-bold">
            {hit.slot === 'NOW_PLAYING' ? 'Now' : 'On deck'} at{' '}
            <span className="underline">{hit.station}</span>
            <span className="block text-base font-normal">
              {hit.match.gameName} &middot;{' '}
              {hit.match.sides.map((side) => side.label ?? 'TBC').join(' v ')}
            </span>
          </li>
        ))}
      </ul>
      <Link
        href="/queue"
        className="mt-3 flex h-12 items-center justify-center rounded-lg bg-paper text-base font-bold text-ink"
      >
        Open the queue
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

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex h-11 items-center rounded-lg border-2 border-ink px-4 text-base font-bold"
    >
      {children}
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-5 py-8">
      <header>
        <p className="text-sm font-bold uppercase tracking-widest text-muted">Phase 6</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">kfless games</h1>
      </header>
      {children}
    </main>
  );
}
