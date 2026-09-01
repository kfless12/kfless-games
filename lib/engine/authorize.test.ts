import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Identity } from '@/lib/auth';

import { authorizeSubmission } from './submit';

/*
 * SPEC.md §8: "Who can submit: admin, plus either captain involved in a match."
 *
 * Pure, so the rule is tested directly rather than only through a request. The
 * point of distributing it is that one person entering every result for three
 * days is a single point of failure — but "either captain involved" has to mean
 * involved, not any captain.
 */

const RED = 'team-red';
const BLUE = 'team-blue';
const GREEN = 'team-green';

function identity(role: Identity['role'], teamId: string | null): Identity {
  return { personId: `person-${role}-${teamId}`, teamId, role };
}

describe('authorizeSubmission', () => {
  const inMatch = [RED, BLUE];

  it('lets the admin report any match', () => {
    const verdict = authorizeSubmission({
      identity: identity('ADMIN', GREEN),
      teamIdsInMatch: inMatch,
      captainTeamId: GREEN,
    });
    assert.equal(verdict.allowed, true);
  });

  it('lets a captain report a match their team is in', () => {
    for (const teamId of inMatch) {
      const verdict = authorizeSubmission({
        identity: identity('CAPTAIN', teamId),
        teamIdsInMatch: inMatch,
        captainTeamId: teamId,
      });
      assert.equal(verdict.allowed, true, `captain of ${teamId}`);
    }
  });

  // "Either captain involved" — a captain of some other team is not involved.
  it('refuses a captain whose team is not in the match', () => {
    const verdict = authorizeSubmission({
      identity: identity('CAPTAIN', GREEN),
      teamIdsInMatch: inMatch,
      captainTeamId: GREEN,
    });
    assert.equal(verdict.allowed, false);
    assert.ok(verdict.reason?.includes('captain playing in this match'));
  });

  it('refuses a plain player, even one on a team in the match', () => {
    const verdict = authorizeSubmission({
      identity: identity('PLAYER', RED),
      teamIdsInMatch: inMatch,
      captainTeamId: RED,
    });
    assert.equal(verdict.allowed, false);
  });

  it('refuses anyone not signed in', () => {
    const verdict = authorizeSubmission({
      identity: null,
      teamIdsInMatch: inMatch,
      captainTeamId: RED,
    });
    assert.equal(verdict.allowed, false);
    assert.ok(/sign in/i.test(verdict.reason ?? ''));
  });

  // A captain with no team cannot be "involved" in anything.
  it('refuses a captain with no team', () => {
    const verdict = authorizeSubmission({
      identity: identity('CAPTAIN', null),
      teamIdsInMatch: inMatch,
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
      teamIdsInMatch: inMatch,
      captainTeamId: GREEN,
    });
    assert.equal(verdict.allowed, false);
  });

  it('handles a same-team match, where both entries belong to one team', () => {
    const verdict = authorizeSubmission({
      identity: identity('CAPTAIN', RED),
      teamIdsInMatch: [RED],
      captainTeamId: RED,
    });
    assert.equal(verdict.allowed, true, 'their own two entries playing each other');
  });

  it('refuses when the match has no teams resolved yet', () => {
    const verdict = authorizeSubmission({
      identity: identity('CAPTAIN', RED),
      teamIdsInMatch: [],
      captainTeamId: RED,
    });
    assert.equal(verdict.allowed, false);
  });

  it('reports the teams in the match, for the message', () => {
    const verdict = authorizeSubmission({
      identity: identity('CAPTAIN', GREEN),
      teamIdsInMatch: inMatch,
      captainTeamId: GREEN,
    });
    assert.deepEqual(verdict.teamIds, inMatch);
  });
});
