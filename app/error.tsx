'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { EventMark } from '@/app/ui';

/*
 * The page a thrown server error lands on. Must be a client component (Next
 * requires it so `reset` can re-render the segment), so it cannot read the
 * database — which is fine, since the database may be the problem.
 *
 * Says plainly that nothing was lost. Every result is already in Postgres
 * before a page renders, and a score submission that fails keeps its own
 * "not saved yet" badge, so a crashed page is a display problem, not a data
 * problem. The person reading this is standing in a yard; that is the one
 * thing they need to know.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-6">
      <header className="flex items-center gap-3">
        <EventMark size={52} />
        <div>
          <p className="eyebrow">Something broke</p>
          <h1 className="display mt-0.5 text-[2.1rem]">That didn&apos;t load</h1>
        </div>
      </header>

      <p className="card-shout text-base font-bold">
        The page hit an error. Nothing you entered is lost — results are saved the moment
        they land, and anything still sending keeps its &ldquo;not saved yet&rdquo; badge.
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/queue" className="btn">
          Queue
        </Link>
      </div>

      {error.digest && (
        <p className="font-mono text-xs text-muted">Error id {error.digest}</p>
      )}
    </main>
  );
}
