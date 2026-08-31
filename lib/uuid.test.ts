import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isUuid } from './uuid';

describe('isUuid', () => {
  it('accepts a real uuid in either case', () => {
    const id = '72ee5fe0-a961-49b5-b9c5-ed584a98d9bc';
    assert.equal(isUuid(id), true);
    assert.equal(isUuid(id.toUpperCase()), true);
  });

  // Each of these reached Postgres as a query parameter and raised 22P02,
  // which surfaced as a 500 instead of a readable rejection.
  it('rejects everything that is not one', () => {
    const bad: unknown[] = [
      '',
      '   ',
      undefined,
      null,
      42,
      {},
      [],
      'not-a-uuid',
      '72ee5fe0a96149b5b9c5ed584a98d9bc',
      '72ee5fe0-a961-49b5-b9c5-ed584a98d9b',
      '72ee5fe0-a961-49b5-b9c5-ed584a98d9bcc',
      '72ee5fe0-a961-49b5-b9c5-ed584a98d9bg',
      ' 72ee5fe0-a961-49b5-b9c5-ed584a98d9bc',
      '72ee5fe0-a961-49b5-b9c5-ed584a98d9bc ',
      "1';drop table images;--",
      '72ee5fe0-a961-49b5-b9c5-ed584a98d9bc\n',
    ];
    for (const value of bad) {
      assert.equal(isUuid(value), false, `should reject: ${JSON.stringify(value)}`);
    }
  });
});
