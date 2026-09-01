import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generateFfaHeat, validateFfaPlacements } from './ffa';

const FOUR = ['A', 'B', 'C', 'D'];

describe('generateFfaHeat', () => {
  it('puts every entry in one heat', () => {
    const heat = generateFfaHeat(FOUR);
    assert.deepEqual(heat?.participants, FOUR);
    assert.equal(heat?.round, 1);
  });

  it('is null with no entries', () => {
    assert.equal(generateFfaHeat([]), null);
  });
});

describe('validateFfaPlacements', () => {
  it('accepts a complete 1..N ordering', () => {
    const result = validateFfaPlacements(FOUR, [
      { entryId: 'C', placement: 1 },
      { entryId: 'A', placement: 2 },
      { entryId: 'D', placement: 3 },
      { entryId: 'B', placement: 4 },
    ]);
    assert.ok(result.ok);
    assert.deepEqual(result.placements.map((p) => p.entryId), ['C', 'A', 'D', 'B']);
  });

  it('rejects a gap in the placements', () => {
    const result = validateFfaPlacements(FOUR, [
      { entryId: 'A', placement: 1 },
      { entryId: 'B', placement: 2 },
      { entryId: 'C', placement: 3 },
      { entryId: 'D', placement: 5 },
    ]);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((e) => e.includes('1..4')));
  });

  it('rejects a duplicate placement', () => {
    const result = validateFfaPlacements(FOUR, [
      { entryId: 'A', placement: 1 },
      { entryId: 'B', placement: 1 },
      { entryId: 'C', placement: 3 },
      { entryId: 'D', placement: 4 },
    ]);
    assert.equal(result.ok, false);
  });

  it('rejects a missing entry', () => {
    const result = validateFfaPlacements(FOUR, [
      { entryId: 'A', placement: 1 },
      { entryId: 'B', placement: 2 },
      { entryId: 'C', placement: 3 },
    ]);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((e) => e.includes('D')));
  });

  it('rejects an entry that is not in the game', () => {
    const result = validateFfaPlacements(FOUR, [
      { entryId: 'A', placement: 1 },
      { entryId: 'B', placement: 2 },
      { entryId: 'C', placement: 3 },
      { entryId: 'ZZ', placement: 4 },
    ]);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((e) => e.includes('ZZ')));
  });

  it('rejects the same entry listed twice', () => {
    const result = validateFfaPlacements(FOUR, [
      { entryId: 'A', placement: 1 },
      { entryId: 'A', placement: 2 },
      { entryId: 'C', placement: 3 },
      { entryId: 'D', placement: 4 },
    ]);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((e) => e.includes('twice')));
  });

  // SPEC.md §6.4: rawScore is shown alongside but never used for ordering.
  it('ignores rawScore entirely when ordering', () => {
    const result = validateFfaPlacements(FOUR, [
      { entryId: 'A', placement: 1, rawScore: 1 },
      { entryId: 'B', placement: 2, rawScore: 9999 },
      { entryId: 'C', placement: 3, rawScore: null },
      { entryId: 'D', placement: 4 },
    ]);
    assert.ok(result.ok);
    assert.deepEqual(result.placements.map((p) => p.entryId), ['A', 'B', 'C', 'D']);
  });

  it('handles a single entry', () => {
    const result = validateFfaPlacements(['A'], [{ entryId: 'A', placement: 1 }]);
    assert.ok(result.ok);
  });
});
