import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { identify } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { players, teams } from '@/lib/db/schema';
import { RATING_FIELDS, TEXT_FIELDS } from '@/lib/profile';

import { ProfileForm, type ProfileFormValues } from './profile-form';
import { PageHeader } from '@/app/ui';

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
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-6">
      <PageHeader
        eyebrow="Your draft card"
        title={me.fullName}
        action={
          <Link href="/" className="btn btn-quiet">
            Home
          </Link>
        }
      />

      {/*
        SPEC.md §1.1: the label "is displayed on their profile card and roster
        row". The roster row is on the draft page; this is the card.
      */}
      {me.isMisterIrrelevant && (
        <p className="card-hot flex flex-wrap items-center gap-2 text-base font-bold">
          <span className="chip chip-amber">Mister Irrelevant</span>
          Pick {me.draftPickNumber} — the last pick of the draft. It cannot be edited away.
        </p>
      )}

      {!me.profileComplete && (
        <p className="card-hot text-base font-bold">
          Your card isn&apos;t finished — it needs a photo, all eight ratings and a scouting
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
        <section className="border-t-[3px] border-ink pt-6">
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
