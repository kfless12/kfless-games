import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generateBracket } from './bracket';
import { derivePlacements, readyMatches, replay, ReplayError, type ReportedResult } from './replay';
import type { SeedableEntry } from './seeding';

/*
 * Undo. CLAUDE.md requires this test explicitly: "an undo of a mid-bracket
 * match asserting downstream slots cleared".
 *
 * Undo works by replaying the skeleton with the result dropped, so what is
 * really being asserted is that replaying a shorter result list leaves no trace
 * of the removed one anywhere downstream.
 */

function beerPongEntries(): SeedableEntry[] {
  const out: SeedableEntry[] = [];
  for (let t = 1; t <= 4; t += 1) {
    for (let n = 1; n <= 2; n += 1) out.push({ id: `T${t}-${n}`, teamId: `team-${t}` });
  }
  return out;
}

const bracket = generateBracket(beerPongEntries(), 'DOUBLE');
const chalk = (a: string, b: string) =>
  bracket.seedByEntry[a] < bracket.seedByEntry[b] ? a : b;

/** Plays `count` matches, always taking the first ready one. */
function playFirst(count: number): ReportedResult[] {
  const results: ReportedResult[] = [];
  for (let i = 0; i < count; i += 1) {
    const state = replay(bracket, results);
    const ready = readyMatches(state);
    if (ready.length === 0) break;
    const [a, b] = ready[0].resolvedParticipants as [string, string];
    results.push({ matchKey: ready[0].key, winnerEntryId: chalk(a, b) });
  }
  return results;
}

/** Every slot in the bracket that currently holds an entry. */
function filledSlots(results: ReportedResult[]): Map<string, string> {
  const state = replay(bracket, results);
  const filled = new Map<string, string>();
  for (const match of state.matches) {
    match.resolvedParticipants.forEach((entryId, slot) => {
      if (entryId) filled.set(`${match.key}#${slot}`, entryId);
    });
  }
  return filled;
}

describe('undoing a mid-bracket match', () => {
  it('clears the winner from its downstream slot', () => {
    const before = playFirst(6);
    const undone = before.slice(0, -1);
    const removed = before[before.length - 1];

    const match = replay(bracket, undone).byKey.get(removed.matchKey)!;
    const target = match.winnerTo;
    assert.notEqual(target.matchKey, null, 'this match should feed somewhere');

    const slotKey = `${target.matchKey}#${target.slot}`;
    assert.equal(filledSlots(before).get(slotKey), removed.winnerEntryId, 'was populated');
    assert.equal(filledSlots(undone).get(slotKey), undefined, 'should be cleared');
  });

  it('clears the loser from its losers-bracket slot too', () => {
    const before = playFirst(3);
    const undone = before.slice(0, -1);
    const removed = before[before.length - 1];

    const played = replay(bracket, before).byKey.get(removed.matchKey)!;
    const target = played.loserTo;
    assert.notEqual(target.matchKey, null, 'a winners match should drop its loser');

    const slotKey = `${target.matchKey}#${target.slot}`;
    assert.equal(filledSlots(before).get(slotKey), played.loserEntryId!);
    assert.equal(filledSlots(undone).get(slotKey), undefined, 'losers slot should be cleared');
  });

  it('resets the undone match to no result and takes it out of the completed set', () => {
    const before = playFirst(5);
    const removed = before[before.length - 1];
    const state = replay(bracket, before.slice(0, -1));
    const match = state.byKey.get(removed.matchKey)!;

    assert.equal(match.winnerEntryId, null);
    assert.equal(match.loserEntryId, null);
    assert.ok(match.ready, 'it should be back in the queue, awaiting a result');
  });

  it('un-eliminates the loser and gives back the loss', () => {
    // Play far enough that somebody has actually been knocked out.
    const full = playFirst(20);
    const lastElimination = replay(bracket, full).eliminationOrder.at(-1)!;

    let index = full.length;
    while (index > 0) {
      const trimmed = full.slice(0, index - 1);
      if (!replay(bracket, trimmed).eliminationOrder.includes(lastElimination)) break;
      index -= 1;
    }

    const state = replay(bracket, full.slice(0, index - 1));
    assert.ok(
      !state.eliminationOrder.includes(lastElimination),
      `${lastElimination} should be back in it`,
    );
  });

  it('rolls a completed bracket back to unfinished', () => {
    const full = playFirst(20);
    const complete = replay(bracket, full);
    assert.ok(complete.complete);
    assert.notEqual(complete.championEntryId, null);

    const rolledBack = replay(bracket, full.slice(0, -1));
    assert.equal(rolledBack.complete, false);
    assert.equal(rolledBack.championEntryId, null);
  });

  // The real payoff: undo touches nothing it should not.
  it('leaves every slot that did not descend from the undone match untouched', () => {
    const before = playFirst(8);
    const undone = before.slice(0, -1);
    const removed = before[before.length - 1];

    const played = replay(bracket, before).byKey.get(removed.matchKey)!;
    const expectedCleared = new Set(
      [
        played.winnerTo.matchKey !== null ? `${played.winnerTo.matchKey}#${played.winnerTo.slot}` : null,
        played.loserTo.matchKey !== null ? `${played.loserTo.matchKey}#${played.loserTo.slot}` : null,
      ].filter((key): key is string => key !== null),
    );

    const beforeSlots = filledSlots(before);
    const afterSlots = filledSlots(undone);

    for (const [slotKey, entryId] of beforeSlots) {
      if (expectedCleared.has(slotKey)) {
        assert.equal(afterSlots.get(slotKey), undefined, `${slotKey} should be cleared`);
      } else {
        assert.equal(afterSlots.get(slotKey), entryId, `${slotKey} should be unchanged`);
      }
    }

    // And nothing new appeared.
    for (const slotKey of afterSlots.keys()) {
      assert.ok(beforeSlots.has(slotKey), `${slotKey} appeared out of nowhere`);
    }
  });

  it('unwinding pick by pick ends at exactly the generated state', () => {
    const full = playFirst(20);
    assert.ok(full.length > 10, 'should have played a lot');

    const pristine = replay(bracket, []);
    const pristineFilled = filledSlots([]).size;

    let previousFilled = filledSlots(full).size;

    // Drop one result at a time. Nothing may ever gain a participant on the way
    // back down, and the end state must match the generated skeleton exactly.
    for (let remaining = full.length - 1; remaining >= 0; remaining -= 1) {
      const trimmed = full.slice(0, remaining);
      const filled = filledSlots(trimmed).size;
      assert.ok(
        filled <= previousFilled,
        `undoing to ${remaining} results added participants (${previousFilled} -> ${filled})`,
      );
      previousFilled = filled;
    }

    assert.equal(previousFilled, pristineFilled, 'fully unwound should equal generated');

    const unwound = replay(bracket, []);
    for (let i = 0; i < pristine.matches.length; i += 1) {
      assert.deepEqual(
        unwound.matches[i].resolvedParticipants,
        bracket.matches[i].participants,
        `${bracket.matches[i].key} should be back to its generated participants`,
      );
      assert.equal(unwound.matches[i].winnerEntryId, bracket.matches[i].autoWinner);
    }
    assert.deepEqual(unwound.eliminationOrder, []);
    assert.equal(unwound.championEntryId, null);
  });

  it('has no hidden state — the same result list always replays the same', () => {
    const full = playFirst(20);
    const a = derivePlacements(bracket, replay(bracket, full));
    const b = derivePlacements(bracket, replay(bracket, full));
    assert.deepEqual(a, b);
  });

});

describe('replay refuses impossible results', () => {
  it('rejects a result for a match that is not ready', () => {
    assert.throws(
      () => replay(bracket, [{ matchKey: 'WINNERS-3-0', winnerEntryId: bracket.slots[0]! }]),
      ReplayError,
    );
  });

  it('rejects a winner who is not in the match', () => {
    const state = replay(bracket, []);
    const first = readyMatches(state)[0];
    assert.throws(
      () => replay(bracket, [{ matchKey: first.key, winnerEntryId: 'nobody' }]),
      ReplayError,
    );
  });

  it('rejects two results for the same match', () => {
    const one = playFirst(1);
    assert.throws(() => replay(bracket, [...one, one[0]]), ReplayError);
  });

  it('rejects a result for a match that does not exist', () => {
    assert.throws(
      () => replay(bracket, [{ matchKey: 'WINNERS-9-9', winnerEntryId: bracket.slots[0]! }]),
      ReplayError,
    );
  });
});
