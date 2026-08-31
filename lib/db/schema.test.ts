import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

/*
 * Database invariants the application code relies on.
 *
 * These exist because a later migration can quietly drop a check constraint or
 * turn a generated column into a plain one, and nothing in TypeScript would
 * notice. CLAUDE.md says to run tests against the docker-compose Postgres
 * rather than reasoning about the schema abstractly.
 *
 * Every assertion runs inside a transaction that is rolled back, so this never
 * changes the data. Run `npm run db:up && npm run db:migrate` first.
 */

let pool: Pool;

before(async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, 'DATABASE_URL is not set — copy .env.example to .env');

  pool = new Pool({ connectionString, max: 1 });
  try {
    const client = await pool.connect();
    client.release();
  } catch (error) {
    assert.fail(
      'cannot reach Postgres. Run `npm run db:up && npm run db:migrate` first.\n' +
        String(error),
    );
  }
});

after(async () => {
  await pool?.end();
});

type Attempt =
  | { ok: true; rows: unknown[]; all: unknown[][] }
  | { ok: false; error: string };

/**
 * Runs the statements in one transaction and always rolls back, so these tests
 * never change the data. Returns the rows from the last statement.
 *
 * Statements are separate rather than one query because a data-modifying CTE
 * cannot see its own writes — every part of a single statement reads the same
 * snapshot.
 */
async function attempt(...statements: string[]): Promise<Attempt> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const all: unknown[][] = [];
    for (const statement of statements) {
      all.push((await client.query(statement)).rows);
    }
    return { ok: true, rows: all.at(-1) ?? [], all };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.query('rollback').catch(() => {});
    client.release();
  }
}

async function expectRejected(sql: string, mentioning: string) {
  const result = await attempt(sql);
  assert.equal(result.ok, false, `expected rejection of: ${sql}`);
  assert.ok(
    !result.ok && result.error.includes(mentioning),
    `expected error mentioning "${mentioning}", got: ${!result.ok ? result.error : ''}`,
  );
}

async function expectAccepted(sql: string) {
  const result = await attempt(sql);
  assert.ok(result.ok, `expected acceptance of: ${sql}\n${!result.ok ? result.error : ''}`);
}

describe('points are derived, never stored (CLAUDE.md invariant 1)', () => {
  it('has no stored points column anywhere', async () => {
    const result = await attempt(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and (column_name like '%total_point%' or column_name = 'points')
    `);
    assert.ok(result.ok);
    assert.deepEqual(result.rows, [], 'a stored points column would break undo');
  });

  it('keeps game_results as the only place points are written', async () => {
    const result = await attempt(`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'points_awarded'
    `);
    assert.ok(result.ok);
    assert.deepEqual(result.rows, [{ table_name: 'game_results' }]);
  });
});

describe('is_mister_irrelevant (SPEC.md §1.1, §4.1)', () => {
  it('is a generated column, not an ordinary one', async () => {
    const result = await attempt(`
      select is_generated from information_schema.columns
      where table_name = 'players' and column_name = 'is_mister_irrelevant'
    `);
    assert.ok(result.ok);
    assert.deepEqual(result.rows, [{ is_generated: 'ALWAYS' }]);
  });

  it('turns on for pick 13 and only pick 13', async () => {
    const result = await attempt(`
      update players set draft_pick_number = 13
      where id = (select id from players where not is_captain limit 1)
      returning draft_pick_number, is_mister_irrelevant
    `);
    assert.ok(result.ok);
    assert.deepEqual(result.rows, [{ draft_pick_number: 13, is_mister_irrelevant: true }]);

    const twelve = await attempt(`
      update players set draft_pick_number = 12
      where id = (select id from players where not is_captain limit 1)
      returning is_mister_irrelevant
    `);
    assert.ok(twelve.ok);
    assert.deepEqual(twelve.rows, [{ is_mister_irrelevant: false }]);
  });

  // Undoing pick 13 has to clear the label with no extra code.
  it('clears when the pick is undone', async () => {
    const result = await attempt(
      `update players set draft_pick_number = 13
       where id = (select id from players where not is_captain order by id limit 1)`,
      `select count(*)::int as flagged from players where is_mister_irrelevant`,
      `update players set draft_pick_number = null where draft_pick_number = 13`,
      `select count(*)::int as flagged from players where is_mister_irrelevant`,
    );
    assert.ok(result.ok, !result.ok ? result.error : '');

    // True while pick 13 stands, false once it is undone. Asserting both rules
    // out a column that is simply always false.
    assert.deepEqual(result.all[1], [{ flagged: 1 }], 'should be flagged while pick 13 stands');
    assert.deepEqual(result.all[3], [{ flagged: 0 }], 'should clear when the pick is undone');
  });

  // SPEC.md §1.1: the label "cannot be edited away".
  it('cannot be set directly', async () => {
    await expectRejected(
      `update players set is_mister_irrelevant = true
       where id = (select id from players limit 1)`,
      'can only be updated to DEFAULT',
    );
  });
});

describe('players constraints', () => {
  it('refuses to draft a captain', async () => {
    await expectRejected(
      `update players set draft_pick_number = 1 where is_captain`,
      'players_captains_are_not_drafted',
    );
  });

  it('holds draft picks to 1-13 and keeps them unique', async () => {
    const anyone = `(select id from players where not is_captain limit 1)`;
    await expectRejected(
      `update players set draft_pick_number = 14 where id = ${anyone}`,
      'players_draft_pick_number_range',
    );
    await expectRejected(
      `update players set draft_pick_number = 0 where id = ${anyone}`,
      'players_draft_pick_number_range',
    );
    await expectRejected(
      `update players set draft_pick_number = 1
       where id in (select id from players where not is_captain limit 2)`,
      'players_draft_pick_number_key',
    );
    await expectAccepted(`update players set draft_pick_number = 13 where id = ${anyone}`);
  });

  it('holds scouting ratings to 1-100', async () => {
    const anyone = `(select id from players limit 1)`;
    for (const column of ['beer_pong', 'chugging', 'flip_cup', 'endurance', 'clutch', 'trash_talk', 'hand_eye', 'recovery']) {
      await expectRejected(
        `update players set ${column} = 101 where id = ${anyone}`,
        'players_ratings_range',
      );
      await expectRejected(
        `update players set ${column} = 0 where id = ${anyone}`,
        'players_ratings_range',
      );
    }
    await expectAccepted(`update players set beer_pong = 1, recovery = 100 where id = ${anyone}`);
  });

  it('keeps emails unique', async () => {
    await expectRejected(
      `update players set email = (select email from players order by email limit 1)
       where id = (select id from players order by email desc limit 1)`,
      'players_email_key',
    );
  });
});

describe('teams constraints', () => {
  it('holds draft positions to 1-4 and keeps them unique', async () => {
    await expectRejected(
      `update teams set draft_position = 5 where draft_position = 1`,
      'teams_draft_position_range',
    );
    await expectRejected(
      `update teams set draft_position = 2 where draft_position = 1`,
      'teams_draft_position_key',
    );
  });

  it('requires a #rrggbb colour', async () => {
    for (const bad of ['red', '#fff', 'b91c1c']) {
      await expectRejected(
        `update teams set color_hex = '${bad}' where draft_position = 1`,
        'teams_color_hex_format',
      );
    }
    await expectAccepted(`update teams set color_hex = '#B91C1C' where draft_position = 1`);
  });
});

describe('credentials and event_state', () => {
  it('requires join codes to be exactly 6 digits', async () => {
    const player = `(select id from players limit 1)`;
    for (const bad of ['12ab56', '12345', '1234567', '']) {
      await expectRejected(
        `insert into credentials (player_id, token, join_code)
         values (${player}, 'test-token-${bad || 'empty'}', '${bad}')`,
        'credentials_join_code_format',
      );
    }
  });

  it('allows a revoked credential to reuse an active code, but not two active ones', async () => {
    const player = `(select id from players limit 1)`;
    await expectAccepted(
      `insert into credentials (player_id, token, join_code, revoked_at)
       select ${player}, 'tok-a', join_code, now() from credentials where revoked_at is null limit 1`,
    );
    await expectRejected(
      `insert into credentials (player_id, token, join_code)
       select ${player}, 'tok-b', join_code from credentials where revoked_at is null limit 1`,
      'credentials_active_join_code_key',
    );
  });

  it('holds event_state to a single row', async () => {
    await expectRejected(`insert into event_state (id) values (2)`, 'event_state_singleton');
  });
});
