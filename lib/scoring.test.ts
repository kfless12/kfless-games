import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregateGamePoints,
  buildLeaderboard,
  type ScoringEntry,
  type ScoringGame,
  type ScoringResult,
  type ScoringTeam,
} from './scoring';

const TEAMS: ScoringTeam[] = ['red', 'blue', 'green', 'gold'].map((id) => ({
  id,
  name: id.toUpperCase(),
  colorHex: '#000000',
  logoUrl: null,
}));

function game(overrides: Partial<ScoringGame> = {}): ScoringGame {
  return {
    id: 'g1',
    name: 'Game One',
    format: 'ROUND_ROBIN',
    entryAggregation: 'SUM',
    pointsMatrix: { '1': 100, '2': 70, '3': 50, '4': 30 },
    status: 'COMPLETE',
    sortOrder: 0,
    ...overrides,
  };
}

/** One entry per team, in the given team order. */
function oneEach(gameId: string): ScoringEntry[] {
  return TEAMS.map((team) => ({ id: `${gameId}-${team.id}`, gameId, teamId: team.id }));
}

function placings(gameId: string, order: string[]): ScoringResult[] {
  return order.map((teamId, index) => ({
    gameId,
    entryId: `${gameId}-${teamId}`,
    placement: index + 1,
    pointsAwarded: 0,
  }));
}

describe('aggregateGamePoints', () => {
  it('SUM adds every entry', () => {
    assert.equal(aggregateGamePoints([100, 30], 'SUM'), 130);
  });

  it('BEST takes the highest single entry', () => {
    assert.equal(aggregateGamePoints([100, 30], 'BEST'), 100);
    assert.equal(aggregateGamePoints([30, 100], 'BEST'), 100);
  });

  it('is zero with no entries', () => {
    assert.equal(aggregateGamePoints([], 'SUM'), 0);
    assert.equal(aggregateGamePoints([], 'BEST'), 0);
  });
});

describe('buildLeaderboard', () => {
  it('orders by total points', () => {
    const rows = buildLeaderboard({
      teams: TEAMS,
      games: [game()],
      entries: oneEach('g1'),
      results: placings('g1', ['green', 'red', 'gold', 'blue']),
    });
    assert.deepEqual(rows.map((r) => r.teamId), ['green', 'red', 'gold', 'blue']);
    assert.deepEqual(rows.map((r) => r.totalPoints), [100, 70, 50, 30]);
  });

  // The whole point of §6.5 step 4: aggregation happens here, not in a column.
  it('applies SUM across a team\'s two entries', () => {
    const entries: ScoringEntry[] = [
      { id: 'e1', gameId: 'g1', teamId: 'red' },
      { id: 'e2', gameId: 'g1', teamId: 'red' },
      { id: 'e3', gameId: 'g1', teamId: 'blue' },
      { id: 'e4', gameId: 'g1', teamId: 'blue' },
    ];
    const results: ScoringResult[] = [
      { gameId: 'g1', entryId: 'e1', placement: 1, pointsAwarded: 0 },
      { gameId: 'g1', entryId: 'e2', placement: 4, pointsAwarded: 0 },
      { gameId: 'g1', entryId: 'e3', placement: 2, pointsAwarded: 0 },
      { gameId: 'g1', entryId: 'e4', placement: 3, pointsAwarded: 0 },
    ];

    const summed = buildLeaderboard({
      teams: TEAMS,
      games: [game({ entryAggregation: 'SUM' })],
      entries,
      results,
    });
    const byId = new Map(summed.map((r) => [r.teamId, r]));
    assert.equal(byId.get('red')!.totalPoints, 130, '100 + 30');
    assert.equal(byId.get('blue')!.totalPoints, 120, '70 + 50');
    assert.equal(byId.get('red')!.totalPoints > byId.get('blue')!.totalPoints, true);
  });

  it('applies BEST across a team\'s two entries, flipping the order', () => {
    const entries: ScoringEntry[] = [
      { id: 'e1', gameId: 'g1', teamId: 'red' },
      { id: 'e2', gameId: 'g1', teamId: 'red' },
      { id: 'e3', gameId: 'g1', teamId: 'blue' },
      { id: 'e4', gameId: 'g1', teamId: 'blue' },
    ];
    const results: ScoringResult[] = [
      { gameId: 'g1', entryId: 'e1', placement: 1, pointsAwarded: 0 },
      { gameId: 'g1', entryId: 'e2', placement: 4, pointsAwarded: 0 },
      { gameId: 'g1', entryId: 'e3', placement: 2, pointsAwarded: 0 },
      { gameId: 'g1', entryId: 'e4', placement: 3, pointsAwarded: 0 },
    ];

    const best = buildLeaderboard({
      teams: TEAMS,
      games: [game({ entryAggregation: 'BEST' })],
      entries,
      results,
    });
    const byId = new Map(best.map((r) => [r.teamId, r]));
    assert.equal(byId.get('red')!.totalPoints, 100);
    assert.equal(byId.get('blue')!.totalPoints, 70);
  });

  // SPEC.md §6.5: only a COMPLETE game contributes.
  it('ignores games that are not complete', () => {
    const rows = buildLeaderboard({
      teams: TEAMS,
      games: [game({ status: 'ACTIVE' })],
      entries: oneEach('g1'),
      results: placings('g1', ['green', 'red', 'gold', 'blue']),
    });
    assert.deepEqual(rows.map((r) => r.totalPoints), [0, 0, 0, 0]);
  });

  it('starts everyone at zero with no results at all', () => {
    const rows = buildLeaderboard({ teams: TEAMS, games: [], entries: [], results: [] });
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.totalPoints, 0);
      assert.deepEqual(row.perGame, []);
    }
  });

  // Undo's payoff: dropping a game's results changes the board with no
  // arithmetic to unwind.
  it('drops a game cleanly when its results go away', () => {
    const games = [game({ id: 'g1' }), game({ id: 'g2', name: 'Game Two', sortOrder: 1 })];
    const entries = [...oneEach('g1'), ...oneEach('g2')];
    const both = [
      ...placings('g1', ['red', 'blue', 'green', 'gold']),
      ...placings('g2', ['blue', 'red', 'green', 'gold']),
    ];

    const withBoth = buildLeaderboard({ teams: TEAMS, games, entries, results: both });
    assert.equal(withBoth.find((r) => r.teamId === 'red')!.totalPoints, 170);

    const withoutG2 = buildLeaderboard({
      teams: TEAMS,
      games,
      entries,
      results: both.filter((r) => r.gameId !== 'g2'),
    });
    assert.equal(withoutG2.find((r) => r.teamId === 'red')!.totalPoints, 100);
  });

  it('recomputes from the points matrix rather than the stored award', () => {
    const results = placings('g1', ['red', 'blue', 'green', 'gold']).map((r) => ({
      ...r,
      pointsAwarded: 9999,
    }));
    const rows = buildLeaderboard({
      teams: TEAMS,
      games: [game()],
      entries: oneEach('g1'),
      results,
    });
    assert.equal(rows[0].totalPoints, 100, 'the matrix decides, not the stored number');
  });

  it('is zero for a placement the matrix does not reach', () => {
    const rows = buildLeaderboard({
      teams: TEAMS,
      games: [game({ pointsMatrix: { '1': 100, '2': 70 } })],
      entries: oneEach('g1'),
      results: placings('g1', ['red', 'blue', 'green', 'gold']),
    });
    const byId = new Map(rows.map((r) => [r.teamId, r]));
    assert.equal(byId.get('green')!.totalPoints, 0, '3rd is beyond the matrix');
    assert.equal(byId.get('gold')!.totalPoints, 0);
  });
});

describe('global tie-breakers, in SPEC.md §6.5 order', () => {
  /*
   * Team names are BLUE, GOLD, GREEN, RED, so the stable fallback sorts them in
   * that order. Every case below deliberately makes the team that *should* win
   * the tie sort LAST alphabetically — otherwise the test would pass even with
   * the tie-breaker deleted, which is exactly what happened first time round.
   */

  it('2. breaks a points tie on the number of 1st-place finishes', () => {
    const flat = { '1': 50, '2': 50, '3': 0, '4': 0 };
    const games = [
      game({ id: 'g1', pointsMatrix: flat }),
      game({ id: 'g2', name: 'Two', pointsMatrix: flat, sortOrder: 1 }),
    ];
    const rows = buildLeaderboard({
      teams: TEAMS,
      games,
      entries: [...oneEach('g1'), ...oneEach('g2')],
      results: [
        // red wins both; blue is runner-up both times. Same points, and red
        // sorts after blue, so only the firsts count can put red on top.
        ...placings('g1', ['red', 'blue', 'green', 'gold']),
        ...placings('g2', ['red', 'blue', 'green', 'gold']),
      ],
    });
    const byId = new Map(rows.map((r) => [r.teamId, r]));
    assert.equal(byId.get('red')!.totalPoints, byId.get('blue')!.totalPoints, 'points tie');
    assert.equal(byId.get('red')!.firsts, 2);
    assert.equal(byId.get('blue')!.firsts, 0);
    assert.ok(
      rows.findIndex((r) => r.teamId === 'red') < rows.findIndex((r) => r.teamId === 'blue'),
      `more firsts should win: got ${rows.map((r) => r.teamId).join(',')}`,
    );
  });

  it('3. falls to 2nd-place finishes when points and firsts both tie', () => {
    // 2nd and 3rd both pay 50, so red (2nd) and blue (3rd) tie on points with
    // no firsts between them. red sorts last, so only the seconds count helps.
    const rows = buildLeaderboard({
      teams: TEAMS,
      games: [game({ id: 'g1', pointsMatrix: { '1': 0, '2': 50, '3': 50, '4': 0 } })],
      entries: oneEach('g1'),
      results: placings('g1', ['green', 'red', 'blue', 'gold']),
    });
    const byId = new Map(rows.map((r) => [r.teamId, r]));
    assert.equal(byId.get('red')!.totalPoints, byId.get('blue')!.totalPoints, 'points tie');
    assert.equal(byId.get('red')!.firsts, 0);
    assert.equal(byId.get('blue')!.firsts, 0);
    assert.equal(byId.get('red')!.seconds, 1);
    assert.equal(byId.get('blue')!.seconds, 0);
    assert.ok(
      rows.findIndex((r) => r.teamId === 'red') < rows.findIndex((r) => r.teamId === 'blue'),
      `a 2nd place should win the tie: got ${rows.map((r) => r.teamId).join(',')}`,
    );
  });

  /** red and blue dead level on points, firsts and seconds. */
  const deadLevel = {
    teams: TEAMS,
    games: [game({ id: 'g1', pointsMatrix: { '1': 50, '2': 50, '3': 0, '4': 0 } })],
    entries: oneEach('g1'),
    results: [
      { gameId: 'g1', entryId: 'g1-red', placement: 1, pointsAwarded: 0 },
      { gameId: 'g1', entryId: 'g1-blue', placement: 1, pointsAwarded: 0 },
      { gameId: 'g1', entryId: 'g1-green', placement: 3, pointsAwarded: 0 },
      { gameId: 'g1', entryId: 'g1-gold', placement: 4, pointsAwarded: 0 },
    ],
  };

  it('4. falls to head-to-head in round-robin games', () => {
    const rows = buildLeaderboard({
      ...deadLevel,
      // red won head to head, and red sorts last, so only this can lift it.
      headToHead: [{ teamA: 'red', teamB: 'blue', winsA: 2, winsB: 0 }],
    });
    assert.ok(
      rows.findIndex((r) => r.teamId === 'red') < rows.findIndex((r) => r.teamId === 'blue'),
      `red won head to head: got ${rows.map((r) => r.teamId).join(',')}`,
    );
  });

  it('4. reads head-to-head the same way round either way', () => {
    const forwards = buildLeaderboard({
      ...deadLevel,
      headToHead: [{ teamA: 'red', teamB: 'blue', winsA: 2, winsB: 0 }],
    });
    const backwards = buildLeaderboard({
      ...deadLevel,
      headToHead: [{ teamA: 'blue', teamB: 'red', winsA: 0, winsB: 2 }],
    });
    assert.deepEqual(forwards.map((r) => r.teamId), backwards.map((r) => r.teamId));
    assert.equal(forwards[0].teamId, 'red');
  });

  it('4. ignores a head-to-head record between other teams', () => {
    const rows = buildLeaderboard({
      ...deadLevel,
      headToHead: [{ teamA: 'green', teamB: 'gold', winsA: 5, winsB: 0 }],
    });
    // Nothing separates red and blue, so the stable fallback applies.
    assert.ok(
      rows.findIndex((r) => r.teamId === 'blue') < rows.findIndex((r) => r.teamId === 'red'),
    );
  });

  it('5. falls to the admin override, and records the reason', () => {
    const rows = buildLeaderboard({
      ...deadLevel,
      // The override favours red, which sorts last, so only the override helps.
      overrides: [{ teamId: 'red', priority: 0, reason: 'Red won the coin flip' }],
    });
    assert.ok(
      rows.findIndex((r) => r.teamId === 'red') < rows.findIndex((r) => r.teamId === 'blue'),
      `the override should decide: got ${rows.map((r) => r.teamId).join(',')}`,
    );
    assert.equal(rows.find((r) => r.teamId === 'red')!.overrideReason, 'Red won the coin flip');
  });

  it('5. is only consulted after head-to-head', () => {
    const rows = buildLeaderboard({
      ...deadLevel,
      headToHead: [{ teamA: 'red', teamB: 'blue', winsA: 2, winsB: 0 }],
      overrides: [{ teamId: 'blue', priority: 0, reason: 'should not apply' }],
    });
    assert.ok(
      rows.findIndex((r) => r.teamId === 'red') < rows.findIndex((r) => r.teamId === 'blue'),
      'head-to-head outranks the override',
    );
  });

  it('does not claim an override decided anything it did not', () => {
    const rows = buildLeaderboard({
      teams: TEAMS,
      games: [game()],
      entries: oneEach('g1'),
      results: placings('g1', ['red', 'blue', 'green', 'gold']),
      overrides: [{ teamId: 'gold', priority: 0, reason: 'unused' }],
    });
    assert.equal(rows.at(-1)!.teamId, 'gold', 'gold is last on points alone');
    assert.equal(rows.at(-1)!.overrideReason, null);
  });

  // With everything level the order has to be meaningful rather than whatever
  // order the rows happened to arrive in.
  it('orders a completely level board by team name', () => {
    // Nothing played at all, so points, firsts and seconds are all zero and
    // only the fallback is left. Teams are passed in reverse to prove the
    // ordering is not just whatever order they arrived in.
    const rows = buildLeaderboard({
      teams: [...TEAMS].reverse(),
      games: [],
      entries: [],
      results: [],
    });
    assert.deepEqual(rows.map((r) => r.teamName), ['BLUE', 'GOLD', 'GREEN', 'RED']);
  });

  it('is stable so polling never reshuffles a tied board', () => {
    const input = {
      teams: TEAMS,
      games: [game({ pointsMatrix: { '1': 0, '2': 0, '3': 0, '4': 0 } })],
      entries: oneEach('g1'),
      results: placings('g1', ['red', 'blue', 'green', 'gold']),
    };
    assert.deepEqual(
      buildLeaderboard(input).map((r) => r.teamId),
      buildLeaderboard(input).map((r) => r.teamId),
    );
  });

  it('keeps a per-game breakdown for every scoring game', () => {
    const games = [game({ id: 'g1' }), game({ id: 'g2', name: 'Two', sortOrder: 1 })];
    const rows = buildLeaderboard({
      teams: TEAMS,
      games,
      entries: [...oneEach('g1'), ...oneEach('g2')],
      results: [
        ...placings('g1', ['red', 'blue', 'green', 'gold']),
        ...placings('g2', ['blue', 'red', 'green', 'gold']),
      ],
    });
    const red = rows.find((r) => r.teamId === 'red')!;
    assert.deepEqual(red.perGame.map((g) => [g.gameName, g.points]), [
      ['Game One', 100],
      ['Two', 70],
    ]);
    assert.equal(red.firsts, 1);
    assert.equal(red.seconds, 1);
  });

  // bestPlacement drives the firsts and seconds counts, so it has to be the
  // team's best entry, not its worst.
  it('credits a team with a 1st when either of its entries wins', () => {
    const entries: ScoringEntry[] = [
      { id: 'e1', gameId: 'g1', teamId: 'red' },
      { id: 'e2', gameId: 'g1', teamId: 'red' },
    ];
    const rows = buildLeaderboard({
      teams: TEAMS,
      games: [game()],
      entries,
      results: [
        { gameId: 'g1', entryId: 'e1', placement: 4, pointsAwarded: 0 },
        { gameId: 'g1', entryId: 'e2', placement: 1, pointsAwarded: 0 },
      ],
    });
    const red = rows.find((r) => r.teamId === 'red')!;
    assert.equal(red.perGame[0].bestPlacement, 1, 'the better entry counts');
    assert.equal(red.firsts, 1);
    assert.equal(red.seconds, 0);
  });
});

describe('a head-to-head cycle in the leaderboard', () => {
  const level = {
    teams: TEAMS,
    games: [game({ id: 'g1', pointsMatrix: { '1': 50, '2': 50, '3': 50, '4': 0 } })],
    entries: oneEach('g1'),
    results: [
      { gameId: 'g1', entryId: 'g1-red', placement: 1, pointsAwarded: 0 },
      { gameId: 'g1', entryId: 'g1-blue', placement: 1, pointsAwarded: 0 },
      { gameId: 'g1', entryId: 'g1-green', placement: 1, pointsAwarded: 0 },
      { gameId: 'g1', entryId: 'g1-gold', placement: 4, pointsAwarded: 0 },
    ],
  };

  // red beats blue, blue beats green, green beats red. Nobody leads the mini
  // table, so the order must come from the next rule rather than from whichever
  // comparison the sort happened to make first.
  const cycle = [
    { teamA: 'red', teamB: 'blue', winsA: 1, winsB: 0 },
    { teamA: 'blue', teamB: 'green', winsA: 1, winsB: 0 },
    { teamA: 'green', teamB: 'red', winsA: 1, winsB: 0 },
  ];

  it('is deterministic and falls through to the stable order', () => {
    const first = buildLeaderboard({ ...level, headToHead: cycle }).map((r) => r.teamId);
    const second = buildLeaderboard({ ...level, headToHead: cycle }).map((r) => r.teamId);
    assert.deepEqual(first, second);

    // All three are level on the mini table, so alphabetical decides.
    assert.deepEqual(first.slice(0, 3), ['blue', 'green', 'red']);
  });

  it('does not depend on the order the teams arrive in', () => {
    const forwards = buildLeaderboard({ ...level, headToHead: cycle }).map((r) => r.teamId);
    const backwards = buildLeaderboard({
      ...level,
      teams: [...TEAMS].reverse(),
      headToHead: cycle,
    }).map((r) => r.teamId);
    assert.deepEqual(forwards, backwards);
  });

  it('still lets a clear mini-table leader win', () => {
    const rows = buildLeaderboard({
      ...level,
      // red beat both of the others; no cycle.
      headToHead: [
        { teamA: 'red', teamB: 'blue', winsA: 1, winsB: 0 },
        { teamA: 'red', teamB: 'green', winsA: 1, winsB: 0 },
        { teamA: 'blue', teamB: 'green', winsA: 1, winsB: 0 },
      ],
    });
    assert.deepEqual(rows.slice(0, 3).map((r) => r.teamId), ['red', 'blue', 'green']);
  });

  it('ignores head-to-head against teams outside the tied group', () => {
    const rows = buildLeaderboard({
      ...level,
      // gold is not in the tied group, so beating it must not count.
      headToHead: [
        { teamA: 'blue', teamB: 'gold', winsA: 5, winsB: 0 },
        { teamA: 'red', teamB: 'green', winsA: 1, winsB: 0 },
      ],
    });
    // red beat green inside the group, so red leads; blue's wins over gold
    // count for nothing.
    assert.equal(rows[0].teamId, 'red');
  });
});
