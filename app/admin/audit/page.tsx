import { desc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { isAdmin, requireIdentity } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { auditLog, games, players, teams } from '@/lib/db/schema';
import { isUuid } from '@/lib/uuid';
import { EmptyState, PageHeader } from '@/app/ui';

import { LocalTime } from './local-time';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

/**
 * The audit trail, newest first. SPEC.md §4.8: "Viewable by admin."
 *
 * Every score, undo, draft pick, game change and credential change lands here
 * (lib/audit.ts), so when someone says "who changed that?" on Saturday night
 * the answer is a tap away rather than a psql session. Read-only, paged
 * through the oldest-first index that already exists on `timestamp`.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const identity = await requireIdentity();
  if (!isAdmin(identity)) notFound();

  const { page: pageRaw } = await searchParams;
  const page = /^\d+$/.test(pageRaw ?? '') ? Math.max(1, Number(pageRaw)) : 1;

  const db = getDb();

  // One extra row tells us whether an older page exists, without a count.
  const rows = await db
    .select({
      id: auditLog.id,
      timestamp: auditLog.timestamp,
      actorName: players.fullName,
      actorRole: auditLog.actorRole,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .leftJoin(players, eq(players.id, auditLog.actorPersonId))
    .orderBy(desc(auditLog.timestamp), desc(auditLog.id))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);

  const hasOlder = rows.length > PAGE_SIZE;
  const entries = rows.slice(0, PAGE_SIZE);

  /*
   * Targets are stored as type + id. Names for the three kinds people will
   * actually ask about are looked up in one query each; the rest (matches,
   * entries, stations) show the type and a short id, which is enough to match
   * against the before/after payload.
   */
  const idsOf = (type: string) =>
    [...new Set(entries.filter((row) => row.targetType === type).map((row) => row.targetId))].filter(
      (id): id is string => id !== null && isUuid(id),
    );

  const [gameIds, teamIds, playerIds] = [idsOf('game'), idsOf('team'), idsOf('player')];

  const [gameRows, teamRows, playerRows] = await Promise.all([
    gameIds.length > 0
      ? db.select({ id: games.id, name: games.name }).from(games).where(inArray(games.id, gameIds))
      : [],
    teamIds.length > 0
      ? db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds))
      : [],
    playerIds.length > 0
      ? db
          .select({ id: players.id, name: players.fullName })
          .from(players)
          .where(inArray(players.id, playerIds))
      : [],
  ]);

  const nameFor = new Map<string, string>();
  for (const row of [...gameRows, ...teamRows, ...playerRows]) nameFor.set(row.id, row.name);

  const describeTarget = (type: string | null, id: string | null): string | null => {
    if (!type) return null;
    if (id && nameFor.has(id)) return `${type} · ${nameFor.get(id)}`;
    if (id) return `${type} · ${id.slice(0, 8)}`;
    return type;
  };

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-6">
      <PageHeader
        eyebrow="Who did what"
        title="Audit log"
        action={
          <Link href="/admin" className="btn btn-quiet">
            Console
          </Link>
        }
      />

      <p className="text-base text-muted">
        Every score, undo, pick, game change and credential change, newest first. Tap a row
        for what it changed.
      </p>

      {entries.length === 0 ? (
        <EmptyState>
          {page === 1 ? 'Nothing has happened yet.' : 'Nothing older than this.'}
        </EmptyState>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((row) => {
            const target = describeTarget(row.targetType, row.targetId);
            const hasPayload = row.before != null || row.after != null;
            return (
              <li key={row.id} className="card-quiet">
                <details>
                  <summary className={`flex flex-col gap-1 ${hasPayload ? 'cursor-pointer' : ''}`}>
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className="font-mono text-base font-bold">{row.action}</span>
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">
                        <LocalTime iso={row.timestamp.toISOString()} />
                      </span>
                    </span>
                    <span className="text-sm text-muted">
                      {row.actorName ?? 'nobody signed in'}
                      {row.actorRole && ` (${row.actorRole.toLowerCase()})`}
                      {target && ` → ${target}`}
                    </span>
                  </summary>
                  {hasPayload && (
                    <div className="mt-2 flex flex-col gap-2 border-t-2 border-rule pt-2">
                      <Payload label="Before" value={row.before} />
                      <Payload label="After" value={row.after} />
                    </div>
                  )}
                </details>
              </li>
            );
          })}
        </ol>
      )}

      <nav aria-label="Pages" className="flex justify-between gap-2">
        {page > 1 ? (
          <Link href={`/admin/audit?page=${page - 1}`} className="btn">
            Newer
          </Link>
        ) : (
          <span />
        )}
        {hasOlder && (
          <Link href={`/admin/audit?page=${page + 1}`} className="btn">
            Older
          </Link>
        )}
      </nav>
    </main>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
