import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkImage } from '../lib/images';
import { RATING_FIELDS, RATING_MAX, RATING_MIN } from '../lib/profile';

import { fakeAvatarPng, fakeProfile, fakeTeamLogoPng } from './fake-profiles';
import { SEED_PLAYERS, SEED_TEAMS } from './seed-data';

describe('fake avatars', () => {
  it('are valid images by the same check the upload route uses', () => {
    for (const player of SEED_PLAYERS) {
      const png = fakeAvatarPng(player.email);
      const result = checkImage(png);
      assert.ok(result.ok, `${player.email}: ${!result.ok ? result.reason : ''}`);
      assert.equal(result.info.mimeType, 'image/png');
    }
  });

  it('are the same bytes every time, so a reseed is reproducible', () => {
    const once = fakeAvatarPng('someone@example.com');
    const twice = fakeAvatarPng('someone@example.com');
    assert.ok(once.equals(twice));
  });

  it('differ per person, so 17 cards are distinguishable', () => {
    const seen = new Set(SEED_PLAYERS.map((p) => fakeAvatarPng(p.email).toString('base64')));
    assert.equal(seen.size, SEED_PLAYERS.length, 'every avatar should be unique');
  });

  it('stay small enough that 21 of them are nothing', () => {
    for (const player of SEED_PLAYERS) {
      assert.ok(fakeAvatarPng(player.email).length < 20_000, player.email);
    }
  });
});

describe('fake team logos', () => {
  it('are valid images for every seeded team colour', () => {
    for (const team of SEED_TEAMS) {
      const png = fakeTeamLogoPng(team.name, team.colorHex);
      const result = checkImage(png);
      assert.ok(result.ok, `${team.name}: ${!result.ok ? result.reason : ''}`);
    }
  });

  it('is deterministic', () => {
    const a = fakeTeamLogoPng('Team One', '#b91c1c');
    const b = fakeTeamLogoPng('Team One', '#b91c1c');
    assert.ok(a.equals(b));
  });
});

describe('fake profiles', () => {
  // If a generated rating fell outside 1-100 the seed would die on the
  // players_ratings_range constraint, which is a confusing way to find out.
  it('produce ratings inside the range the database allows', () => {
    for (const player of SEED_PLAYERS) {
      const profile = fakeProfile(player.email);
      for (const { key } of RATING_FIELDS) {
        const value = profile[key];
        assert.ok(
          Number.isInteger(value) && value >= RATING_MIN && value <= RATING_MAX,
          `${player.email} ${key} = ${value}`,
        );
      }
    }
  });

  it('fill every field the completeness rule requires', () => {
    for (const player of SEED_PLAYERS) {
      const profile = fakeProfile(player.email);
      assert.ok(profile.scoutingReport.trim().length > 0, player.email);
      assert.ok(profile.nickname.trim().length > 0, player.email);
    }
  });

  it('produce a sane weight and personal record', () => {
    for (const player of SEED_PLAYERS) {
      const profile = fakeProfile(player.email);
      assert.ok(profile.weight >= 1 && profile.weight <= 1000, `weight ${profile.weight}`);
      assert.ok(
        profile.personalRecordBeers >= 0 && profile.personalRecordBeers <= 1000,
        `record ${profile.personalRecordBeers}`,
      );
    }
  });

  it('is deterministic and varies per person', () => {
    assert.deepEqual(fakeProfile('a@example.com'), fakeProfile('a@example.com'));
    const reports = new Set(SEED_PLAYERS.map((p) => JSON.stringify(fakeProfile(p.email))));
    assert.ok(reports.size > SEED_PLAYERS.length / 2, 'profiles should mostly differ');
  });
});
