import { redirect } from 'next/navigation';

import { identify } from '@/lib/auth';

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
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-5 py-12">
      <header>
        <h1 className="text-4xl font-black tracking-tight">kfless games</h1>
        <p className="mt-2 text-lg text-muted">Tap your link, or enter your code.</p>
      </header>

      {invalid === 'link' && (
        <p className="rounded-lg border-2 border-ink bg-ink p-4 text-base font-semibold text-paper">
          That link isn&apos;t recognised. It may have been replaced — enter your 6-digit
          code instead, or ask for a new link.
        </p>
      )}

      <JoinForm />

      <p className="text-base text-muted">
        No code? Whoever is running the games has the list.
      </p>
    </main>
  );
}
