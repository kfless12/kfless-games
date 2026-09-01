import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { databaseUrl } from '@/lib/env';

import * as schema from './schema';

/**
 * A single pg Pool per process, created lazily.
 *
 * Lazily, because throwing at import time would break `next build` on any host
 * that builds without DATABASE_URL set.
 *
 * A connection pool is not application state — it holds no draft, queue, or
 * match data, so this does not conflict with the stateless rule in SPEC.md
 * §10.2. All actual state lives in Postgres.
 *
 * In dev the pool is parked on globalThis so Next's hot reload does not leak a
 * new pool on every edit.
 */
declare global {
  var __kflessPool: Pool | undefined;
}

let pool: Pool | undefined;

/*
 * TEMPORARY — SPEC.md §16, the Cloudflare Workers demo. Delete this whole block
 * (and the branch in getDb) when the real host is chosen; the container path
 * below is the permanent one and is untouched.
 *
 * Workers gives every request its own I/O context, and a socket opened for one
 * request may not be used by the next — a module-level pool that survives
 * between requests throws "Cannot perform I/O on behalf of a different
 * request". So on Workers each getDb() builds its own single-connection pool
 * and lets pg open the socket lazily on the first query.
 *
 * That means connection reuse has to happen on the Postgres side instead:
 * DATABASE_URL must point at a pooling endpoint (for Neon, the `-pooler` host).
 * Transaction-mode pooling is fine here — the two row locks this app takes
 * (app/draft/actions.ts, lib/engine/submit.ts) are both inside a transaction,
 * so they stay on one server connection for their whole life.
 */
function onWorkers(): boolean {
  return process.env.WORKERS_RUNTIME === '1';
}

function workersDb() {
  return drizzle(new Pool({ connectionString: databaseUrl(), max: 1 }), { schema });
}

function getPool(): Pool {
  if (process.env.NODE_ENV === 'production') {
    pool ??= new Pool({ connectionString: databaseUrl() });
    return pool;
  }
  globalThis.__kflessPool ??= new Pool({ connectionString: databaseUrl() });
  return globalThis.__kflessPool;
}

export function getDb() {
  if (onWorkers()) return workersDb();
  return drizzle(getPool(), { schema });
}

export { schema };
