import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseSession,
  readCookieFromHeader,
  resolveRole,
  serializeSession,
} from './session';

const SECRET = 'test-secret-not-the-real-one';
const PERSON = '72ee5fe0-a961-49b5-b9c5-ed584a98d9bc';
const NOW = 1_700_000_000_000;
const FUTURE = Math.floor(NOW / 1000) + 3600;

describe('session cookie', () => {
  it('round-trips a person id and the elevated flag', () => {
    for (const elevated of [false, true]) {
      const cookie = serializeSession(SECRET, PERSON, FUTURE, elevated);
      assert.deepEqual(parseSession(SECRET, cookie, NOW), { personId: PERSON, elevated });
    }
  });

  it('rejects a cookie signed with a different secret', () => {
    const cookie = serializeSession('some-other-secret', PERSON, FUTURE, false);
    assert.equal(parseSession(SECRET, cookie, NOW), null);
  });

  // The whole point of signing: a player must not be able to make themselves
  // an admin by editing the cookie. SPEC.md §3.4.
  it('rejects a cookie whose elevated flag has been flipped', () => {
    const cookie = serializeSession(SECRET, PERSON, FUTURE, false);
    const parts = cookie.split('.');
    parts[3] = '1';
    assert.equal(parseSession(SECRET, parts.join('.'), NOW), null);
  });

  it('rejects a cookie whose person id has been swapped', () => {
    const cookie = serializeSession(SECRET, PERSON, FUTURE, false);
    const parts = cookie.split('.');
    parts[1] = '00000000-0000-0000-0000-000000000000';
    assert.equal(parseSession(SECRET, parts.join('.'), NOW), null);
  });

  it('rejects a cookie whose expiry has been pushed out', () => {
    const cookie = serializeSession(SECRET, PERSON, FUTURE, false);
    const parts = cookie.split('.');
    parts[2] = String(FUTURE + 10_000_000);
    assert.equal(parseSession(SECRET, parts.join('.'), NOW), null);
  });

  it('rejects an expired cookie', () => {
    const expired = Math.floor(NOW / 1000) - 1;
    const cookie = serializeSession(SECRET, PERSON, expired, false);
    assert.equal(parseSession(SECRET, cookie, NOW), null);
  });

  it('accepts a cookie one second before expiry and rejects it one second after', () => {
    const expiresAt = Math.floor(NOW / 1000) + 1;
    const cookie = serializeSession(SECRET, PERSON, expiresAt, false);
    assert.notEqual(parseSession(SECRET, cookie, NOW), null);
    assert.equal(parseSession(SECRET, cookie, (expiresAt + 1) * 1000), null);
  });

  it('rejects malformed input without throwing', () => {
    const malformed = [
      undefined,
      '',
      'garbage',
      'v1.a.b.c',
      'v1.a.b.c.d.e',
      `v2.${PERSON}.${FUTURE}.0.whatever`,
      `v1..${FUTURE}.0.whatever`,
      `v1.${PERSON}.${FUTURE}.2.whatever`,
    ];
    for (const raw of malformed) {
      assert.equal(parseSession(SECRET, raw, NOW), null, `should reject: ${String(raw)}`);
    }
  });
});

describe('resolveRole', () => {
  it('resolves the three roles', () => {
    assert.equal(resolveRole(false, false), 'PLAYER');
    assert.equal(resolveRole(false, true), 'CAPTAIN');
    assert.equal(resolveRole(true, false), 'ADMIN');
  });

  // An admin who is also a captain must not be demoted to CAPTAIN — SPEC.md
  // §5.4 and §8 give the admin everything a captain can do and more.
  it('puts ADMIN above CAPTAIN when someone is both', () => {
    assert.equal(resolveRole(true, true), 'ADMIN');
  });
});

describe('readCookieFromHeader', () => {
  it('finds the named cookie among others', () => {
    assert.equal(readCookieFromHeader('a=1; kfless_session=abc; b=2', 'kfless_session'), 'abc');
  });

  it('returns undefined when absent or when there is no header', () => {
    assert.equal(readCookieFromHeader('a=1; b=2', 'kfless_session'), undefined);
    assert.equal(readCookieFromHeader(null, 'kfless_session'), undefined);
  });

  it('does not match a cookie whose name merely ends with the target', () => {
    assert.equal(readCookieFromHeader('not_kfless_session=abc', 'kfless_session'), undefined);
  });

  // Cookie values are percent-encoded, and the session cookie contains dots.
  it('decodes the value and keeps embedded = signs', () => {
    assert.equal(readCookieFromHeader('s=a%2Bb', 's'), 'a+b');
    assert.equal(readCookieFromHeader('s=a=b=c', 's'), 'a=b=c');
  });
});
