import { sql } from 'drizzle-orm';

import { getDb } from './index';

export type DatabaseHealth =
  | { ok: true; serverVersion: string; tables: number; players: number }
  | { ok: false; error: string };

/**
 * Liveness check: proves the app can reach Postgres and that migrations have
 * been applied.
 *
 * Returns a result rather than throwing so callers can render an honest failure
 * state instead of a 500. Stale or broken data presented as fine is worse than
 * an honest error — SPEC.md §7.3.
 */
export async function checkDatabase(): Promise<DatabaseHealth> {
  try {
    const db = getDb();

    const version = await db.execute<{ version: string }>(sql`select version()`);
    const tables = await db.execute<{ count: string }>(
      sql`select count(*)::text as count
          from information_schema.tables
          where table_schema = 'public'`,
    );
    const players = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from players`,
    );

    return {
      ok: true,
      serverVersion: version.rows[0]?.version?.split(' ').slice(0, 2).join(' ') ?? 'unknown',
      tables: Number(tables.rows[0]?.count ?? 0),
      players: Number(players.rows[0]?.count ?? 0),
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * Drizzle wraps driver errors and its own message ("Failed query: ...") hides
 * the part that actually says what went wrong, e.g. ECONNREFUSED. Walk the
 * cause chain so the visible message is diagnosable.
 */
function describe(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  while (current instanceof Error && parts.length < 4) {
    const line = current.message.split('\n')[0]?.trim();
    if (line && !parts.includes(line)) parts.push(line);
    current = current.cause;
  }

  if (parts.length === 0) return String(error);
  return parts.join(' ← ');
}
