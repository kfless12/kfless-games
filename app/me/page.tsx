import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PlayerCard } from '@/app/player-card';
import { canActForTeam, identify } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { players, teams } from '@/lib/db/schema';
import { RATING_FIELDS, TEXT_FIELDS } from '@/lib/profile';

import { ProfileForm, type ProfileFormValues } from './profile-form';
import { PageHeader, SectionHeading, TeamMark } from '@/app/ui';

import { TeamForm } from './team-form';

export const dynamic = 'force-dynamic';

/**
 * SPEC.md §9.1: each player fills in their own card. Nobody does 17 by hand.
 *
 * Read-only by default, editable at `?edit=1`. Most visits here are to look at
 * your own card, not to change it, and landing straight in a form of eight
 * rating boxes and a photo picker invites accidental edits — the save button is
 * one mis-tap away from whatever you last touched. The mode is a query param
 * rather than client state so it survives a reload and is linkable.
 */
export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const identity = await identify();
  if (!identity) redirect('/join');

  const editing = (await searchParams).edit === '1';

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

  /*
   * canActForTeam, not a role comparison. resolveRole returns ADMIN for anyone
   * with is_admin, so an admin who is also a captain never equals 'CAPTAIN' and
   * silently lost the team form — exactly the trap CLAUDE.md invariant 5 and
   * the note in lib/session.ts warn about. The helper is the only thing that
   * knows ADMIN sits above CAPTAIN.
   */
  const canEditTeam = team ? canActForTeam(identity, team.id) : false;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-6">
      <PageHeader
        eyebrow={editing ? 'Editing your card' : 'Your draft card'}
        title={me.fullName}
        action={
          editing ? (
            <Link href="/me" className="btn btn-quiet">
              Done
            </Link>
          ) : (
            <Link href="/" className="btn btn-quiet">
              Home
            </Link>
          )
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
          report before the draft.{' '}
          {!editing && (
            <Link href="/me?edit=1" className="underline">
              Finish it
            </Link>
          )}
        </p>
      )}

      {editing ? (
        <>
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
        </>
      ) : (
        <>
          <Link href="/me?edit=1" className="btn btn-primary w-full text-lg">
            Edit my card
          </Link>

          {/* The same read-only card everyone else sees at /players/<id>. */}
          <PlayerCard player={me} team={team ?? null} />

          {team && (
            <section className="flex flex-col gap-3 border-t-[3px] border-ink pt-6">
              <SectionHeading title="Your team" />
              <Link href={`/teams/${team.id}`} className="card-quiet flex items-center gap-3">
                <TeamMark colorHex={team.colorHex} logoUrl={team.logoUrl} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-black underline">{team.name}</span>
                  {team.motto && (
                    <span className="block truncate text-sm italic text-muted">
                      &ldquo;{team.motto}&rdquo;
                    </span>
                  )}
                </span>
              </Link>
              {canEditTeam && (
                <Link href="/me?edit=1" className="btn w-full">
                  Edit team name, motto and logo
                </Link>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
