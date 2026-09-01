import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';

import { generateBracket } from './bracket';
import { scheduleGame, unscheduleGame } from './persist';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

/*
 * The persisted bracket has to match the generated one, pointers included.
 * TypeScript cannot check that the uuid in winner_to_match_id is the row the
 * generator meant, so it is checked here against the real database.
 *
 * scheduleGame() runs its own transaction through the app's pooled client, so
 * these tests cannot wrap it in a rollback. Instead each one creates a game of
 * its own and deletes it afterwards — entries and matches cascade from games,
 * so nothing is left behind and no existing game is touched.
 *
 * Needs `npm run db:up && npm run db:migrate`.
 */

let pool: Pool;

before(async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, 'DATABASE_URL is not set');
  pool = new Pool({ connectionString, max: 1 });
  try {
    const client = await pool.connect();
    client.release();
  } catch (error) {
    assert.fail(`cannot reach Postgres — run \`npm run db:up\` first.\n${String(error)}`);
  }
});

after(async () => {
  await pool?.end();
});

/**
 * Creates a throwaway game, hands it to the real scheduleGame(), then deletes
 * it. Deleting the game cascades to its entries and matches.
 */
async function withScheduledGame<T>(
  format: string,
  entriesPerTeam: number,
  body: (
    client: import('pg').PoolClient,
    gameId: string,
    outcome: Awaited<ReturnType<typeof scheduleGame>>,
  ) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let gameId: string | null = null;

  try {
    const game = await client.query(
      `insert into games (name, format, entries_per_team, points_matrix, status)
       values ($1, $2, $3, '{"1":100,"2":70,"3":50,"4":30}'::jsonb, 'DRAFT')
       returning id`,
      [`__test__ ${format} ${entriesPerTeam}`, format, entriesPerTeam],
    );
    gameId = game.rows[0].id as string;

    const outcome = await scheduleGame(gameId);
    return await body(client, gameId, outcome);
  } finally {
    if (gameId) {
      await client.query('delete from games where id = $1', [gameId]).catch(() => {});
    }
    client.release();
  }
}

/** The match rows for a game, keyed by bracket/round/slot. */
async function matchRows(client: import('pg').PoolClient, gameId: string) {
  const rows = await client.query(
    `select id, bracket, round, slot, status,
            winner_to_match_id, winner_to_slot, loser_to_match_id, loser_to_slot
     from matches where game_id = $1`,
    [gameId],
  );
  return {
    all: rows.rows,
    byId: new Map<string, (typeof rows.rows)[number]>(rows.rows.map((r) => [r.id, r])),
    byKey: new Map<string, (typeof rows.rows)[number]>(
      rows.rows.map((r) => [`${r.bracket}-${r.round}-${r.slot}`, r]),
    ),
  };
}

describe('scheduleGame — double elimination (beer pong)', () => {
  it('writes 8 entries and 15 matches', async () => {
    await withScheduledGame('DOUBLE_ELIM', 2, async (client, gameId, outcome) => {
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');
      assert.equal(outcome.entryCount, 8);
      assert.equal(outcome.matchCount, 15);
      assert.deepEqual(outcome.warnings, []);

      const counts = await client.query(
        `select (select count(*)::int from entries where game_id = $1) as entries,
                (select count(*)::int from matches where game_id = $1) as matches,
                (select count(*)::int from match_participants mp
                   join matches m on m.id = mp.match_id where m.game_id = $1) as participants,
                (select status::text from games where id = $1) as status`,
        [gameId],
      );
      assert.equal(counts.rows[0].entries, 8);
      assert.equal(counts.rows[0].matches, 15);
      assert.equal(counts.rows[0].participants, 30, 'two slots per match');
      assert.equal(counts.rows[0].status, 'SCHEDULED');
    });
  });

  // A pointer is a uuid, so nothing in TypeScript can tell whether it points at
  // the match the generator meant. This is the check that has to hit the DB.
  it('wires every advancement pointer at the row the generator intended', async () => {
    await withScheduledGame('DOUBLE_ELIM', 2, async (client, gameId, outcome) => {
      assert.ok(outcome.ok);

      const entryRows = await client.query(
        'select id, team_id from entries where game_id = $1 order by id',
        [gameId],
      );
      const bracket = generateBracket(
        entryRows.rows.map((r) => ({ id: r.id, teamId: r.team_id })),
        'DOUBLE',
      );

      const { byKey } = await matchRows(client, gameId);

      for (const match of bracket.matches) {
        // Generated keys use GRAND_FINAL-<round>-<slot>, matching the DB tuple.
        const dbKey = `${match.bracket}-${match.round}-${match.slot}`;
        const row = byKey.get(dbKey);
        assert.ok(row, `no row for ${dbKey}`);

        const expectWinner = match.winnerTo.matchKey
          ? byKey.get(match.winnerTo.matchKey.replace('-RESET', ''))?.id ?? null
          : null;
        assert.equal(row.winner_to_match_id, expectWinner, `${dbKey} winner target`);
        assert.equal(row.winner_to_slot, match.winnerTo.slot, `${dbKey} winner slot`);

        const expectLoser = match.loserTo.matchKey
          ? byKey.get(match.loserTo.matchKey.replace('-RESET', ''))?.id ?? null
          : null;
        assert.equal(row.loser_to_match_id, expectLoser, `${dbKey} loser target`);
        assert.equal(row.loser_to_slot, match.loserTo.slot, `${dbKey} loser slot`);
      }
    });
  });

  it('never points a match at itself or leaves a dangling pointer', async () => {
    await withScheduledGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const { all, byId } = await matchRows(client, gameId);
      for (const row of all) {
        for (const target of [row.winner_to_match_id, row.loser_to_match_id]) {
          if (target === null) continue;
          assert.notEqual(target, row.id, `${row.bracket}-${row.round}-${row.slot} points at itself`);
          assert.ok(byId.has(target), 'pointer targets a row in this game');
        }
      }
    });
  });

  it('marks only fully-populated matches READY', async () => {
    await withScheduledGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const ready = await client.query(
        `select m.id, count(mp.entry_id)::int as filled
         from matches m
         join match_participants mp on mp.match_id = m.id
         where m.game_id = $1 and m.status = 'READY'
         group by m.id`,
        [gameId],
      );
      assert.equal(ready.rows.length, 4, 'the four winners round-1 matches');
      for (const row of ready.rows) {
        assert.equal(row.filled, 2, 'a READY match must have both participants');
      }
    });
  });

  it('separates each team\'s two entries in round 1', async () => {
    await withScheduledGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const round1 = await client.query(
        `select m.slot, array_agg(e.team_id order by mp.slot) as team_ids
         from matches m
         join match_participants mp on mp.match_id = m.id
         join entries e on e.id = mp.entry_id
         where m.game_id = $1 and m.bracket = 'WINNERS' and m.round = 1
         group by m.slot order by m.slot`,
        [gameId],
      );
      assert.equal(round1.rows.length, 4);
      for (const row of round1.rows) {
        assert.notEqual(row.team_ids[0], row.team_ids[1], `round-1 slot ${row.slot} is same-team`);
      }
    });
  });

  it('records a seed on every entry', async () => {
    await withScheduledGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const seeds = await client.query(
        'select seed from entries where game_id = $1 order by seed',
        [gameId],
      );
      assert.deepEqual(
        seeds.rows.map((r) => r.seed),
        [1, 2, 3, 4, 5, 6, 7, 8],
        'seeds should be a unique 1..8',
      );
    });
  });

  it('is idempotent — rescheduling replaces rather than doubling up', async () => {
    await withScheduledGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const again = await scheduleGame(gameId);
      assert.ok(again.ok, !again.ok ? again.error : '');

      const counts = await client.query(
        `select (select count(*)::int from entries where game_id = $1) as entries,
                (select count(*)::int from matches where game_id = $1) as matches`,
        [gameId],
      );
      assert.equal(counts.rows[0].entries, 8, 'entries should not accumulate');
      assert.equal(counts.rows[0].matches, 15, 'matches should not accumulate');
    });
  });

  // Regenerating over played matches would silently discard results.
  it('refuses to regenerate once a match has a result', async () => {
    await withScheduledGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      await client.query(
        `update matches set status = 'COMPLETE', completed_at = now()
         where game_id = $1 and bracket = 'WINNERS' and round = 1 and slot = 0
           and status <> 'COMPLETE'`,
        [gameId],
      );

      const blocked = await scheduleGame(gameId);
      assert.equal(blocked.ok, false);
      assert.ok(!blocked.ok && /already have results/.test(blocked.error));

      const stillThere = await client.query(
        'select count(*)::int as n from matches where game_id = $1',
        [gameId],
      );
      assert.equal(stillThere.rows[0].n, 15, 'nothing should have been deleted');
    });
  });
});

describe('scheduleGame — single elimination (the flip cup shape)', () => {
  it('writes 4 entries and 3 matches, with no losers bracket', async () => {
    await withScheduledGame('SINGLE_ELIM', 1, async (client, gameId, outcome) => {
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');
      assert.equal(outcome.entryCount, 4);
      assert.equal(outcome.matchCount, 3);

      const rows = await client.query(
        'select bracket::text, count(*)::int as n from matches where game_id = $1 group by bracket',
        [gameId],
      );
      assert.deepEqual(rows.rows, [{ bracket: 'WINNERS', n: 3 }]);
    });
  });

  it('leaves every loser pointer null', async () => {
    await withScheduledGame('SINGLE_ELIM', 1, async (client, gameId) => {
      const rows = await client.query(
        `select count(*)::int as n from matches
         where game_id = $1 and loser_to_match_id is not null`,
        [gameId],
      );
      assert.equal(rows.rows[0].n, 0, 'single elimination has nowhere to drop a loser');
    });
  });
});

describe('scheduleGame — round robin and FFA (the other flip cup options)', () => {
  it('writes 6 round-robin matches for 4 entries, all playable', async () => {
    await withScheduledGame('ROUND_ROBIN', 1, async (client, gameId, outcome) => {
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');
      assert.equal(outcome.entryCount, 4);
      assert.equal(outcome.matchCount, 6, 'SPEC.md §6.3: 4 entries is 6 matches');

      const rows = await client.query(
        `select count(*)::int as n from matches where game_id = $1 and status = 'READY'`,
        [gameId],
      );
      assert.equal(rows.rows[0].n, 6, 'every pairing is known up front');
    });
  });

  it('pairs every round-robin entry with every other exactly once', async () => {
    await withScheduledGame('ROUND_ROBIN', 1, async (client, gameId) => {
      const rows = await client.query(
        `select m.id, array_agg(mp.entry_id order by mp.slot) as ids
         from matches m join match_participants mp on mp.match_id = m.id
         where m.game_id = $1 group by m.id`,
        [gameId],
      );
      const pairs = rows.rows.map((r) => [...r.ids].sort().join('|'));
      assert.equal(new Set(pairs).size, 6, 'no duplicate pairing');
    });
  });

  it('writes a single FFA heat holding every entry', async () => {
    await withScheduledGame('RANKED_FFA', 1, async (client, gameId, outcome) => {
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');
      assert.equal(outcome.matchCount, 1);

      const rows = await client.query(
        `select m.bracket::text, count(mp.entry_id)::int as n
         from matches m join match_participants mp on mp.match_id = m.id
         where m.game_id = $1 group by m.bracket`,
        [gameId],
      );
      assert.deepEqual(rows.rows, [{ bracket: 'HEAT', n: 4 }]);
    });
  });
});

describe('unscheduleGame', () => {
  it('clears the tournament and returns the game to DRAFT', async () => {
    await withScheduledGame('SINGLE_ELIM', 1, async (client, gameId) => {
      const outcome = await unscheduleGame(gameId);
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');

      const counts = await client.query(
        `select (select count(*)::int from entries where game_id = $1) as entries,
                (select count(*)::int from matches where game_id = $1) as matches,
                (select status::text from games where id = $1) as status`,
        [gameId],
      );
      assert.deepEqual(counts.rows[0], { entries: 0, matches: 0, status: 'DRAFT' });
    });
  });

  it('refuses once a match has a result', async () => {
    await withScheduledGame('SINGLE_ELIM', 1, async (client, gameId) => {
      await client.query(
        `update matches set status = 'COMPLETE' where game_id = $1 and round = 1 and slot = 0`,
        [gameId],
      );
      const outcome = await unscheduleGame(gameId);
      assert.equal(outcome.ok, false);

      const left = await client.query(
        'select count(*)::int as n from matches where game_id = $1',
        [gameId],
      );
      assert.equal(left.rows[0].n, 3, 'nothing deleted');
    });
  });
});
