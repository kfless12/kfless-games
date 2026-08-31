import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { imageIdFromUrl, imageUrlFor } from './upload';

const ID = '72ee5fe0-a961-49b5-b9c5-ed584a98d9bc';

describe('image urls', () => {
  it('round-trips an id', () => {
    assert.equal(imageIdFromUrl(imageUrlFor(ID)), ID);
  });

  it('is the path the route handler actually serves', () => {
    assert.equal(imageUrlFor(ID), `/api/images/${ID}`);
  });

  // deleteImageByUrl feeds off this. A loose match here could delete rows it
  // has no business touching, or leave orphans behind.
  it('returns null for anything that is not one of our image urls', () => {
    const notOurs = [
      null,
      '',
      '/api/images/',
      '/api/images/not-a-uuid',
      `/api/images/${ID}/extra`,
      `/api/images/${ID}?x=1`,
      `https://example.com/api/images/${ID}`,
      `/api/IMAGES/${ID}`,
      `  /api/images/${ID}`,
      '/public/photo.jpg',
    ];
    for (const url of notOurs) {
      assert.equal(imageIdFromUrl(url), null, `should not match: ${String(url)}`);
    }
  });

  it('accepts uppercase hex in the id', () => {
    const upper = ID.toUpperCase();
    assert.equal(imageIdFromUrl(`/api/images/${upper}`), upper);
  });
});
