import Link from 'next/link';

import { EventMark } from '@/app/ui';

/*
 * Next's own 404 is white text on black with no way out, which is the wrong
 * page to be looking at in sunlight with a drink in the other hand. This one
 * carries no data, so it needs no credential: an unidentified visitor who
 * taps through lands on the join screen like everywhere else.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-6">
      <header className="flex items-center gap-3">
        <EventMark size={52} />
        <div>
          <p className="eyebrow">Nothing here</p>
          <h1 className="display mt-0.5 text-[2.1rem]">Not found</h1>
        </div>
      </header>

      <p className="card-quiet text-base">
        That page does not exist, or the thing it pointed at has been deleted. The queue is
        where the action is.
      </p>

      <div className="flex flex-wrap gap-2">
        <Link href="/queue" className="btn btn-primary">
          Queue
        </Link>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>
    </main>
  );
}
