'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/*
 * Polling. SPEC.md §7.3.
 *
 * 10 seconds on the dashboard and the queue, 5 on the draft. router.refresh()
 * re-runs the server component, so there is one source of truth and no separate
 * JSON shape to keep in step.
 *
 * Three things the spec asks for and why they matter:
 *
 *   - The visibilitychange refetch. Phones suspend background tabs, so somebody
 *     coming back to the app would otherwise be reading whatever the screen said
 *     when they locked it. §7.3 calls this the most likely real-world bug in the
 *     whole app.
 *   - "Last updated Xs ago", counted from the last successful fetch.
 *   - A reconnecting state. refresh() cannot fail visibly, so each tick pings
 *     /api/pulse first: if that fails the badge says so instead of the page
 *     quietly going stale. Stale data presented as current is worse than an
 *     honest error.
 */

export function Poller({
  intervalMs = 10_000,
  label = 'Updated',
}: {
  intervalMs?: number;
  label?: string;
}) {
  const router = useRouter();
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refetch() {
      try {
        const response = await fetch('/api/pulse', { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        if (cancelled) return;
        setOffline(false);
        setSecondsAgo(0);
        router.refresh();
      } catch {
        if (!cancelled) setOffline(true);
      }
    }

    const poll = setInterval(refetch, intervalMs);
    const tick = setInterval(() => setSecondsAgo((seconds) => seconds + 1), 1000);

    function onVisible() {
      if (document.visibilityState === 'visible') void refetch();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', () => void refetch());

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, intervalMs]);

  if (offline) {
    return (
      <p role="status" className="card-shout px-3 py-2 text-sm font-bold">
        Can&apos;t reach the server — reconnecting. Last update {secondsAgo}s ago.
      </p>
    );
  }

  return (
    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
      <span aria-hidden className="size-2 rounded-full bg-amber-bright" />
      {label} {secondsAgo === 0 ? 'just now' : `${secondsAgo}s ago`}
    </p>
  );
}
