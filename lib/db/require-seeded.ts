import assert from 'node:assert/strict';

import type { Pool } from 'pg';

/*
 * These tests update seeded rows (a non-captain gets pick 13, and so on) inside
 * a transaction that rolls back. Against a migrated but empty database every
 * one of them fails with an assertion about missing rows, which reads as the
 * schema being broken when nothing is. Say the real reason instead.
 */
export async function requireSeededRoster(db: Pool): Promise<void> {
  const { rows } = await db.query<{ count: string }>('select count(*)::text as count from players');
  const count = Number(rows[0]?.count ?? 0);
  assert.ok(
    count > 0,
    'the database is migrated but holds no roster. The database tests need the seed: ' +
      'run `npm run db:seed` (or `npm run db:demo`) first.',
  );
}
