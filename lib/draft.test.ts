import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  authorizePick,
  currentSlot,
  draftOrder,
  picksPerPosition,
  slotForPick,
  totalPicksFor,
  upcomingSlots,
} from './draft';

const TEAMS = 4;
const PICKS = 13;

describe('the actual event: 4 teams, 13 picks (SPEC.md §1.1)', () => {
  // Written out longhand from the table in SPEC.md §1.1 rather than computed,
  // so the test disagrees with the code if the code is wrong.
  const EXPECTED_POSITIONS = [
    1, 2, 3, 4, // round 1, forwards
    4, 3, 2, 1, // round 2, backwards
    1, 2, 3, 4, // round 3, forwards
    4, //          round 4, backwards, one pick only
  ];

  it('produces exactly the order the spec lays out', () => {
    const actual = draftOrder(PICKS, TEAMS).map((slot) => slot.draftPosition);
    assert.deepEqual(actual, EXPECTED_POSITIONS);
  });

  it('gives pick 13 to the captain who picked 4th in round one', () => {
    const slot = slotForPick(13, TEAMS);
    assert.equal(slot.draftPosition, 4);
    assert.equal(slot.round, 4);
    assert.equal(slot.indexInRound, 1);
  });

  // The 5-player team is intentional and self-balancing. If this ever comes out
  // 4/4/4/4 or 3/4/4/5, someone has "fixed" it.
  it('leaves position 4 with one extra player and the rest even', () => {
    assert.deepEqual(picksPerPosition(PICKS, TEAMS), [3, 3, 3, 4]);
  });

  it('adds up to 17 players across 4 teams once captains are counted', () => {
    const rosters = picksPerPosition(PICKS, TEAMS).map((picks) => picks + 1);
    assert.deepEqual(rosters, [4, 4, 4, 5]);
    assert.equal(rosters.reduce((a, b) => a + b, 0), 17);
  });

  it('derives 13 picks from 17 players and 4 captains', () => {
    assert.equal(totalPicksFor(17, 4), PICKS);
  });

  it('numbers rounds and positions within them correctly', () => {
    assert.deepEqual(slotForPick(1, TEAMS), {
      pickNumber: 1, round: 1, indexInRound: 1, draftPosition: 1,
    });
    assert.deepEqual(slotForPick(4, TEAMS), {
      pickNumber: 4, round: 1, indexInRound: 4, draftPosition: 4,
    });
    assert.deepEqual(slotForPick(5, TEAMS), {
      pickNumber: 5, round: 2, indexInRound: 1, draftPosition: 4,
    });
    assert.deepEqual(slotForPick(8, TEAMS), {
      pickNumber: 8, round: 2, indexInRound: 4, draftPosition: 1,
    });
    assert.deepEqual(slotForPick(9, TEAMS), {
      pickNumber: 9, round: 3, indexInRound: 1, draftPosition: 1,
    });
  });

  // The boundary between rounds is where an off-by-one would hide: picks 4 and 5
  // both belong to position 4, which is the whole point of a snake.
  it('has the same team pick back-to-back across a round boundary', () => {
    assert.equal(slotForPick(4, TEAMS).draftPosition, slotForPick(5, TEAMS).draftPosition);
    assert.equal(slotForPick(8, TEAMS).draftPosition, slotForPick(9, TEAMS).draftPosition);
    assert.equal(slotForPick(12, TEAMS).draftPosition, slotForPick(13, TEAMS).draftPosition);
  });
});

describe('currentSlot', () => {
  it('is pick 1 before anyone has picked', () => {
    assert.equal(currentSlot(0, PICKS, TEAMS)?.pickNumber, 1);
    assert.equal(currentSlot(0, PICKS, TEAMS)?.draftPosition, 1);
  });

  it('advances one pick at a time through the whole draft', () => {
    for (let made = 0; made < PICKS; made += 1) {
      const slot = currentSlot(made, PICKS, TEAMS);
      assert.equal(slot?.pickNumber, made + 1, `after ${made} picks`);
    }
  });

  it('is null once every pick is in', () => {
    assert.equal(currentSlot(PICKS, PICKS, TEAMS), null);
    assert.equal(currentSlot(PICKS + 5, PICKS, TEAMS), null);
  });

  it('is on position 4 for the final pick', () => {
    assert.equal(currentSlot(12, PICKS, TEAMS)?.draftPosition, 4);
  });
});

describe('upcomingSlots', () => {
  it('shows the next three picks after the one on the clock', () => {
    assert.deepEqual(
      upcomingSlots(0, PICKS, TEAMS).map((s) => [s.pickNumber, s.draftPosition]),
      [[2, 2], [3, 3], [4, 4]],
    );
  });

  it('spans a round boundary correctly', () => {
    assert.deepEqual(
      upcomingSlots(2, PICKS, TEAMS).map((s) => [s.pickNumber, s.draftPosition]),
      [[4, 4], [5, 4], [6, 3]],
    );
  });

  it('runs dry near the end rather than inventing picks', () => {
    assert.equal(upcomingSlots(11, PICKS, TEAMS).length, 1);
    assert.equal(upcomingSlots(12, PICKS, TEAMS).length, 0);
    assert.equal(upcomingSlots(PICKS, PICKS, TEAMS).length, 0);
  });
});

describe('generalises beyond 4 teams and 13 picks', () => {
  it('handles an exact number of full rounds', () => {
    assert.deepEqual(
      draftOrder(8, 4).map((s) => s.draftPosition),
      [1, 2, 3, 4, 4, 3, 2, 1],
    );
    assert.deepEqual(picksPerPosition(8, 4), [2, 2, 2, 2]);
  });

  it('handles a single team', () => {
    assert.deepEqual(draftOrder(3, 1).map((s) => s.draftPosition), [1, 1, 1]);
  });

  it('handles two teams', () => {
    assert.deepEqual(draftOrder(6, 2).map((s) => s.draftPosition), [1, 2, 2, 1, 1, 2]);
  });

  it('handles a partial final round for a different shape', () => {
    // 6 teams, 15 picks: two full rounds then three picks of round 3.
    assert.deepEqual(
      draftOrder(15, 6).map((s) => s.draftPosition),
      [1, 2, 3, 4, 5, 6, 6, 5, 4, 3, 2, 1, 1, 2, 3],
    );
  });

  it('returns nothing for a draft with no picks', () => {
    assert.deepEqual(draftOrder(0, 4), []);
    assert.deepEqual(picksPerPosition(0, 4), [0, 0, 0, 0]);
  });

  it('always assigns a position inside 1..teamCount', () => {
    for (const teams of [1, 2, 3, 4, 5, 8]) {
      for (const slot of draftOrder(teams * 5 + 2, teams)) {
        assert.ok(
          slot.draftPosition >= 1 && slot.draftPosition <= teams,
          `${teams} teams, pick ${slot.pickNumber} -> ${slot.draftPosition}`,
        );
      }
    }
  });

  it('never gives one position two picks more than another', () => {
    for (const teams of [2, 3, 4, 6]) {
      for (const picks of [1, 5, 7, 13, 20, 25]) {
        const counts = picksPerPosition(picks, teams);
        assert.ok(
          Math.max(...counts) - Math.min(...counts) <= 1,
          `${teams} teams, ${picks} picks -> ${counts.join(',')}`,
        );
      }
    }
  });
});

describe('rejects nonsense input instead of returning a wrong answer', () => {
  it('throws on a bad pick number', () => {
    for (const bad of [0, -1, 1.5, NaN]) {
      assert.throws(() => slotForPick(bad, TEAMS), /pickNumber/);
    }
  });

  it('throws on a bad team count', () => {
    for (const bad of [0, -2, 2.5, NaN]) {
      assert.throws(() => slotForPick(1, bad), /teamCount/);
    }
  });

  it('throws on a negative total', () => {
    assert.throws(() => draftOrder(-1, TEAMS), /totalPicks/);
  });
});

describe('authorizePick — SPEC.md §5.2 server-side enforcement', () => {
  const CAPTAIN_ON_CLOCK = 'captain-on-the-clock';
  const OTHER_CAPTAIN = 'some-other-captain';

  const base = {
    status: 'LIVE' as const,
    paused: false,
    submitterId: CAPTAIN_ON_CLOCK,
    submitterIsAdmin: false,
    onTheClockCaptainId: CAPTAIN_ON_CLOCK,
    onTheClockTeamName: 'Team Three',
  };

  it('lets the captain on the clock pick', () => {
    assert.deepEqual(authorizePick(base), { allowed: true, onBehalf: false });
  });

  // The whole point: a stale page still showing a DRAFT button must not work.
  it('refuses a captain whose turn it is not, and names who it belongs to', () => {
    const verdict = authorizePick({ ...base, submitterId: OTHER_CAPTAIN });
    assert.equal(verdict.allowed, false);
    assert.ok(!verdict.allowed && verdict.reason.includes('Team Three'));
  });

  it('lets the admin pick on behalf of whoever is on the clock', () => {
    assert.deepEqual(
      authorizePick({ ...base, submitterId: OTHER_CAPTAIN, submitterIsAdmin: true }),
      { allowed: true, onBehalf: true },
    );
  });

  it('does not flag the admin as picking on behalf when it is their own turn', () => {
    assert.deepEqual(
      authorizePick({ ...base, submitterIsAdmin: true }),
      { allowed: true, onBehalf: false },
    );
  });

  it('refuses anyone who is not signed in', () => {
    const verdict = authorizePick({ ...base, submitterId: null });
    assert.equal(verdict.allowed, false);
    assert.ok(!verdict.allowed && /sign in/i.test(verdict.reason));
  });

  it('refuses a signed-out admin flag — no identity means no pick', () => {
    assert.equal(
      authorizePick({ ...base, submitterId: null, submitterIsAdmin: true }).allowed,
      false,
    );
  });

  it('refuses while the draft is paused, even for the right captain', () => {
    const verdict = authorizePick({ ...base, paused: true });
    assert.equal(verdict.allowed, false);
    assert.ok(!verdict.allowed && /paused/i.test(verdict.reason));
  });

  it('refuses a paused draft for the admin too', () => {
    assert.equal(authorizePick({ ...base, paused: true, submitterIsAdmin: true }).allowed, false);
  });

  it('refuses unless the draft is live', () => {
    for (const status of ['NOT_STARTED', 'COMPLETE'] as const) {
      const verdict = authorizePick({ ...base, status });
      assert.equal(verdict.allowed, false, status);
      assert.ok(!verdict.allowed && /not live/i.test(verdict.reason), status);
    }
  });

  it('refuses when nobody is on the clock', () => {
    const verdict = authorizePick({ ...base, onTheClockCaptainId: null });
    assert.equal(verdict.allowed, false);
  });

  it('checks status before turn, so a finished draft says so rather than blaming a team', () => {
    const verdict = authorizePick({
      ...base,
      status: 'COMPLETE',
      submitterId: OTHER_CAPTAIN,
    });
    assert.ok(!verdict.allowed && /not live/i.test(verdict.reason));
  });
});
