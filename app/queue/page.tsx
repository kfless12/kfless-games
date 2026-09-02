import Link from 'next/link';

import { Poller } from '@/app/poller';
import { identify, isAdmin } from '@/lib/auth';
import { authorizeQueueStart, buildStationQueues, startableMatchIds } from '@/lib/queue';
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
   * Startable = on deck at a free station (SPEC.md §7.1), plus whatever is
   * already under way so it can be un-started.
   *
   * Who may touch it comes from authorizeQueueStart — the same function the
   * action uses, not a second copy of the rule. §7.1 now allows the admin or
   * ANY team captain, not only a captain playing in the match, and when this
   * page kept its own version the button and the action disagreed.
   */
  const startable = new Set(startableMatchIds(queues));
  const playing = matches.filter((match) => match.status === 'IN_PROGRESS').map((m) => m.id);

  const mayStart = authorizeQueueStart(identity).allowed;
  const canStart = mayStart ? [...startable, ...playing] : [];

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
