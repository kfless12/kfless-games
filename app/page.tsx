import { checkDatabase } from '@/lib/db/health';

// Reads the database on every request; nothing here is prerenderable.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const database = await checkDatabase();

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-5 py-12">
      <header>
        <p className="text-sm font-bold uppercase tracking-widest text-muted">Phase 0</p>
        <h1 className="mt-1 text-4xl font-black tracking-tight">kfless games</h1>
        <p className="mt-2 text-lg text-muted">
          Three days. Four teams. Seventeen players.
        </p>
      </header>

      <section className="rounded-lg border-2 border-rule p-5">
        <h2 className="text-xl font-bold">Skeleton check</h2>
        <dl className="mt-4 flex flex-col gap-3 text-base">
          <Row label="Next.js + Tailwind" value="rendering" ok />
          <Row
            label="Postgres"
            value={database.ok ? `connected · ${database.serverVersion}` : 'unreachable'}
            ok={database.ok}
          />
          <Row
            label="Migrations"
            value={
              database.ok
                ? `applied · ${database.migratedTables} table${database.migratedTables === 1 ? '' : 's'}`
                : 'unknown'
            }
            ok={database.ok}
          />
        </dl>

        {!database.ok && (
          <p className="mt-4 rounded border-2 border-ink bg-ink p-3 font-mono text-sm text-paper">
            {database.error}
          </p>
        )}
      </section>

      <p className="text-base text-muted">
        Nothing else is built yet. Build order is <code className="font-mono">SPEC.md §14</code>;
        Phase 1 is data and auth.
      </p>
    </main>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-3 last:border-0">
      <dt className="font-semibold">{label}</dt>
      <dd className="flex items-center gap-2 text-right">
        <span className="text-muted">{value}</span>
        <span aria-hidden className="text-lg font-black">
          {ok ? '✓' : '✕'}
        </span>
        <span className="sr-only">{ok ? 'ok' : 'failed'}</span>
      </dd>
    </div>
  );
}
