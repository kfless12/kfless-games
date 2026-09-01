import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';

import type { Identity } from '@/lib/auth';

import { scheduleGame } from './persist';
import { completeGame, reportMatchResult, undoMatch } from './submit';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

/*
 * Recursive undo against the real database. This is the test SPEC.md §14 makes
 * Phase 5's acceptance criterion: "undoing a mid-bracket match cleanly reverts
 * downstream state and standings."
 *
 * Each test creates its own game and deletes it afterwards; entries, matches
 * and game_results all cascade from games, so nothing else is touched.
 *
 * Needs `npm run db:up && npm run db:migrate` and a seeded roster.
 */

let pool: Pool;
let admin: Identity;

before(async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, 'DATABASE_URL is not set');
  pool = new Pool({ connectionString, max: 2 });

  const players = await pool.query(
    'select id, team_id from players where is_admin limit 1',
  );
  assert.equal(players.rowCount, 1, 'seed the roster first: npm run db:demo');
  admin = { personId: players.rows[0].id, teamId: players.rows[0].team_id, role: 'ADMIN' };
});

after(async () => {
  await pool?.end();
});

async function withGame<T>(
  format: string,
  entriesPerTeam: number,
  body: (client: import('pg').PoolClient, gameId: string) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let gameId: string | null = null;
  try {
    const created = await client.query(
      `insert into games (name, format, entries_per_team, points_matrix, status)
       values ($1, $2, $3, '{"1":100,"2":70,"3":50,"4":30,"5":20,"6":15,"7":10,"8":5}'::jsonb, 'DRAFT')
       returning id`,
      [`__test__ ${format} ${Math.random().toString(36).slice(2, 8)}`, format, entriesPerTeam],
    );
    gameId = created.rows[0].id as string;

    const scheduled = await scheduleGame(gameId);
    assert.ok(scheduled.ok, !scheduled.ok ? scheduled.error : '');

    return await body(client, gameId);
  } finally {
    if (gameId) await client.query('delete from games where id = $1', [gameId]).catch(() => {});
    client.release();
  }
}

/** Matches that currently have both participants and no result. */
async function readyMatches(client: import('pg').PoolClient, gameId: string) {
  const rows = await client.query(
    `select m.id, m.bracket::text as bracket, m.round, m.slot,
            array_agg(mp.entry_id order by mp.slot) as entry_ids
     from matches m join match_participants mp on mp.match_id = m.id
     where m.game_id = $1 and m.status = 'READY'
     group by m.id, m.bracket, m.round, m.slot
     order by m.bracket, m.round, m.slot`,
    [gameId],
  );
  return rows.rows.filter((row) => row.entry_ids.every((id: string | null) => id !== null));
}

/**
 * Snapshot of every slot that currently holds an entry.
 *
 * The key has to include the match's own slot as well as the participant slot —
 * without it all four winners round-1 matches collapse to one key and the
 * snapshot silently depends on row order.
 */
async function filledSlots(client: import('pg').PoolClient, gameId: string) {
  const rows = await client.query(
    `select m.bracket::text || '-' || m.round || '-' || m.slot || '#' || mp.slot as key,
            mp.entry_id
     from matches m join match_participants mp on mp.match_id = m.id
     where m.game_id = $1 and mp.entry_id is not null
     order by 1`,
    [gameId],
  );
  const map = new Map<string, string>();
  for (const row of rows.rows) {
    assert.ok(!map.has(row.key), `duplicate snapshot key ${row.key}`);
    map.set(row.key, row.entry_id);
  }
  return map;
}

async function statuses(client: import('pg').PoolClient, gameId: string) {
  const rows = await client.query(
    `select m.bracket::text || '-' || m.round || '-' || m.slot as key, m.status::text as status
     from matches m where m.game_id = $1 order by 1`,
    [gameId],
  );
  return new Map<string, string>(rows.rows.map((r) => [r.key, r.status]));
}

/** Plays a chalk bracket to completion, lowest seed wins. */
async function playAll(client: import('pg').PoolClient, gameId: string) {
  const seeds = await client.query('select id, seed from entries where game_id = $1', [gameId]);
  const seedOf = new Map<string, number>(seeds.rows.map((r) => [r.id, r.seed ?? 99]));
  const played: string[] = [];

  for (let guard = 0; guard < 60; guard += 1) {
    const ready = await readyMatches(client, gameId);
    if (ready.length === 0) break;
    const match = ready[0];
    const [a, b] = match.entry_ids as [string, string];
    const winner = (seedOf.get(a) ?? 99) < (seedOf.get(b) ?? 99) ? a : b;
    const outcome = await reportMatchResult(admin, { matchId: match.id, winnerEntryId: winner });
    assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');
    played.push(match.id);
  }

  return played;
}

describe('reporting a bracket result', () => {
  it('advances the winner and drops the loser into the losers bracket', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const ready = await readyMatches(client, gameId);
      assert.equal(ready.length, 4, 'four winners round-1 matches');

      const match = ready[0];
      const [a, b] = match.entry_ids as [string, string];
      const outcome = await reportMatchResult(admin, { matchId: match.id, winnerEntryId: a });
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');

      const pointers = await client.query(
        `select winner_to_match_id, winner_to_slot, loser_to_match_id, loser_to_slot
         from matches where id = $1`,
        [match.id],
      );
      const { winner_to_match_id, winner_to_slot, loser_to_match_id, loser_to_slot } =
        pointers.rows[0];

      const landed = await client.query(
        `select match_id, slot, entry_id from match_participants
         where (match_id = $1 and slot = $2) or (match_id = $3 and slot = $4)`,
        [winner_to_match_id, winner_to_slot, loser_to_match_id, loser_to_slot],
      );
      const byKey = new Map(landed.rows.map((r) => [`${r.match_id}#${r.slot}`, r.entry_id]));
      assert.equal(byKey.get(`${winner_to_match_id}#${winner_to_slot}`), a, 'winner advanced');
      assert.equal(byKey.get(`${loser_to_match_id}#${loser_to_slot}`), b, 'loser dropped');
    });
  });

  it('marks a match READY only once both slots are filled', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const ready = await readyMatches(client, gameId);
      const first = ready[0];
      await reportMatchResult(admin, {
        matchId: first.id,
        winnerEntryId: (first.entry_ids as string[])[0],
      });

      const target = await client.query(
        'select winner_to_match_id from matches where id = $1',
        [first.id],
      );
      const downstream = await client.query('select status::text from matches where id = $1', [
        target.rows[0].winner_to_match_id,
      ]);
      assert.equal(downstream.rows[0].status, 'PENDING', 'still waiting for the other side');
    });
  });

  it('rejects a winner who is not in the match', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const ready = await readyMatches(client, gameId);
      const other = await client.query(
        'select id from entries where game_id = $1 and id <> all($2::uuid[]) limit 1',
        [gameId, ready[0].entry_ids],
      );
      const outcome = await reportMatchResult(admin, {
        matchId: ready[0].id,
        winnerEntryId: other.rows[0].id,
      });
      assert.equal(outcome.ok, false);
    });
  });

  it('refuses a match that is still waiting for an entry', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const pending = await client.query(
        `select id from matches where game_id = $1 and status = 'PENDING' limit 1`,
        [gameId],
      );
      const outcome = await reportMatchResult(admin, {
        matchId: pending.rows[0].id,
        winnerEntryId: '00000000-0000-0000-0000-000000000000',
      });
      assert.equal(outcome.ok, false);
    });
  });
});

describe('recursive undo — the Phase 5 acceptance criterion', () => {
  it('clears the downstream slot the result populated', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const ready = await readyMatches(client, gameId);
      const match = ready[0];
      const [a, b] = match.entry_ids as [string, string];
      await reportMatchResult(admin, { matchId: match.id, winnerEntryId: a });

      const before = await filledSlots(client, gameId);
      const outcome = await undoMatch(admin, match.id);
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');
      const afterSlots = await filledSlots(client, gameId);

      // Exactly two slots go away: the winner's and the loser's landings.
      const removed = [...before.keys()].filter((key) => !afterSlots.has(key));
      assert.equal(removed.length, 2, `expected 2 cleared slots, got ${removed.join(', ')}`);

      // And the two entries are still in the match itself.
      const own = await client.query(
        'select entry_id from match_participants where match_id = $1 order by slot',
        [match.id],
      );
      assert.deepEqual(own.rows.map((r) => r.entry_id), [a, b], 'participants stay put');
    });
  });

  it('resets the undone match to READY with no result', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const ready = await readyMatches(client, gameId);
      const match = ready[0];
      await reportMatchResult(admin, {
        matchId: match.id,
        winnerEntryId: (match.entry_ids as string[])[0],
      });
      await undoMatch(admin, match.id);

      const row = await client.query(
        `select m.status::text as status, m.completed_at,
                count(*) filter (where mp.is_winner is not null)::int as decided
         from matches m join match_participants mp on mp.match_id = m.id
         where m.id = $1 group by m.status, m.completed_at`,
        [match.id],
      );
      assert.equal(row.rows[0].status, 'READY', 'back in the queue');
      assert.equal(row.rows[0].completed_at, null);
      assert.equal(row.rows[0].decided, 0, 'no winner recorded');
    });
  });

  // The recursive part: undoing a match whose winner has already played on.
  it('undoes the matches downstream that depended on it', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const played = await playAll(client, gameId);
      assert.ok(played.length >= 14, `expected a full bracket, played ${played.length}`);

      const completeBefore = await client.query(
        `select count(*)::int as n from matches where game_id = $1 and status = 'COMPLETE'`,
        [gameId],
      );

      // Undo a first-round match, whose winner and loser both played on.
      const first = await client.query(
        `select id from matches where game_id = $1 and bracket = 'WINNERS' and round = 1 and slot = 0`,
        [gameId],
      );
      const outcome = await undoMatch(admin, first.rows[0].id);
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');
      assert.ok((outcome.cleared ?? 0) > 1, `should cascade, cleared ${outcome.cleared}`);

      const completeAfter = await client.query(
        `select count(*)::int as n from matches where game_id = $1 and status = 'COMPLETE'`,
        [gameId],
      );
      assert.ok(
        completeAfter.rows[0].n < completeBefore.rows[0].n,
        'downstream results should be gone',
      );

      // Nothing may be left holding a result decided by a vanished participant.
      const orphans = await client.query(
        `select m.bracket::text, m.round, m.slot
         from matches m
         where m.game_id = $1 and m.status = 'COMPLETE'
           and (select count(*) from match_participants mp
                where mp.match_id = m.id and mp.entry_id is not null) < 2`,
        [gameId],
      );
      assert.deepEqual(orphans.rows, [], 'a COMPLETE match must still have both entries');
    });
  });

  it('leaves every unrelated slot untouched', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const ready = await readyMatches(client, gameId);
      // Play two independent round-1 matches from opposite halves.
      await reportMatchResult(admin, {
        matchId: ready[0].id,
        winnerEntryId: (ready[0].entry_ids as string[])[0],
      });
      await reportMatchResult(admin, {
        matchId: ready[3].id,
        winnerEntryId: (ready[3].entry_ids as string[])[0],
      });

      const before = await filledSlots(client, gameId);
      await undoMatch(admin, ready[0].id);
      const afterSlots = await filledSlots(client, gameId);

      // The other match's landings must survive.
      const other = await client.query(
        `select winner_to_match_id, winner_to_slot from matches where id = $1`,
        [ready[3].id],
      );
      const stillThere = await client.query(
        `select entry_id from match_participants where match_id = $1 and slot = $2`,
        [other.rows[0].winner_to_match_id, other.rows[0].winner_to_slot],
      );
      assert.notEqual(stillThere.rows[0].entry_id, null, 'unrelated advancement survived');

      // Nothing appeared out of nowhere.
      for (const key of afterSlots.keys()) {
        assert.ok(before.has(key), `${key} appeared during undo`);
      }
    });
  });

  it('undoing everything returns the bracket to its scheduled state', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const scheduledSlots = await filledSlots(client, gameId);
      const scheduledStatuses = await statuses(client, gameId);

      await playAll(client, gameId);

      // Undo the four round-1 matches; everything else descends from them.
      const roots = await client.query(
        `select id from matches where game_id = $1 and bracket = 'WINNERS' and round = 1
         order by slot`,
        [gameId],
      );
      for (const row of roots.rows) {
        const outcome = await undoMatch(admin, row.id);
        assert.ok(outcome.ok || /no result to undo/.test(!outcome.ok ? outcome.error : ''));
      }

      assert.deepEqual(
        [...(await filledSlots(client, gameId)).entries()].sort(),
        [...scheduledSlots.entries()].sort(),
        'slots should match the freshly scheduled bracket',
      );
      assert.deepEqual(
        [...(await statuses(client, gameId)).entries()].sort(),
        [...scheduledStatuses.entries()].sort(),
        'statuses should match too',
      );
    });
  });

  /*
   * Undo may only take back what this result put there. If an upstream edit has
   * since put somebody else in that slot, clearing it would delete an
   * advancement this match never made.
   */
  it('leaves a downstream slot alone if someone else now occupies it', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const ready = await readyMatches(client, gameId);
      const match = ready[0];
      const [a] = match.entry_ids as [string, string];
      await reportMatchResult(admin, { matchId: match.id, winnerEntryId: a });

      const pointer = await client.query(
        'select winner_to_match_id, winner_to_slot from matches where id = $1',
        [match.id],
      );
      const { winner_to_match_id, winner_to_slot } = pointer.rows[0];

      // Simulate the slot having been taken over by a different entry.
      const intruder = await client.query(
        'select id from entries where game_id = $1 and id <> all($2::uuid[]) limit 1',
        [gameId, match.entry_ids],
      );
      await client.query(
        'update match_participants set entry_id = $1 where match_id = $2 and slot = $3',
        [intruder.rows[0].id, winner_to_match_id, winner_to_slot],
      );

      await undoMatch(admin, match.id);

      const after = await client.query(
        'select entry_id from match_participants where match_id = $1 and slot = $2',
        [winner_to_match_id, winner_to_slot],
      );
      assert.equal(
        after.rows[0].entry_id,
        intruder.rows[0].id,
        'undo cleared a slot it did not populate',
      );
    });
  });

  it('refuses to undo a match that has no result', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const ready = await readyMatches(client, gameId);
      const outcome = await undoMatch(admin, ready[0].id);
      assert.equal(outcome.ok, false);
    });
  });
});

describe('the grand-final reset (SPEC.md §6.1)', () => {
  /** Plays chalk but stops before the grand final. */
  async function playToGrandFinal(client: import('pg').PoolClient, gameId: string) {
    const seeds = await client.query('select id, seed from entries where game_id = $1', [gameId]);
    const seedOf = new Map<string, number>(seeds.rows.map((r) => [r.id, r.seed ?? 99]));

    for (let guard = 0; guard < 60; guard += 1) {
      const ready = (await readyMatches(client, gameId)).filter(
        (match) => match.bracket !== 'GRAND_FINAL',
      );
      if (ready.length === 0) break;
      const match = ready[0];
      const [a, b] = match.entry_ids as [string, string];
      const winner = (seedOf.get(a) ?? 99) < (seedOf.get(b) ?? 99) ? a : b;
      const outcome = await reportMatchResult(admin, { matchId: match.id, winnerEntryId: winner });
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');
    }
  }

  it('activates when the losers-bracket side wins the grand final', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      await playToGrandFinal(client, gameId);

      const gf = await client.query(
        `select m.id, array_agg(mp.entry_id order by mp.slot) as ids
         from matches m join match_participants mp on mp.match_id = m.id
         where m.game_id = $1 and m.bracket = 'GRAND_FINAL' and m.round = 1
         group by m.id`,
        [gameId],
      );
      const [fromWinners, fromLosers] = gf.rows[0].ids as [string, string];
      assert.ok(fromWinners && fromLosers, 'the grand final should be ready');

      // Slot 1 is the losers-bracket entry, so this forces the reset.
      const outcome = await reportMatchResult(admin, {
        matchId: gf.rows[0].id,
        winnerEntryId: fromLosers,
      });
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');

      const reset = await client.query(
        `select m.status::text as status, array_agg(mp.entry_id order by mp.slot) as ids
         from matches m join match_participants mp on mp.match_id = m.id
         where m.game_id = $1 and m.bracket = 'GRAND_FINAL' and m.round = 2
         group by m.status`,
        [gameId],
      );
      assert.equal(reset.rows[0].status, 'READY', 'the reset should be playable');
      assert.deepEqual(
        reset.rows[0].ids,
        [fromWinners, fromLosers],
        'both finalists carry into the reset',
      );
    });
  });

  it('stays out of the way when the winners-bracket side wins', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      await playToGrandFinal(client, gameId);
      const gf = await client.query(
        `select m.id, array_agg(mp.entry_id order by mp.slot) as ids
         from matches m join match_participants mp on mp.match_id = m.id
         where m.game_id = $1 and m.bracket = 'GRAND_FINAL' and m.round = 1 group by m.id`,
        [gameId],
      );
      const [fromWinners] = gf.rows[0].ids as [string, string];
      await reportMatchResult(admin, { matchId: gf.rows[0].id, winnerEntryId: fromWinners });

      const reset = await client.query(
        `select m.status::text as status,
                count(mp.entry_id)::int as filled
         from matches m join match_participants mp on mp.match_id = m.id
         where m.game_id = $1 and m.bracket = 'GRAND_FINAL' and m.round = 2
         group by m.status`,
        [gameId],
      );
      assert.equal(reset.rows[0].status, 'PENDING');
      assert.equal(reset.rows[0].filled, 0, 'the reset never happens');
    });
  });

  // A static pointer cannot express "populate the reset", so undo cannot rely on
  // one either — it has to clear the reset explicitly.
  it('is cleared when the grand final is undone', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      await playToGrandFinal(client, gameId);
      const gf = await client.query(
        `select m.id, array_agg(mp.entry_id order by mp.slot) as ids
         from matches m join match_participants mp on mp.match_id = m.id
         where m.game_id = $1 and m.bracket = 'GRAND_FINAL' and m.round = 1 group by m.id`,
        [gameId],
      );
      const [, fromLosers] = gf.rows[0].ids as [string, string];
      await reportMatchResult(admin, { matchId: gf.rows[0].id, winnerEntryId: fromLosers });

      // Play the reset too, so undo has to unwind a played reset.
      const reset = await client.query(
        `select m.id, array_agg(mp.entry_id order by mp.slot) as ids
         from matches m join match_participants mp on mp.match_id = m.id
         where m.game_id = $1 and m.bracket = 'GRAND_FINAL' and m.round = 2 group by m.id`,
        [gameId],
      );
      await reportMatchResult(admin, {
        matchId: reset.rows[0].id,
        winnerEntryId: (reset.rows[0].ids as string[])[0],
      });

      const undone = await undoMatch(admin, gf.rows[0].id);
      assert.ok(undone.ok, !undone.ok ? undone.error : '');
      // The played reset counts as a cleared match, so the message the admin
      // sees ("undone, along with N matches") is honest.
      assert.ok(
        (undone.cleared ?? 0) >= 2,
        `the reset should be counted as cleared too, got ${undone.cleared}`,
      );

      const after = await client.query(
        `select m.status::text as status, count(mp.entry_id)::int as filled,
                count(*) filter (where mp.is_winner is not null)::int as decided
         from matches m join match_participants mp on mp.match_id = m.id
         where m.game_id = $1 and m.bracket = 'GRAND_FINAL' and m.round = 2
         group by m.status`,
        [gameId],
      );
      assert.equal(after.rows[0].status, 'PENDING', 'the reset must be reset');
      assert.equal(after.rows[0].filled, 0, 'its participants must be cleared');
      assert.equal(after.rows[0].decided, 0, 'its result must be gone');
    });
  });
});

describe('editing a result', () => {
  it('takes back the old advancement before applying the new one', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      const ready = await readyMatches(client, gameId);
      const match = ready[0];
      const [a, b] = match.entry_ids as [string, string];

      await reportMatchResult(admin, { matchId: match.id, winnerEntryId: a });
      const edited = await reportMatchResult(admin, { matchId: match.id, winnerEntryId: b });
      assert.ok(edited.ok, !edited.ok ? edited.error : '');
      assert.equal(edited.wasEdit, true);

      const pointers = await client.query(
        `select winner_to_match_id, winner_to_slot, loser_to_match_id, loser_to_slot
         from matches where id = $1`,
        [match.id],
      );
      const p = pointers.rows[0];
      const landed = await client.query(
        `select match_id, slot, entry_id from match_participants
         where (match_id = $1 and slot = $2) or (match_id = $3 and slot = $4)`,
        [p.winner_to_match_id, p.winner_to_slot, p.loser_to_match_id, p.loser_to_slot],
      );
      const byKey = new Map(landed.rows.map((r) => [`${r.match_id}#${r.slot}`, r.entry_id]));

      assert.equal(byKey.get(`${p.winner_to_match_id}#${p.winner_to_slot}`), b, 'b advanced now');
      assert.equal(byKey.get(`${p.loser_to_match_id}#${p.loser_to_slot}`), a, 'a dropped now');
    });
  });

  /*
   * The case a simple edit does not exercise: the old winner had already played
   * again. Changing the earlier result has to invalidate everything that
   * followed from it, or the bracket keeps results decided by an entry that is
   * no longer in those matches.
   */
  it('cascades when the old winner had already played on', async () => {
    await withGame('DOUBLE_ELIM', 2, async (client, gameId) => {
      await playAll(client, gameId);

      const completeBefore = await client.query(
        `select count(*)::int as n from matches where game_id = $1 and status = 'COMPLETE'`,
        [gameId],
      );

      const first = await client.query(
        `select m.id, array_agg(mp.entry_id order by mp.slot) as ids
         from matches m join match_participants mp on mp.match_id = m.id
         where m.game_id = $1 and m.bracket = 'WINNERS' and m.round = 1 and m.slot = 0
         group by m.id`,
        [gameId],
      );
      const [x, y] = first.rows[0].ids as [string, string];
      const winnerNow = await client.query(
        'select entry_id from match_participants where match_id = $1 and is_winner = true',
        [first.rows[0].id],
      );
      const flipped = winnerNow.rows[0].entry_id === x ? y : x;

      const edited = await reportMatchResult(admin, {
        matchId: first.rows[0].id,
        winnerEntryId: flipped,
      });
      assert.ok(edited.ok, !edited.ok ? edited.error : '');

      const completeAfter = await client.query(
        `select count(*)::int as n from matches where game_id = $1 and status = 'COMPLETE'`,
        [gameId],
      );
      assert.ok(
        completeAfter.rows[0].n < completeBefore.rows[0].n,
        `editing an early match should invalidate later ones: ${completeBefore.rows[0].n} -> ${completeAfter.rows[0].n}`,
      );

      // And nothing is left COMPLETE without both its entries.
      const orphans = await client.query(
        `select m.bracket::text, m.round, m.slot from matches m
         where m.game_id = $1 and m.status = 'COMPLETE'
           and (select count(*) from match_participants mp
                where mp.match_id = m.id and mp.entry_id is not null) < 2`,
        [gameId],
      );
      assert.deepEqual(orphans.rows, [], 'a COMPLETE match must still have both entries');
    });
  });

  // SPEC.md §8: editing after a game is COMPLETE forces a re-mark, which
  // recomputes game_results.
  it('drops game_results and reopens a completed game', async () => {
    await withGame('SINGLE_ELIM', 1, async (client, gameId) => {
      await playAll(client, gameId);
      const completed = await completeGame(admin, gameId);
      assert.ok(completed.ok, !completed.ok ? completed.error : '');

      const before = await client.query(
        `select (select count(*)::int from game_results where game_id = $1) as results,
                (select status::text from games where id = $1) as status`,
        [gameId],
      );
      assert.equal(before.rows[0].results, 4);
      assert.equal(before.rows[0].status, 'COMPLETE');

      const finalMatch = await client.query(
        `select m.id, array_agg(mp.entry_id order by mp.slot) as ids
         from matches m join match_participants mp on mp.match_id = m.id
         where m.game_id = $1 and m.round = 2 group by m.id`,
        [gameId],
      );
      const [x, y] = finalMatch.rows[0].ids as [string, string];
      const winnerNow = await client.query(
        `select entry_id from match_participants
         where match_id = $1 and is_winner = true`,
        [finalMatch.rows[0].id],
      );
      const flipped = winnerNow.rows[0].entry_id === x ? y : x;

      await reportMatchResult(admin, { matchId: finalMatch.rows[0].id, winnerEntryId: flipped });

      const afterEdit = await client.query(
        `select (select count(*)::int from game_results where game_id = $1) as results,
                (select status::text from games where id = $1) as status`,
        [gameId],
      );
      assert.equal(afterEdit.rows[0].results, 0, 'stale results must be gone');
      assert.equal(afterEdit.rows[0].status, 'ACTIVE', 'the admin has to re-mark it complete');

      // Re-marking recomputes, and the new champion is 1st.
      const again = await completeGame(admin, gameId);
      assert.ok(again.ok, !again.ok ? again.error : '');
      const first = await client.query(
        'select entry_id from game_results where game_id = $1 and placement = 1',
        [gameId],
      );
      assert.equal(first.rows[0].entry_id, flipped);
    });
  });
});

describe('round robin scores by wins, not placement (SPEC.md §6.3)', () => {
  /** Plays all six matches so the given team order finishes 3-0, 2-1, 1-2, 0-3. */
  async function playRoundRobin(client: import('pg').PoolClient, gameId: string) {
    const rows = await client.query(
      `select m.id, array_agg(mp.entry_id order by mp.slot) as ids,
              array_agg(e.team_id order by mp.slot) as teams
       from matches m
       join match_participants mp on mp.match_id = m.id
       join entries e on e.id = mp.entry_id
       where m.game_id = $1 group by m.id`,
      [gameId],
    );

    // Rank teams arbitrarily but deterministically, then let the better rank win.
    const teamIds = [...new Set(rows.rows.flatMap((r) => r.teams as string[]))].sort();
    const rank = new Map(teamIds.map((teamId, index) => [teamId, index]));

    for (const row of rows.rows) {
      const [entryA, entryB] = row.ids as [string, string];
      const [teamA, teamB] = row.teams as [string, string];
      const winner = rank.get(teamA)! < rank.get(teamB)! ? entryA : entryB;
      const outcome = await reportMatchResult(admin, { matchId: row.id, winnerEntryId: winner });
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');
    }

    return rank;
  }

  it('refuses to score until points per win is set', async () => {
    await withGame('ROUND_ROBIN', 1, async (client, gameId) => {
      await playRoundRobin(client, gameId);
      const outcome = await completeGame(admin, gameId);
      assert.equal(outcome.ok, false);
      assert.ok(!outcome.ok && /points per win/i.test(outcome.error));
    });
  });

  it('pays wins x points_per_win, and nothing for a loss', async () => {
    await withGame('ROUND_ROBIN', 1, async (client, gameId) => {
      await client.query('update games set points_per_win = 50 where id = $1', [gameId]);
      const rank = await playRoundRobin(client, gameId);

      const outcome = await completeGame(admin, gameId);
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');

      const results = await client.query(
        `select e.team_id, r.placement, r.points_awarded
         from game_results r join entries e on e.id = r.entry_id
         where r.game_id = $1 order by r.placement`,
        [gameId],
      );

      // The strongest team wins all three, then 2, then 1, then none.
      const expectedWins = [3, 2, 1, 0];
      assert.equal(results.rows.length, 4);

      results.rows.forEach((row, index) => {
        assert.equal(
          row.points_awarded,
          expectedWins[index] * 50,
          `placement ${row.placement} should be ${expectedWins[index]} wins x 50`,
        );
      });

      // The bottom team lost everything, so it scores nothing at all.
      assert.equal(results.rows.at(-1)!.points_awarded, 0, 'no points for a loss');
      void rank;
    });
  });

  it('records the standings order as placement even though it pays nothing', async () => {
    await withGame('ROUND_ROBIN', 1, async (client, gameId) => {
      await client.query('update games set points_per_win = 10 where id = $1', [gameId]);
      await playRoundRobin(client, gameId);
      await completeGame(admin, gameId);

      const rows = await client.query(
        'select placement from game_results where game_id = $1 order by placement',
        [gameId],
      );
      assert.deepEqual(
        rows.rows.map((r) => r.placement),
        [1, 2, 3, 4],
        'placement is still a unique 1..N, for display and the §6.5 tie-breakers',
      );
    });
  });

  it('ignores points_matrix entirely for a round robin', async () => {
    await withGame('ROUND_ROBIN', 1, async (client, gameId) => {
      // A matrix that would pay 100/70/50/30 if placement decided anything.
      await client.query(
        `update games set points_per_win = 10,
           points_matrix = '{"1":100,"2":70,"3":50,"4":30}'::jsonb
         where id = $1`,
        [gameId],
      );
      await playRoundRobin(client, gameId);
      await completeGame(admin, gameId);

      const rows = await client.query(
        'select points_awarded from game_results where game_id = $1 order by placement',
        [gameId],
      );
      assert.deepEqual(
        rows.rows.map((r) => r.points_awarded),
        [30, 20, 10, 0],
        'wins x 10, not the placement matrix',
      );
    });
  });

  it('pays zero to everyone when points_per_win is zero', async () => {
    await withGame('ROUND_ROBIN', 1, async (client, gameId) => {
      await client.query('update games set points_per_win = 0 where id = $1', [gameId]);
      await playRoundRobin(client, gameId);
      const outcome = await completeGame(admin, gameId);
      assert.ok(outcome.ok, !outcome.ok ? outcome.error : '');

      const rows = await client.query(
        'select points_awarded from game_results where game_id = $1',
        [gameId],
      );
      assert.deepEqual(rows.rows.map((r) => r.points_awarded), [0, 0, 0, 0]);
    });
  });
});
