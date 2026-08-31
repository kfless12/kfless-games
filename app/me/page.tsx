import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { identify } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { players, teams } from '@/lib/db/schema';
import { RATING_FIELDS, TEXT_FIELDS } from '@/lib/profile';

import { ProfileForm, type ProfileFormValues } from './profile-form';
import { TeamForm } from './team-form';

export const dynamic = 'force-dynamic';

/** SPEC.md §9.1: each player fills in their own card. Nobody does 17 by hand. */
export default async function MePage() {
  const identity = await identify();
  if (!identity) redirect('/join');

  const db = getDb();
  const [me] = await db
    .select()
    .from(players)
    .where(eq(players.id, identity.personId))
    .limit(1);

  if (!me) redirect('/join');

  const [team] = identity.teamId
    ? await db.select().from(teams).where(eq(teams.id, identity.teamId)).limit(1)
    : [];

  const values: ProfileFormValues = {};
  for (const { key } of TEXT_FIELDS) values[key] = me[key];
  for (const { key } of RATING_FIELDS) values[key] = me[key];
  values.weight = me.weight;
  values.personalRecordBeers = me.personalRecordBeers;
  values.scoutingReport = me.scoutingReport;

  const canEditTeam = team && identity.role === 'CAPTAIN' && team.captainId === identity.personId;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-5 py-10">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-muted">Me</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">{me.fullName}</h1>
        </div>
        <Link href="/" className="text-base font-bold underline">
          Home
        </Link>
      </header>

      {!me.profileComplete && (
        <p className="rounded-lg border-2 border-ink p-4 text-base font-semibold">
          Your card isn&apos;t finished. It needs a photo, all eight ratings, and a scouting
          report before the draft.
        </p>
      )}

      <ProfileForm
        playerId={me.id}
        subtitle={me.email}
        photoUrl={me.photoUrl}
        values={values}
        heading="Your card"
      />

      {canEditTeam && (
        <section className="border-t-2 border-rule pt-8">
          <TeamForm
            teamId={team.id}
            name={team.name}
            motto={team.motto}
            logoUrl={team.logoUrl}
            colorHex={team.colorHex}
          />
        </section>
      )}
    </main>
  );
}
