'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/*
 * SPEC.md §5.2: the draft page polls every 5 seconds while LIVE — faster than
 * the event-day 10s, since people are staring at it.
 *
 * router.refresh() re-runs the server component, so the board has exactly one
 * source of truth and there is no separate JSON endpoint to keep in step.
 *
 * The visibilitychange refetch matters more than the interval: phones suspend
 * background tabs, so a returning user would otherwise be looking at whatever
 * the board said when they locked their phone. SPEC.md §7.3 calls this the most
 * likely real-world bug in the whole app.
 *
 * This component triggers the refetch, so it also owns the "updated Xs ago"
 * reading: a tick counts up, and each refetch resets it. No timestamps, so
 * there is no clock to disagree with.
 */
export function DraftPoller({ intervalMs, active }: { intervalMs: number; active: boolean }) {
  const router = useRouter();
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => {
    if (!active) return;

    function refetch() {
      router.refresh();
      setSecondsAgo(0);
    }

    const poll = setInterval(refetch, intervalMs);
    const tick = setInterval(() => setSecondsAgo((seconds) => seconds + 1), 1000);

    function onVisible() {
      if (document.visibilityState === 'visible') refetch();
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, intervalMs, active]);

  if (!active) return null;

  return (
    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
      <span aria-hidden className="size-2 rounded-full bg-amber-bright" />
      Updated {secondsAgo === 0 ? 'just now' : `${secondsAgo}s ago`}
    </p>
  );
}
