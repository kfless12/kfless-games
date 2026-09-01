import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isRetryable,
  markAttempted,
  MAX_PENDING,
  nextDue,
  parsePending,
  type PendingResult,
  removePending,
  retryDelayMs,
  serializePending,
  upsertPending,
} from './pending-results';

function pending(overrides: Partial<PendingResult> = {}): PendingResult {
  return {
    matchId: 'match-1',
    winnerEntryId: 'entry-1',
    scores: { 'entry-1': 10, 'entry-2': 6 },
    queuedAt: 1_000,
    attempts: 0,
    ...overrides,
  };
}

describe('retryDelayMs', () => {
  it('does not wait before the first attempt', () => {
    assert.equal(retryDelayMs(0), 0);
  });

  it('backs off 2s, 4s, 8s, 16s', () => {
    assert.equal(retryDelayMs(1), 2_000);
    assert.equal(retryDelayMs(2), 4_000);
    assert.equal(retryDelayMs(3), 8_000);
    assert.equal(retryDelayMs(4), 16_000);
  });

  // Somebody is stood at the table waiting to see it land, so a long backoff
  // reads as broken.
  it('caps at 30 seconds however many attempts', () => {
    for (const attempts of [5, 6, 10, 100]) {
      assert.equal(retryDelayMs(attempts), 30_000, `${attempts} attempts`);
    }
  });
});

describe('upsertPending', () => {
  it('adds an entry', () => {
    assert.deepEqual(upsertPending([], pending()).map((p) => p.matchId), ['match-1']);
  });

  // Two queued results for one match would make the outcome depend on which
  // request happened to arrive last.
  it('replaces rather than queueing a second result for the same match', () => {
    const first = pending({ winnerEntryId: 'entry-1' });
    const second = pending({ winnerEntryId: 'entry-2', queuedAt: 2_000 });
    const list = upsertPending(upsertPending([], first), second);

    assert.equal(list.length, 1);
    assert.equal(list[0].winnerEntryId, 'entry-2', 'the newest answer wins');
  });

  it('keeps entries for different matches', () => {
    const list = upsertPending(
      upsertPending([], pending({ matchId: 'a' })),
      pending({ matchId: 'b' }),
    );
    assert.deepEqual(list.map((p) => p.matchId), ['a', 'b']);
  });

  it('holds a whole game\'s worth without dropping anything', () => {
    let list: PendingResult[] = [];
    for (let i = 0; i < 15; i += 1) {
      list = upsertPending(list, pending({ matchId: `m${i}` }));
    }
    assert.equal(list.length, 15);
  });

  it('caps the list rather than growing without limit', () => {
    let list: PendingResult[] = [];
    for (let i = 0; i < MAX_PENDING + 10; i += 1) {
      list = upsertPending(list, pending({ matchId: `m${i}` }));
    }
    assert.equal(list.length, MAX_PENDING);
    // The oldest are the ones dropped, so the newest submissions survive.
    assert.equal(list.at(-1)!.matchId, `m${MAX_PENDING + 9}`);
  });
});

describe('removePending and markAttempted', () => {
  it('removes only the named match', () => {
    const list = [pending({ matchId: 'a' }), pending({ matchId: 'b' })];
    assert.deepEqual(removePending(list, 'a').map((p) => p.matchId), ['b']);
  });

  it('is a no-op for a match that is not queued', () => {
    const list = [pending({ matchId: 'a' })];
    assert.deepEqual(removePending(list, 'zzz'), list);
  });

  it('counts an attempt and records the reason', () => {
    const list = markAttempted([pending({ matchId: 'a' })], 'a', 'offline');
    assert.equal(list[0].attempts, 1);
    assert.equal(list[0].lastError, 'offline');
  });

  it('leaves other entries untouched', () => {
    const list = markAttempted(
      [pending({ matchId: 'a' }), pending({ matchId: 'b' })],
      'a',
      'boom',
    );
    assert.equal(list[1].attempts, 0);
    assert.equal(list[1].lastError, undefined);
  });
});

describe('nextDue', () => {
  it('returns a brand new entry immediately', () => {
    assert.equal(nextDue([pending({ queuedAt: 1_000, attempts: 0 })], 1_000)?.matchId, 'match-1');
  });

  it('waits out the backoff before retrying', () => {
    const list = [pending({ queuedAt: 1_000, attempts: 1 })];
    assert.equal(nextDue(list, 2_500), null, 'not yet');
    assert.notEqual(nextDue(list, 3_000), null, 'due at +2s');
  });

  it('is null for an empty list', () => {
    assert.equal(nextDue([], 5_000), null);
  });

  it('picks the first entry that is due', () => {
    const list = [
      pending({ matchId: 'waiting', queuedAt: 1_000, attempts: 5 }),
      pending({ matchId: 'due', queuedAt: 1_000, attempts: 0 }),
    ];
    assert.equal(nextDue(list, 1_500)?.matchId, 'due');
  });
});

describe('parsePending', () => {
  it('round-trips a real list', () => {
    const list = [pending({ matchId: 'a' }), pending({ matchId: 'b', attempts: 2 })];
    assert.deepEqual(parsePending(serializePending(list)), list);
  });

  it('is empty for nothing stored', () => {
    assert.deepEqual(parsePending(null), []);
    assert.deepEqual(parsePending(''), []);
  });

  /*
   * localStorage can hold anything, including half a value from a browser killed
   * mid-write. A dashboard that throws on load is worse than a lost retry.
   */
  it('never throws on junk', () => {
    const junk = [
      'not json',
      '{',
      '[{"matchId":',
      '{"matchId":"a"}',
      '[1,2,3]',
      'null',
      '"a string"',
      '[[]]',
    ];
    for (const raw of junk) {
      assert.deepEqual(parsePending(raw), [], JSON.stringify(raw));
    }
  });

  it('drops entries missing required fields but keeps the good ones', () => {
    const raw = JSON.stringify([
      pending({ matchId: 'good' }),
      { matchId: 'no-winner', scores: {}, queuedAt: 1, attempts: 0 },
      { winnerEntryId: 'x', scores: {}, queuedAt: 1, attempts: 0 },
      pending({ matchId: 'also-good' }),
    ]);
    assert.deepEqual(parsePending(raw).map((p) => p.matchId), ['good', 'also-good']);
  });

  it('drops an entry whose scores are not numbers', () => {
    const raw = JSON.stringify([{ ...pending(), scores: { 'entry-1': 'ten' } }]);
    assert.deepEqual(parsePending(raw), []);
  });

  it('drops an entry whose scores are an array', () => {
    const raw = JSON.stringify([{ ...pending(), scores: [10, 6] }]);
    assert.deepEqual(parsePending(raw), []);
  });

  it('accepts an empty scores object', () => {
    const raw = JSON.stringify([pending({ scores: {} })]);
    assert.equal(parsePending(raw).length, 1);
  });

  it('caps what it reads back', () => {
    const raw = JSON.stringify(
      Array.from({ length: MAX_PENDING + 5 }, (_, i) => pending({ matchId: `m${i}` })),
    );
    assert.equal(parsePending(raw).length, MAX_PENDING);
  });
});

describe('isRetryable', () => {
  // Only a transport failure is worth retrying. A server rejection — not your
  // turn, match already decided — will never succeed, and retrying it forever
  // would hide the reason behind a permanent "not saved yet" badge.
  it('retries a fetch network failure', () => {
    assert.equal(isRetryable(new TypeError('Failed to fetch')), true);
  });

  it('retries an abort or timeout', () => {
    for (const name of ['AbortError', 'TimeoutError', 'NetworkError']) {
      const error = new Error('x');
      error.name = name;
      assert.equal(isRetryable(error), true, name);
    }
  });

  it('does not retry an ordinary error', () => {
    assert.equal(isRetryable(new Error('It is Team Three\'s pick.')), false);
    assert.equal(isRetryable('a string'), false);
    assert.equal(isRetryable(null), false);
    assert.equal(isRetryable(undefined), false);
  });
});
