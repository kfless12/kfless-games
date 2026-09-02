import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { entryLetter, initialsOf, shortEntryLabel, teamTag } from './entries';

describe('entryLetter', () => {
  it('takes the letter off a generated label', () => {
    assert.equal(entryLetter('Team One — A'), 'A');
    assert.equal(entryLetter('Team Three — B'), 'B');
  });

  it('returns null for a whole-team label with no suffix', () => {
    assert.equal(entryLetter('Team One'), null);
    assert.equal(entryLetter(null), null);
  });

  it('reads the trailing letter even when the team name contains a dash', () => {
    // Captains can rename a team to anything, em dash included, and the entry
    // label keeps the old name. The suffix is still the last thing on the line.
    assert.equal(entryLetter('Salt — Pepper — C'), 'C');
  });

  it('ignores a lone trailing letter with no dash', () => {
    assert.equal(entryLetter('Team A'), null);
  });
});

describe('initialsOf', () => {
  it('uses first and last initial', () => {
    assert.equal(initialsOf('Kevin Flessa'), 'KF');
  });

  it('skips middle names rather than running them together', () => {
    assert.equal(initialsOf('Mary Jane Watson'), 'MW');
  });

  it('gives a one-word name two letters, not one', () => {
    assert.equal(initialsOf('Madonna'), 'MA');
  });

  it('survives extra whitespace and empty input', () => {
    assert.equal(initialsOf('  Kevin   Flessa  '), 'KF');
    assert.equal(initialsOf('   '), '?');
  });
});

describe('teamTag', () => {
  it('tags by draft position', () => {
    assert.equal(teamTag(1), 'T1');
    assert.equal(teamTag(4), 'T4');
    assert.equal(teamTag(null), null);
  });
});

describe('shortEntryLabel', () => {
  const base = {
    label: 'Team One — A',
    teamName: 'Team One',
    teamDraftPosition: 1,
    playerNames: [] as string[],
  };

  it('uses the team name for a whole-team game', () => {
    assert.equal(
      shortEntryLabel({ ...base, label: 'Team One', playerNames: ['Kevin Flessa'] }, true),
      'Team One',
    );
  });

  it('uses tag plus initials once players are assigned', () => {
    assert.equal(
      shortEntryLabel({ ...base, playerNames: ['Kevin Flessa', 'Jake Dean'] }, false),
      'T1 KF/JD',
    );
  });

  it('falls back to tag and letter when nobody is assigned', () => {
    assert.equal(shortEntryLabel(base, false), 'T1-A');
  });

  it('changes once an assignment lands', () => {
    // The transition is the point: the same entry must read differently before
    // and after a captain fills it in, or the console does nothing visible.
    const before = shortEntryLabel(base, false);
    const after = shortEntryLabel({ ...base, playerNames: ['Ada Byron'] }, false);
    assert.equal(before, 'T1-A');
    assert.equal(after, 'T1 AB');
    assert.notEqual(before, after);
  });

  it('ignores a stale team name inside the label', () => {
    // The label is a snapshot from generation time. A rename must not show up
    // as the old name in a preview.
    assert.equal(
      shortEntryLabel(
        { ...base, teamName: 'The New Name', playerNames: ['Kevin Flessa'] },
        false,
      ),
      'T1 KF',
    );
  });

  it('degrades to the label when the draft position is missing', () => {
    assert.equal(
      shortEntryLabel({ ...base, teamDraftPosition: null }, false),
      'Team One — A',
    );
  });

  it('gives a dash for an empty bracket slot', () => {
    assert.equal(
      shortEntryLabel(
        { label: null, teamName: null, teamDraftPosition: null, playerNames: [] },
        false,
      ),
      '—',
    );
  });
});
