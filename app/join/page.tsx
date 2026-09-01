import { redirect } from 'next/navigation';

import { identify } from '@/lib/auth';

import { EventMark } from '@/app/ui';

import { JoinForm } from './join-form';

export const dynamic = 'force-dynamic';

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ invalid?: string }>;
}) {
  const identity = await identify();
  if (identity) redirect('/');

  const { invalid } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <EventMark size={96} />
        <h1 className="display text-[2.6rem]">kfless games</h1>
        <p className="text-lg text-muted">Tap your link, or punch in your code.</p>
      </header>

      {invalid === 'link' && (
        <p className="card-shout text-base font-bold">
          That link isn&apos;t recognised. It may have been replaced — enter your 6-digit
          code instead, or ask for a new link.
        </p>
      )}

      <JoinForm />

      <p className="text-center text-base text-muted">
        No code? Whoever is running the games has the list.
      </p>
    </main>
  );
}
