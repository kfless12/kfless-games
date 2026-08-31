import { asc, eq, isNull } from 'drizzle-orm';
import Link from 'next/link';

import { signOut } from '@/app/join/actions';
import { identify, isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkDatabase } from '@/lib/db/health';
import { players, teams } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * Phase 1 landing page: proves who you are and that the roster is real.
 *
 * SPEC.md §7.2 makes the player dashboard the landing page for anyone with a
 * cookie, but that is Phase 6 — the queue does not exist yet.
 */
export default async function Home() {
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
  const [me] = identity
    ? await db
        .select({
          fullName: players.fullName,
          photoUrl: players.photoUrl,
          profileComplete: players.profileComplete,
          teamName: teams.name,
          teamColor: teams.colorHex,
        })
        .from(players)
        .leftJoin(teams, eq(players.teamId, teams.id))
        .where(eq(players.id, identity.personId))
        .limit(1)
    : [];

  const roster = await db
    .select({
      id: teams.id,
      name: teams.name,
      colorHex: teams.colorHex,
      draftPosition: teams.draftPosition,
      logoUrl: teams.logoUrl,
      captain: players.fullName,
    })
    .from(teams)
    .innerJoin(players, eq(teams.captainId, players.id))
    .orderBy(asc(teams.draftPosition));

  const undrafted = await db
    .select({ id: players.id })
    .from(players)
    .where(isNull(players.teamId));

  return (
    <Shell>
      {identity && me ? (
        <section className="rounded-lg border-2 border-ink p-5">
          <p className="text-sm font-bold uppercase tracking-widest text-muted">Signed in as</p>
          <div className="mt-1 flex items-center gap-3">
            {me.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={me.photoUrl}
                alt=""
                className="size-14 shrink-0 rounded-full border-2 border-rule object-cover"
              />
            ) : null}
            <p className="text-2xl font-black">{me.fullName}</p>
          </div>
          <p className="mt-1 flex items-center gap-2 text-base text-muted">
            {me.teamName ? (
              <>
                <span
                  aria-hidden
                  className="inline-block size-3.5 rounded-full border border-rule"
                  style={{ backgroundColor: me.teamColor ?? undefined }}
                />
                {me.teamName}
              </>
            ) : (
              'Not yet drafted'
            )}
            <span aria-hidden>·</span>
            {identity.role}
          </p>
          {!me.profileComplete && (
            <p className="mt-3 text-base font-semibold">
              Your card isn&apos;t finished &mdash; it needs a photo, all eight ratings, and a
              scouting report.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/me"
              className="flex h-11 items-center rounded-lg border-2 border-ink px-4 text-base font-bold"
            >
              {me.profileComplete ? 'Edit my card' : 'Finish my card'}
            </Link>
            <Link
              href="/draft"
              className="flex h-11 items-center rounded-lg border-2 border-ink px-4 text-base font-bold"
            >
              Draft board
            </Link>
            {isAdmin(identity) && (
              <Link
                href="/admin"
                className="flex h-11 items-center rounded-lg border-2 border-ink px-4 text-base font-bold"
              >
                Admin console
              </Link>
            )}
            <form action={signOut}>
              <button
                type="submit"
                className="h-11 rounded-lg border-2 border-rule px-4 text-base font-bold"
              >
                Sign out
              </button>
            </form>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border-2 border-rule p-5">
          <p className="text-lg">
            You&apos;re not signed in. Everything below is public; your own card and the draft
            need your link.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Link
              href="/join"
              className="flex h-14 w-full items-center justify-center rounded-lg bg-ink text-lg font-bold text-paper"
            >
              Sign in
            </Link>
            <Link
              href="/draft"
              className="flex h-12 w-full items-center justify-center rounded-lg border-2 border-ink text-base font-bold"
            >
              Watch the draft
            </Link>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Teams</h2>
        <ul className="flex flex-col gap-2">
          {roster.map((team) => (
            <li
              key={team.id}
              className="flex items-center gap-3 rounded-lg border-2 border-rule p-4"
            >
              {team.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={team.logoUrl}
                  alt=""
                  className="size-10 shrink-0 rounded-lg border-2 border-rule object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="inline-block size-5 shrink-0 rounded-full border border-rule"
                  style={{ backgroundColor: team.colorHex }}
                />
              )}
              <span className="flex-1">
                <span className="block text-lg font-bold">{team.name}</span>
                <span className="block text-base text-muted">{team.captain}</span>
              </span>
              <span className="text-sm font-bold uppercase tracking-wide text-muted">
                Pick {team.draftPosition}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-base text-muted">
          {undrafted.length} player{undrafted.length === 1 ? '' : 's'} still in the pool.
        </p>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-5 py-10">
      <header>
        <p className="text-sm font-bold uppercase tracking-widest text-muted">Phase 3</p>
        <h1 className="mt-1 text-4xl font-black tracking-tight">kfless games</h1>
      </header>
      {children}
    </main>
  );
}
