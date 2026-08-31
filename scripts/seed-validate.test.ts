import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SEED_PLAYERS, SEED_TEAMS, type SeedPlayer, type SeedTeam } from './seed-data';
import { validateRoster } from './seed-validate';

function players(): SeedPlayer[] {
  return SEED_PLAYERS.map((p) => ({ ...p }));
}

function teams(): SeedTeam[] {
  return SEED_TEAMS.map((t) => ({ ...t }));
}

/** Asserts the roster is rejected, and that the reason mentions `because`. */
function expectRejected(p: SeedPlayer[], t: SeedTeam[], because: string) {
  const problems = validateRoster(p, t);
  assert.ok(problems.length > 0, `expected a problem mentioning "${because}"`);
  assert.ok(
    problems.some((problem) => problem.toLowerCase().includes(because.toLowerCase())),
    `expected a problem mentioning "${because}", got: ${problems.join(' | ')}`,
  );
}

describe('the roster in seed-data.ts', () => {
  // Guards the real edit: someone replacing 17 placeholder names by hand.
  it('is valid as committed', () => {
    assert.deepEqual(validateRoster(SEED_PLAYERS, SEED_TEAMS), []);
  });
});

describe('validateRoster', () => {
  it('rejects the wrong number of players', () => {
    expectRejected(players().slice(0, 16), teams(), '17 players');
    expectRejected([...players(), { fullName: 'Extra', email: 'x@example.com' }], teams(), '17 players');
  });

  it('rejects the wrong number of captains', () => {
    const p = players();
    p[1].isCaptain = false;
    expectRejected(p, teams(), 'captains');
  });

  it('rejects zero or two admins', () => {
    const none = players().map((x) => ({ ...x, isAdmin: false }));
    expectRejected(none, teams(), '1 admin');

    const two = players();
    two[1].isAdmin = true;
    expectRejected(two, teams(), '1 admin');
  });

  it('rejects duplicate emails, case-insensitively', () => {
    const p = players();
    p[5].email = p[4].email.toUpperCase();
    expectRejected(p, teams(), 'duplicate emails');
  });

  it('rejects a blank name and a malformed email', () => {
    const blank = players();
    blank[3].fullName = '   ';
    expectRejected(blank, teams(), 'blank name');

    const bad = players();
    bad[3].email = 'not-an-email';
    expectRejected(bad, teams(), 'not an email');
  });

  // SPEC.md §1.1: position 4 takes pick 13 and ends with 5 players, so the
  // positions have to be exactly 1..4 with no repeats.
  it('rejects draft positions that are not 1,2,3,4', () => {
    const dup = teams();
    dup[0].draftPosition = 2;
    expectRejected(players(), dup, 'draft positions');

    const outOfRange = teams();
    outOfRange[0].draftPosition = 5;
    expectRejected(players(), outOfRange, 'draft positions');
  });

  it('rejects a team captained by someone who is not a captain', () => {
    const t = teams();
    t[0].captainEmail = SEED_PLAYERS.find((p) => !p.isCaptain)!.email;
    expectRejected(players(), t, 'is not a captain');
  });

  it('rejects one person captaining two teams', () => {
    const t = teams();
    t[1].captainEmail = t[0].captainEmail;
    expectRejected(players(), t, 'more than one team');
  });

  it('rejects a colour that is not #rrggbb', () => {
    for (const bad of ['red', '#fff', '#GGGGGG', 'b91c1c', '#b91c1c1']) {
      const t = teams();
      t[0].colorHex = bad;
      expectRejected(players(), t, 'not #rrggbb');
    }
  });

  it('accepts uppercase hex colours', () => {
    const t = teams();
    t[0].colorHex = '#B91C1C';
    assert.deepEqual(validateRoster(players(), t), []);
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const p = players().slice(0, 16).map((x) => ({ ...x, isAdmin: false }));
    const problems = validateRoster(p, teams().slice(0, 3));
    assert.ok(problems.length >= 3, `expected several problems, got: ${problems.join(' | ')}`);
  });
});
