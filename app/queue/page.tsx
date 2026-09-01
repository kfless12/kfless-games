import Link from 'next/link';

import { Poller } from '@/app/poller';
import { identify, isAdmin } from '@/lib/auth';
import { buildStationQueues, startableMatchIds } from '@/lib/queue';
import { loadQueueMatches } from '@/lib/queue-db';

import { PageHeader } from '@/app/ui';

import { QueueView } from './queue-view';

export const dynamic = 'force-dynamic';

/**
 * The full queue, every station. SPEC.md §7.1 and §11's nav.
 *
 * Public and read-only without a cookie (§3.4) — anyone can see what is on.
 */
export default async function QueuePage() {
  const [identity, matches] = await Promise.all([identify(), loadQueueMatches()]);
  const queues = buildStationQueues(matches);
  const admin = isAdmin(identity);

  /*
   * Which matches this viewer may start. Cosmetic only: app/queue/actions.ts
   * re-checks every call, because a hidden button is not a control.
   */
  /*
   * Startable = on deck at a free station (SPEC.md §7.1), narrowed to matches
   * this viewer is allowed to touch: the admin anywhere, a captain in their own
   * matches. Plus whatever is already under way, so it can be un-started.
   */
  const startable = new Set(startableMatchIds(queues));
  const playing = matches.filter((match) => match.status === 'IN_PROGRESS').map((m) => m.id);

  const mayTouch = (matchId: string) => {
    if (admin) return true;
    if (identity?.role !== 'CAPTAIN' || !identity.teamId) return false;
    const match = matches.find((candidate) => candidate.id === matchId);
    return Boolean(match?.sides.some((side) => side.teamId === identity.teamId));
  };

  const canStart = [...startable, ...playing].filter(mayTouch);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-6">
      <PageHeader
        eyebrow="What's on right now"
        title="Queue"
        action={
          <Link href="/" className="btn btn-quiet">
            Home
          </Link>
        }
      />

      <Poller intervalMs={10_000} />

      <QueueView
        queues={queues}
        myTeamId={identity?.teamId ?? null}
        canStart={canStart}
        isAdmin={admin}
      />
    </main>
  );
}
