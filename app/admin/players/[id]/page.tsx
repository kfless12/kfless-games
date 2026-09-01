import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProfileForm, type ProfileFormValues } from '@/app/me/profile-form';
import { identify, isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { players } from '@/lib/db/schema';
import { RATING_FIELDS, TEXT_FIELDS } from '@/lib/profile';
import { isUuid } from '@/lib/uuid';
import { PageHeader } from '@/app/ui';

export const dynamic = 'force-dynamic';

/** SPEC.md §9.1: the admin can edit anyone's profile. */
export default async function AdminPlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const identity = await identify();
  if (!isAdmin(identity)) notFound();

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [player] = await getDb().select().from(players).where(eq(players.id, id)).limit(1);
  if (!player) notFound();

  const values: ProfileFormValues = {};
  for (const { key } of TEXT_FIELDS) values[key] = player[key];
  for (const { key } of RATING_FIELDS) values[key] = player[key];
  values.weight = player.weight;
  values.personalRecordBeers = player.personalRecordBeers;
  values.scoutingReport = player.scoutingReport;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-5 py-10">
      <PageHeader
        eyebrow="Admin · editing"
        title={player.fullName}
        action={
          <Link href="/admin" className="btn btn-quiet">
            Console
          </Link>
        }
      />

      <ProfileForm
        playerId={player.id}
        subtitle={player.email}
        photoUrl={player.photoUrl}
        values={values}
        heading="Their card"
      />
    </main>
  );
}
