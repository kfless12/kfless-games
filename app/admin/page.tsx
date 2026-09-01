import { asc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import Link from 'next/link';

import { identify, isAdmin, listCredentials } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { players, teams } from '@/lib/db/schema';

import { PageHeader, SectionHeading } from '@/app/ui';

import { CredentialTable } from './credential-table';
import { ElevateForm } from './elevate-form';

export const dynamic = 'force-dynamic';

/** Absolute origin, so a copied link still works when pasted into a message. */
async function currentOrigin() {
  const store = await headers();
  const host = store.get('x-forwarded-host') ?? store.get('host') ?? 'localhost:3000';
  const proto =
    store.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function AdminPage() {
  const identity = await identify();

  // Server-side gate. SPEC.md §3.4: the admin console is the one thing PUBLIC
  // does not get to read.
  if (!identity) {
    return (
      <Shell>
        <p className="text-lg">Sign in with your own link or code first, then come back.</p>
      </Shell>
    );
  }

  if (!isAdmin(identity)) {
    return (
      <Shell>
        <p className="text-lg">
          This console is admin-only. If you are the admin and this device does not know it,
          enter the admin credential.
        </p>
        <ElevateForm />
      </Shell>
    );
  }

  const db = getDb();
  const roster = await db
    .select({
      id: players.id,
      fullName: players.fullName,
      email: players.email,
      isCaptain: players.isCaptain,
      isAdmin: players.isAdmin,
      profileComplete: players.profileComplete,
      teamName: teams.name,
      teamColor: teams.colorHex,
    })
    .from(players)
    .leftJoin(teams, eq(players.teamId, teams.id))
    .orderBy(asc(players.fullName));

  const [credentials, origin] = await Promise.all([listCredentials(), currentOrigin()]);
  const credentialByPlayer = new Map(credentials.map((c) => [c.playerId, c]));

  const rows = roster.map((player) => {
    const credential = credentialByPlayer.get(player.id);
    return {
      id: player.id,
      fullName: player.fullName,
      email: player.email,
      role: player.isAdmin ? 'ADMIN' : player.isCaptain ? 'CAPTAIN' : 'PLAYER',
      teamName: player.teamName,
      teamColor: player.teamColor,
      profileComplete: player.profileComplete,
      joinUrl: credential ? `${origin}${credential.joinPath}` : null,
      joinCode: credential?.joinCode ?? null,
    };
  });

  const withoutCredential = rows.filter((row) => !row.joinUrl).length;
  const profilesDone = rows.filter((row) => row.profileComplete).length;

  return (
    <Shell>
      <nav className="flex flex-wrap gap-2">
        <Link href="/admin/games" className="btn">
          Games &amp; brackets
        </Link>
        <Link href="/draft" className="btn">
          Draft board
        </Link>
        <Link href="/queue" className="btn">
          Queue
        </Link>
      </nav>

      <dl className="card flex flex-wrap gap-x-8 gap-y-2 text-base">
        <Stat label="Players" value={`${rows.length} / 17`} />
        <Stat label="Profiles complete" value={`${profilesDone} / ${rows.length}`} />
        <Stat
          label="Missing a credential"
          value={withoutCredential === 0 ? 'none' : String(withoutCredential)}
        />
      </dl>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Credentials" />
        <p className="text-base text-muted">
          Send each person their link once, from your own inbox. The 6-digit code is the
          fallback for anyone who can&apos;t find the email in the yard. Each row also shows
          whether that person has finished their card, and lets you edit it for them.
        </p>
        <CredentialTable rows={rows} />
      </section>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="text-xl font-black tabular-nums">{value}</dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-6">
      <PageHeader
        eyebrow="Admin only"
        title="Console"
        action={
          <Link href="/" className="btn btn-quiet">
            Home
          </Link>
        }
      />
      {children}
    </main>
  );
}
