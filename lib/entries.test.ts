import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { displayNames, entryLetter, firstNameOf, shortEntryLabel, teamTag } from './entries';

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

describe('firstNameOf', () => {
  it('takes the first name', () => {
    assert.equal(firstNameOf('Kevin Flessa'), 'Kevin');
    assert.equal(firstNameOf('Mary Jane Watson'), 'Mary');
  });

  it('handles a one-word name', () => {
    assert.equal(firstNameOf('Madonna'), 'Madonna');
  });

  it('survives extra whitespace and empty input', () => {
    assert.equal(firstNameOf('  Kevin   Flessa  '), 'Kevin');
    assert.equal(firstNameOf('   '), '?');
  });
});

describe('displayNames', () => {
  it('leaves distinct first names alone', () => {
    assert.deepEqual(displayNames(['Kevin Flessa', 'Jake Dean']), ['Kevin', 'Jake']);
  });

  it('adds a last initial only to the names that collide', () => {
    // Two Mikes must not both render "Mike" — that names nobody. Ada is
    // untouched, so the common case stays short.
    assert.deepEqual(
      displayNames(['Mike Doyle', 'Mike Sanders', 'Ada Byron']),
      ['Mike D', 'Mike S', 'Ada'],
    );
  });

  it('is case-sensitive about the collision, not the initial', () => {
    assert.deepEqual(displayNames(['Sam Ortiz', 'Sam okafor']), ['Sam O', 'Sam O']);
  });

  it('cannot disambiguate two identical one-word names, and says so honestly', () => {
    // No surname to take. Better to repeat than to invent a letter.
    assert.deepEqual(displayNames(['Madonna', 'Madonna']), ['Madonna', 'Madonna']);
  });

  it('is empty for no players', () => {
    assert.deepEqual(displayNames([]), []);
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

  it('uses tag plus first names once players are assigned', () => {
    assert.equal(
      shortEntryLabel({ ...base, playerNames: ['Kevin Flessa', 'Jake Dean'] }, false),
      'T1 Kevin/Jake',
    );
  });

  it('disambiguates two players in the entry who share a first name', () => {
    assert.equal(
      shortEntryLabel({ ...base, playerNames: ['Mike Doyle', 'Mike Sanders'] }, false),
      'T1 Mike D/Mike S',
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
    assert.equal(after, 'T1 Ada');
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
      'T1 Kevin',
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
