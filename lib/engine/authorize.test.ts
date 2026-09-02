import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Identity } from '@/lib/auth';

import { authorizeSubmission } from './submit';

/*
 * SPEC.md §8: admin, either captain involved in the match, and — for a game
 * played by part of a team — any player assigned to an entry in it.
 *
 * Pure, so the rule is tested directly rather than only through a request. The
 * point of distributing it is that one person entering every result for three
 * days is a single point of failure — but "either captain involved" has to mean
 * involved, not any captain, and the player clause must not leak into whole-team
 * games, where every player is on one side or the other.
 */

const RED = 'team-red';
const BLUE = 'team-blue';
const GREEN = 'team-green';

function identity(role: Identity['role'], teamId: string | null): Identity {
  return { personId: `person-${role}-${teamId}`, teamId, role };
}

/** Entries with nobody assigned — the common case, since §4.4 is optional. */
function unassigned(...teamIds: string[]) {
  return teamIds.map((teamId) => ({ teamId, playerIds: [] as string[] }));
}

describe('authorizeSubmission', () => {
  const inMatch = [RED, BLUE];

  it('lets the admin report any match', () => {
    const verdict = authorizeSubmission({
      identity: identity('ADMIN', GREEN),
      entriesInMatch: unassigned(...inMatch),
      wholeTeamGame: false,
      captainTeamId: GREEN,
    });
    assert.equal(verdict.allowed, true);
  });

  it('lets a captain report a match their team is in', () => {
    for (const teamId of inMatch) {
      const verdict = authorizeSubmission({
        identity: identity('CAPTAIN', teamId),
        entriesInMatch: unassigned(...inMatch),
      wholeTeamGame: false,
        captainTeamId: teamId,
      });
      assert.equal(verdict.allowed, true, `captain of ${teamId}`);
    }
  });

  // "Either captain involved" — a captain of some other team is not involved.
  it('refuses a captain whose team is not in the match', () => {
    const verdict = authorizeSubmission({
      identity: identity('CAPTAIN', GREEN),
      entriesInMatch: unassigned(...inMatch),
      wholeTeamGame: false,
      captainTeamId: GREEN,
    });
    assert.equal(verdict.allowed, false);
    // Part-team wording; the whole-team refusal is asserted in the suite below.
    assert.ok(/player in this match/.test(verdict.reason ?? ''), verdict.reason);
  });

  it('refuses a plain player on a team in the match who is not assigned to an entry', () => {
    const verdict = authorizeSubmission({
      identity: identity('PLAYER', RED),
      entriesInMatch: unassigned(...inMatch),
      wholeTeamGame: false,
      captainTeamId: RED,
    });
    assert.equal(verdict.allowed, false);
  });

  it('refuses anyone not signed in', () => {
    const verdict = authorizeSubmission({
      identity: null,
      entriesInMatch: unassigned(...inMatch),
      wholeTeamGame: false,
      captainTeamId: RED,
    });
    assert.equal(verdict.allowed, false);
    assert.ok(/sign in/i.test(verdict.reason ?? ''));
  });

  // A captain with no team cannot be "involved" in anything.
  it('refuses a captain with no team', () => {
    const verdict = authorizeSubmission({
      identity: identity('CAPTAIN', null),
      entriesInMatch: unassigned(...inMatch),
      wholeTeamGame: false,
      captainTeamId: null,
    });
    assert.equal(verdict.allowed, false);
  });

  it('does not let a captain claim a team they are not on', () => {
    // The role says CAPTAIN and the match contains RED, but this person's own
    // team is GREEN — captainTeamId is what identify() resolved, not a claim
    // from the request.
    const verdict = authorizeSubmission({
      identity: { personId: 'p', teamId: GREEN, role: 'CAPTAIN' },
      entriesInMatch: unassigned(...inMatch),
      wholeTeamGame: false,
      captainTeamId: GREEN,
    });
    assert.equal(verdict.allowed, false);
  });

  it('handles a same-team match, where both entries belong to one team', () => {
    const verdict = authorizeSubmission({
      identity: identity('CAPTAIN', RED),
      entriesInMatch: unassigned(RED),
      wholeTeamGame: false,
      captainTeamId: RED,
    });
    assert.equal(verdict.allowed, true, 'their own two entries playing each other');
  });

  it('refuses when the match has no teams resolved yet', () => {
    const verdict = authorizeSubmission({
      identity: identity('CAPTAIN', RED),
      entriesInMatch: [],
      wholeTeamGame: false,
      captainTeamId: RED,
    });
    assert.equal(verdict.allowed, false);
  });

  it('reports the teams in the match, for the message', () => {
    const verdict = authorizeSubmission({
      identity: identity('CAPTAIN', GREEN),
      entriesInMatch: unassigned(...inMatch),
      wholeTeamGame: false,
      captainTeamId: GREEN,
    });
    assert.deepEqual(verdict.teamIds, inMatch);
  });
});

/*
 * The widening. These are the tests that would have caught it going wrong, and
 * the ones that matter most: this function is the only thing standing between a
 * guest and someone else's scoreboard.
 */
describe('authorizeSubmission — assigned players (SPEC.md §8)', () => {
  const inMatch = [RED, BLUE];
  const ALICE = 'person-alice';
  const BOB = 'person-bob';

  function assigned() {
    return [
      { teamId: RED, playerIds: [ALICE] },
      { teamId: BLUE, playerIds: [BOB] },
    ];
  }

  function player(personId: string, teamId: string | null): Identity {
    return { personId, teamId, role: 'PLAYER' };
  }

  it('lets a player assigned to an entry report the match', () => {
    const verdict = authorizeSubmission({
      identity: player(ALICE, RED),
      entriesInMatch: assigned(),
      captainTeamId: RED,
      wholeTeamGame: false,
    });
    assert.equal(verdict.allowed, true);
  });

  it('lets the opposing assigned player report it too', () => {
    const verdict = authorizeSubmission({
      identity: player(BOB, BLUE),
      entriesInMatch: assigned(),
      captainTeamId: BLUE,
      wholeTeamGame: false,
    });
    assert.equal(verdict.allowed, true);
  });

  // The transition: the same person, the same match, before and after being
  // assigned. If this passed both ways the assignment would mean nothing.
  it('refuses that same player before they are assigned', () => {
    const before = authorizeSubmission({
      identity: player(ALICE, RED),
      entriesInMatch: unassigned(...inMatch),
      captainTeamId: RED,
      wholeTeamGame: false,
    });
    const after = authorizeSubmission({
      identity: player(ALICE, RED),
      entriesInMatch: assigned(),
      captainTeamId: RED,
      wholeTeamGame: false,
    });
    assert.equal(before.allowed, false, 'unassigned player must not be allowed');
    assert.equal(after.allowed, true, 'assigning them must grant it');
  });

  it('refuses a teammate who was not assigned to either entry', () => {
    const verdict = authorizeSubmission({
      identity: player('person-carol', RED),
      entriesInMatch: assigned(),
      captainTeamId: RED,
      wholeTeamGame: false,
    });
    assert.equal(verdict.allowed, false, 'being on the team is not being in the match');
  });

  it('refuses an assigned player from an entry in a different match', () => {
    const verdict = authorizeSubmission({
      identity: player('person-dave', GREEN),
      entriesInMatch: assigned(),
      captainTeamId: GREEN,
      wholeTeamGame: false,
    });
    assert.equal(verdict.allowed, false);
  });

  // The clause must not leak into whole-team games: there, every player on both
  // teams is "in the match", so honouring assignments would let anyone score it.
  it('ignores assignments in a whole-team game', () => {
    const verdict = authorizeSubmission({
      identity: player(ALICE, RED),
      entriesInMatch: assigned(),
      captainTeamId: RED,
      wholeTeamGame: true,
    });
    assert.equal(verdict.allowed, false);
    assert.ok(verdict.reason?.includes('captain playing in this match'));
  });

  it('still lets the captain report a whole-team game', () => {
    const verdict = authorizeSubmission({
      identity: identity('CAPTAIN', RED),
      entriesInMatch: assigned(),
      captainTeamId: RED,
      wholeTeamGame: true,
    });
    assert.equal(verdict.allowed, true);
  });

  // §4.4 makes assignment optional, so captains keep their rights whatever the
  // entries say. An unassigned entry must never become unscoreable.
  it('keeps the captain allowed when only the other entry is assigned', () => {
    const verdict = authorizeSubmission({
      identity: identity('CAPTAIN', BLUE),
      entriesInMatch: [
        { teamId: RED, playerIds: [ALICE] },
        { teamId: BLUE, playerIds: [] },
      ],
      captainTeamId: BLUE,
      wholeTeamGame: false,
    });
    assert.equal(verdict.allowed, true);
  });

  it('names players in the refusal for a part-team game', () => {
    const verdict = authorizeSubmission({
      identity: player('person-carol', RED),
      entriesInMatch: assigned(),
      captainTeamId: RED,
      wholeTeamGame: false,
    });
    assert.ok(/player in this match/.test(verdict.reason ?? ''), verdict.reason);
  });
});
