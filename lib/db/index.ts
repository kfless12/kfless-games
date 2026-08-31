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

function getPool(): Pool {
  if (process.env.NODE_ENV === 'production') {
    pool ??= new Pool({ connectionString: databaseUrl() });
    return pool;
  }
  globalThis.__kflessPool ??= new Pool({ connectionString: databaseUrl() });
  return globalThis.__kflessPool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export { schema };
