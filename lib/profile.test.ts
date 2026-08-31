import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseProfileForm, RATING_FIELDS, RATING_MAX, RATING_MIN } from './profile';

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

describe('parseProfileForm', () => {
  it('accepts an entirely blank form — every field is optional', () => {
    const result = parseProfileForm(form({}));
    assert.ok(result.ok);
    assert.equal(result.values.nickname, null);
    assert.equal(result.values.beerPong, null);
    assert.equal(result.values.weight, null);
  });

  // Blank is "not answered", which has to stay distinct from a real value.
  it('turns blank and whitespace-only fields into null, not empty strings', () => {
    const result = parseProfileForm(form({ nickname: '   ', hometown: '', scoutingReport: '\t\n' }));
    assert.ok(result.ok);
    assert.equal(result.values.nickname, null);
    assert.equal(result.values.hometown, null);
    assert.equal(result.values.scoutingReport, null);
  });

  it('trims surrounding whitespace off text it keeps', () => {
    const result = parseProfileForm(form({ nickname: '  Tank  ' }));
    assert.ok(result.ok);
    assert.equal(result.values.nickname, 'Tank');
  });

  it('parses every rating', () => {
    const entries = Object.fromEntries(RATING_FIELDS.map(({ key }, i) => [key, String(i + 1)]));
    const result = parseProfileForm(form(entries));
    assert.ok(result.ok);
    RATING_FIELDS.forEach(({ key }, i) => assert.equal(result.values[key], i + 1, key));
  });

  // Mirrors the players_ratings_range check constraint, so a bad value produces
  // a readable message instead of a Postgres error.
  it('rejects a rating outside 1-100, for every rating field', () => {
    for (const { key, label } of RATING_FIELDS) {
      for (const bad of [String(RATING_MIN - 1), String(RATING_MAX + 1), '-5', '1000']) {
        const result = parseProfileForm(form({ [key]: bad }));
        assert.equal(result.ok, false, `${key}=${bad} should be rejected`);
        assert.ok(
          !result.ok && result.errors.some((e) => e.includes(label)),
          `error should name "${label}", got ${!result.ok ? result.errors.join('|') : ''}`,
        );
      }
    }
  });

  it('accepts the exact boundaries', () => {
    for (const { key } of RATING_FIELDS) {
      for (const good of [RATING_MIN, RATING_MAX]) {
        const result = parseProfileForm(form({ [key]: String(good) }));
        assert.ok(result.ok, `${key}=${good} should be accepted`);
        assert.equal(result.values[key], good);
      }
    }
  });

  it('rejects non-numeric and non-integer numbers', () => {
    for (const bad of ['abc', '50.5', '1e3', '0x10', '5 5', '--5', '+']) {
      const result = parseProfileForm(form({ beerPong: bad }));
      assert.equal(result.ok, false, `beerPong=${bad} should be rejected`);
    }
  });

  it('reports every bad field at once', () => {
    const result = parseProfileForm(form({ beerPong: '900', chugging: 'nope', weight: '-3' }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.length >= 3, 'should list all three');
  });

  it('allows a personal record of zero but not a negative one', () => {
    const zero = parseProfileForm(form({ personalRecordBeers: '0' }));
    assert.ok(zero.ok);
    assert.equal(zero.values.personalRecordBeers, 0);

    assert.equal(parseProfileForm(form({ personalRecordBeers: '-1' })).ok, false);
  });

  it('keeps height as text, since nobody writes it the same way', () => {
    const result = parseProfileForm(form({ height: `6'1"` }));
    assert.ok(result.ok);
    assert.equal(result.values.height, `6'1"`);
  });

  it('ignores fields it does not know about', () => {
    const result = parseProfileForm(form({ isAdmin: 'true', teamId: 'x', draftPickNumber: '13' }));
    assert.ok(result.ok);
    assert.ok(!('isAdmin' in result.values));
    assert.ok(!('teamId' in result.values));
    assert.ok(!('draftPickNumber' in result.values));
  });
});
