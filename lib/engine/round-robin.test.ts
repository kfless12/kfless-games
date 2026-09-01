import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeStandings,
  generateRoundRobin,
  resolveRoundRobin,
  type RoundRobinResult,
} from './round-robin';

const FOUR = ['A', 'B', 'C', 'D'];

describe('generateRoundRobin', () => {
  // SPEC.md §6.3: "With 4 entries: 6 matches."
  it('produces 6 matches for 4 entries', () => {
    assert.equal(generateRoundRobin(FOUR).length, 6);
  });

  it('pairs every entry with every other exactly once', () => {
    for (const size of [2, 3, 4, 5, 6, 8]) {
      const ids = Array.from({ length: size }, (_, i) => `E${i + 1}`);
      const matches = generateRoundRobin(ids);

      assert.equal(matches.length, (size * (size - 1)) / 2, `${size} entries`);

      const pairs = matches.map((m) => [...m.participants].sort().join('v'));
      assert.equal(new Set(pairs).size, pairs.length, `${size}: duplicate pairing`);

      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const wanted = [ids[i], ids[j]].sort().join('v');
          assert.ok(pairs.includes(wanted), `${size}: ${wanted} never happens`);
        }
      }
    }
  });

  it('never has an entry playing twice in the same round', () => {
    for (const size of [3, 4, 5, 6, 7, 8]) {
      const ids = Array.from({ length: size }, (_, i) => `E${i + 1}`);
      const byRound = new Map<number, string[]>();
      for (const match of generateRoundRobin(ids)) {
        byRound.set(match.round, [...(byRound.get(match.round) ?? []), ...match.participants]);
      }
      for (const [round, players] of byRound) {
        assert.equal(new Set(players).size, players.length, `${size} entries, round ${round}`);
      }
    }
  });

  it('never pairs an entry with itself', () => {
    for (const match of generateRoundRobin(FOUR)) {
      assert.notEqual(match.participants[0], match.participants[1]);
    }
  });

  it('gives every match a unique key', () => {
    const keys = generateRoundRobin(Array.from({ length: 8 }, (_, i) => `E${i}`)).map((m) => m.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('is empty below two entries', () => {
    assert.deepEqual(generateRoundRobin([]), []);
    assert.deepEqual(generateRoundRobin(['A']), []);
  });
});

/** Helper: score a match by participant ids. */
function score(
  matches: ReturnType<typeof generateRoundRobin>,
  a: string,
  b: string,
  scoreA: number,
  scoreB: number,
): RoundRobinResult {
  const match = matches.find(
    (m) => m.participants.includes(a) && m.participants.includes(b),
  )!;
  const forwards = match.participants[0] === a;
  return {
    matchKey: match.key,
    scores: forwards ? [scoreA, scoreB] : [scoreB, scoreA],
  };
}

describe('computeStandings', () => {
  const matches = generateRoundRobin(FOUR);

  it('counts wins, losses and differential', () => {
    const results = [
      score(matches, 'A', 'B', 10, 4),
      score(matches, 'A', 'C', 10, 8),
      score(matches, 'A', 'D', 10, 0),
      score(matches, 'B', 'C', 10, 9),
      score(matches, 'B', 'D', 10, 2),
      score(matches, 'C', 'D', 10, 5),
    ];
    const table = new Map(
      computeStandings(FOUR, matches, results).map((row) => [row.entryId, row]),
    );

    assert.deepEqual(
      { wins: table.get('A')!.wins, losses: table.get('A')!.losses },
      { wins: 3, losses: 0 },
    );
    assert.deepEqual(
      { wins: table.get('D')!.wins, losses: table.get('D')!.losses },
      { wins: 0, losses: 3 },
    );
    assert.equal(table.get('A')!.differential, 30 - 12);
    assert.equal(table.get('D')!.differential, 7 - 30);
  });

  it('counts nothing for a game not yet played', () => {
    const table = computeStandings(FOUR, matches, [score(matches, 'A', 'B', 10, 3)]);
    const byId = new Map(table.map((r) => [r.entryId, r]));
    assert.equal(byId.get('A')!.played, 1);
    assert.equal(byId.get('C')!.played, 0);
    assert.equal(byId.get('C')!.differential, 0);
  });

  it('includes entries with no results at all', () => {
    assert.equal(computeStandings(FOUR, matches, []).length, 4);
  });
});

describe('tie-breakers, in SPEC.md §6.3 order', () => {
  const matches = generateRoundRobin(FOUR);

  it('orders by wins first', () => {
    const results = [
      score(matches, 'A', 'B', 10, 1),
      score(matches, 'A', 'C', 10, 1),
      score(matches, 'A', 'D', 10, 1),
      score(matches, 'B', 'C', 10, 1),
      score(matches, 'B', 'D', 10, 1),
      score(matches, 'C', 'D', 10, 1),
    ];
    const { placements } = resolveRoundRobin(FOUR, matches, results);
    assert.deepEqual(placements.map((p) => p.entryId), ['A', 'B', 'C', 'D']);
  });

  // Head-to-head comes before differential, so an entry can win the tie despite
  // a much worse differential. This is the ordering SPEC.md §6.3 specifies.
  it('uses head-to-head before differential', () => {
    const results = [
      // A and B both finish 2-1. B beat A head to head; A has a far better
      // differential. Head-to-head must win, so B places above A.
      score(matches, 'A', 'B', 1, 10),
      score(matches, 'A', 'C', 20, 0),
      score(matches, 'A', 'D', 20, 0),
      score(matches, 'B', 'C', 0, 1),
      score(matches, 'B', 'D', 2, 1),
      score(matches, 'C', 'D', 0, 1),
    ];
    const { placements, standings } = resolveRoundRobin(FOUR, matches, results);
    const byId = new Map(standings.map((r) => [r.entryId, r]));

    assert.equal(byId.get('A')!.wins, 2, 'A should be 2-1');
    assert.equal(byId.get('B')!.wins, 2, 'B should be 2-1');
    assert.ok(
      byId.get('A')!.differential > byId.get('B')!.differential,
      `A should have the better differential: A=${byId.get('A')!.differential} B=${byId.get('B')!.differential}`,
    );

    const order = placements.map((p) => p.entryId);
    assert.ok(
      order.indexOf('B') < order.indexOf('A'),
      `B beat A head to head so should place above: got ${order.join(',')}`,
    );
  });

  it('falls back to differential when head-to-head is level', () => {
    // Only the A-B match is unplayed, so they have no head-to-head record.
    const results = [
      score(matches, 'A', 'C', 10, 0),
      score(matches, 'A', 'D', 10, 9),
      score(matches, 'B', 'C', 10, 9),
      score(matches, 'B', 'D', 10, 9),
      score(matches, 'C', 'D', 5, 4),
    ];
    const { placements, standings } = resolveRoundRobin(FOUR, matches, results);
    const byId = new Map(standings.map((r) => [r.entryId, r]));
    assert.equal(byId.get('A')!.wins, byId.get('B')!.wins);
    assert.ok(byId.get('A')!.differential > byId.get('B')!.differential);

    const order = placements.map((p) => p.entryId);
    assert.ok(order.indexOf('A') < order.indexOf('B'), order.join(','));
  });

  // SPEC.md §6.3: the third tie-breaker is a coin flip shown to the admin. It
  // must be surfaced, not silently invented.
  it('reports an unresolvable tie instead of guessing', () => {
    const results = [
      score(matches, 'A', 'B', 10, 10),
      score(matches, 'C', 'D', 10, 10),
      score(matches, 'A', 'C', 10, 10),
      score(matches, 'A', 'D', 10, 10),
      score(matches, 'B', 'C', 10, 10),
      score(matches, 'B', 'D', 10, 10),
    ];
    const { unresolvedTies, placements } = resolveRoundRobin(FOUR, matches, results);

    assert.ok(unresolvedTies.length > 0, 'a dead-level table should need a coin flip');
    assert.equal(unresolvedTies[0].length, 4, 'all four are level');
    // A usable order is still produced so the table can render.
    assert.deepEqual(placements.map((p) => p.placement), [1, 2, 3, 4]);
  });

  it('lets the admin break a tie, and stops reporting it once broken', () => {
    const results = [
      score(matches, 'A', 'B', 10, 10),
      score(matches, 'A', 'C', 10, 0),
      score(matches, 'A', 'D', 10, 0),
      score(matches, 'B', 'C', 10, 0),
      score(matches, 'B', 'D', 10, 0),
      score(matches, 'C', 'D', 10, 10),
    ];
    const before = resolveRoundRobin(FOUR, matches, results);
    assert.ok(before.unresolvedTies.some((tie) => tie.includes('A') && tie.includes('B')));

    const after = resolveRoundRobin(FOUR, matches, results, ['B', 'A']);
    const order = after.placements.map((p) => p.entryId);
    assert.ok(order.indexOf('B') < order.indexOf('A'), `admin chose B: got ${order.join(',')}`);
    assert.ok(
      !after.unresolvedTies.some((tie) => tie.includes('A') && tie.includes('B')),
      'the tie should no longer need a decision',
    );
  });

  it('gives a stable order while the admin is still deciding', () => {
    const results = [score(matches, 'A', 'B', 10, 10)];
    const first = resolveRoundRobin(FOUR, matches, results).placements;
    const second = resolveRoundRobin(FOUR, matches, results).placements;
    assert.deepEqual(first, second, 'polling must not reshuffle the table');
  });

  it('always assigns placements 1..N with no gaps', () => {
    const results = [
      score(matches, 'A', 'B', 10, 4),
      score(matches, 'C', 'D', 7, 7),
    ];
    const { placements } = resolveRoundRobin(FOUR, matches, results);
    assert.deepEqual(placements.map((p) => p.placement), [1, 2, 3, 4]);
    assert.equal(new Set(placements.map((p) => p.entryId)).size, 4);
  });
});
