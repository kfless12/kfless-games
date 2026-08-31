import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  backoffSecondsFor,
  evaluateRateLimit,
  FREE_ATTEMPTS,
  MAX_BACKOFF_SECONDS,
} from './rate-limit';

const NOW = 1_700_000_000_000;

describe('backoffSecondsFor', () => {
  // SPEC.md §3.4: "5 attempts per IP, then exponential backoff."
  it('is free up to and including the fifth failure', () => {
    for (let failures = 0; failures < FREE_ATTEMPTS; failures += 1) {
      assert.equal(backoffSecondsFor(failures), 0, `${failures} failures should be free`);
    }
  });

  it('doubles from the sixth failure onward', () => {
    assert.equal(backoffSecondsFor(5), 2);
    assert.equal(backoffSecondsFor(6), 4);
    assert.equal(backoffSecondsFor(7), 8);
    assert.equal(backoffSecondsFor(8), 16);
    assert.equal(backoffSecondsFor(9), 32);
  });

  // Everyone at the event shares one NAT IP, so an unbounded backoff would let
  // one person lock out the whole party.
  it('never exceeds the ceiling, however many failures', () => {
    for (const failures of [10, 20, 100, 10_000]) {
      assert.equal(backoffSecondsFor(failures), MAX_BACKOFF_SECONDS);
    }
  });

  it('keeps the ceiling short enough to not ruin the party', () => {
    assert.ok(MAX_BACKOFF_SECONDS <= 60, 'a lockout longer than a minute is a party-stopper');
  });
});

describe('evaluateRateLimit', () => {
  it('allows the first five failures', () => {
    for (let failures = 0; failures < FREE_ATTEMPTS; failures += 1) {
      assert.deepEqual(evaluateRateLimit(failures, NOW, NOW), { allowed: true });
    }
  });

  it('blocks the sixth attempt and reports the wait', () => {
    assert.deepEqual(evaluateRateLimit(5, NOW, NOW), {
      allowed: false,
      retryAfterSeconds: 2,
    });
  });

  it('allows again once the backoff has elapsed', () => {
    assert.deepEqual(evaluateRateLimit(5, NOW, NOW + 2000), { allowed: true });
    assert.deepEqual(evaluateRateLimit(5, NOW, NOW + 5000), { allowed: true });
  });

  it('counts the wait down as time passes', () => {
    const first = evaluateRateLimit(9, NOW, NOW + 1000);
    const later = evaluateRateLimit(9, NOW, NOW + 20_000);
    assert.equal(first.allowed, false);
    assert.equal(later.allowed, false);
    assert.ok(
      !first.allowed && !later.allowed && later.retryAfterSeconds < first.retryAfterSeconds,
      'the reported wait should shrink',
    );
  });

  it('rounds a part-second wait up rather than down to zero', () => {
    const verdict = evaluateRateLimit(5, NOW, NOW + 1500);
    assert.deepEqual(verdict, { allowed: false, retryAfterSeconds: 1 });
  });

  // A success wipes the IP's failure rows, which is what unblocks everyone
  // else on the same wifi.
  it('allows when there are no failures on record', () => {
    assert.deepEqual(evaluateRateLimit(0, null, NOW), { allowed: true });
    assert.deepEqual(evaluateRateLimit(99, null, NOW), { allowed: true });
  });
});
