import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PlayerCard } from '@/app/player-card';
import { PageHeader } from '@/app/ui';
import { isAdmin, requireIdentity } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { players, teams } from '@/lib/db/schema';
import { isUuid } from '@/lib/uuid';

export const dynamic = 'force-dynamic';

/**
 * A player's draft card, read-only. Any signed-in guest may look at any other
 * guest — that is the point of scouting cards — but a credential is required
 * (SPEC.md §3.4): this page is someone's photograph, home town and college. The
 * draft board links here so profiles stay reachable after the pool empties
 * (SPEC.md §5.3).
 */
export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A malformed id must 404, not reach Postgres as a 22P02 and become a 500.
  if (!isUuid(id)) notFound();

  const db = getDb();
  const identity = await requireIdentity();

  const [rows] = await Promise.all([
    db
      .select({ player: players, team: teams })
      .from(players)
      .leftJoin(teams, eq(teams.id, players.teamId))
      .where(eq(players.id, id))
      .limit(1),
  ]);

  const row = rows[0];
  if (!row) notFound();

  const isMe = identity?.personId === row.player.id;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-6">
      <PageHeader
        eyebrow={isMe ? 'Your draft card' : 'Draft card'}
        title={row.player.fullName}
        action={
          <Link href="/draft" className="btn btn-quiet">
            Draft
          </Link>
        }
      />

      <PlayerCard player={row.player} team={row.team} />

      {isMe && (
        <Link href="/me" className="btn btn-primary w-full">
          Edit my card
        </Link>
      )}
      {!isMe && isAdmin(identity) && (
        <Link href={`/admin/players/${row.player.id}`} className="btn w-full">
          Edit this card
        </Link>
      )}
    </main>
  );
}
