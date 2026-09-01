import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generateBracket, losersRoundSizes, type GeneratedBracket } from './bracket';
import { derivePlacements, readyMatches, replay, type ReportedResult } from './replay';
import type { SeedableEntry } from './seeding';

/** 4 teams x 2 entries = the beer pong shape. */
function beerPongEntries(): SeedableEntry[] {
  const out: SeedableEntry[] = [];
  for (let t = 1; t <= 4; t += 1) {
    for (let n = 1; n <= 2; n += 1) out.push({ id: `T${t}-${n}`, teamId: `team-${t}` });
  }
  return out;
}

/**
 * Plays a bracket to completion. `prefer` decides each match; the default makes
 * the stronger seed win so results are deterministic ("chalk").
 */
function playOut(
  bracket: GeneratedBracket,
  prefer: (a: string, b: string) => string = (a) => a,
): { results: ReportedResult[]; state: ReturnType<typeof replay> } {
  const results: ReportedResult[] = [];
  let state = replay(bracket, results);
  let guard = 0;

  while (!state.complete) {
    guard += 1;
    if (guard > bracket.matches.length * 3 + 10) {
      throw new Error(`did not converge; ready=${readyMatches(state).length}`);
    }

    const ready = readyMatches(state);
    if (ready.length === 0) {
      throw new Error(`stuck with no ready matches and no champion (${results.length} results)`);
    }

    const match = ready[0];
    const [a, b] = match.resolvedParticipants as [string, string];
    results.push({ matchKey: match.key, winnerEntryId: prefer(a, b) });
    state = replay(bracket, results);
  }

  return { results, state };
}

/** Seed number of an entry. 1 is strongest. Not the slot index — those differ. */
function seedIndex(bracket: GeneratedBracket, entryId: string): number {
  return bracket.seedByEntry[entryId];
}

describe('losersRoundSizes', () => {
  it('gives the standard shape for 8 and 4 and 16', () => {
    assert.deepEqual(losersRoundSizes(8), [2, 2, 1, 1]);
    assert.deepEqual(losersRoundSizes(4), [1, 1]);
    assert.deepEqual(losersRoundSizes(16), [4, 4, 2, 2, 1, 1]);
  });

  it('has 2*(rounds-1) losers rounds', () => {
    for (const size of [4, 8, 16, 32]) {
      assert.equal(losersRoundSizes(size).length, 2 * (Math.log2(size) - 1), `size ${size}`);
    }
  });

  it('takes in exactly the losers the winners bracket produces', () => {
    for (const size of [4, 8, 16]) {
      const losersMatches = losersRoundSizes(size).reduce((a, b) => a + b, 0);
      // Double elim: every entry but one loses once, and every entry but the
      // two finalists loses twice. Losers bracket matches = size - 2.
      assert.equal(losersMatches, size - 2, `size ${size}`);
    }
  });
});

describe('DOUBLE_ELIM skeleton for 8 entries (SPEC.md §6.1)', () => {
  const bracket = generateBracket(beerPongEntries(), 'DOUBLE');

  it('is generated up front, entire', () => {
    // 7 winners + 6 losers + grand final + reset.
    assert.equal(bracket.matches.length, 15);
    assert.equal(bracket.winnersRounds, 3);
    assert.equal(bracket.losersRounds, 4);
    assert.equal(bracket.size, 8);
    assert.equal(bracket.byes, 0);
  });

  it('has the right number of matches per bracket', () => {
    const count = (predicate: (key: string) => boolean) =>
      bracket.matches.filter((m) => predicate(m.key)).length;
    assert.equal(count((k) => k.startsWith('WINNERS')), 7);
    assert.equal(count((k) => k.startsWith('LOSERS')), 6);
    assert.equal(count((k) => k.startsWith('GRAND_FINAL')), 2);
  });

  it('generates a grand-final reset match', () => {
    const reset = bracket.matches.filter((m) => m.isReset);
    assert.equal(reset.length, 1);
    assert.equal(reset[0].bracket, 'GRAND_FINAL');
  });

  it('starts every match PENDING with no participants except round 1', () => {
    for (const match of bracket.matches) {
      const filled = match.participants.filter((p) => p !== null).length;
      if (match.bracket === 'WINNERS' && match.round === 1) {
        assert.equal(filled, 2, match.key);
      } else {
        assert.equal(filled, 0, `${match.key} should start empty`);
      }
    }
  });

  it('wires every pointer at generation time', () => {
    const keys = new Set(bracket.matches.map((m) => m.key));
    for (const match of bracket.matches) {
      for (const target of [match.winnerTo, match.loserTo]) {
        if (target.matchKey === null) continue;
        assert.ok(keys.has(target.matchKey), `${match.key} -> missing ${target.matchKey}`);
        assert.ok(target.slot === 0 || target.slot === 1, `${match.key} slot ${target.slot}`);
      }
    }
  });

  it('never points two feeders at the same slot', () => {
    const seen = new Map<string, string>();
    for (const match of bracket.matches) {
      for (const [label, target] of [['winner', match.winnerTo], ['loser', match.loserTo]] as const) {
        if (target.matchKey === null || target.slot === null) continue;
        const slotKey = `${target.matchKey}#${target.slot}`;
        const existing = seen.get(slotKey);
        assert.equal(existing, undefined, `${slotKey} fed by both ${existing} and ${match.key}:${label}`);
        seen.set(slotKey, `${match.key}:${label}`);
      }
    }
  });

  it('gives every slot outside winners round 1 exactly one feeder', () => {
    const fed = new Set<string>();
    for (const match of bracket.matches) {
      for (const target of [match.winnerTo, match.loserTo]) {
        if (target.matchKey === null || target.slot === null) continue;
        fed.add(`${target.matchKey}#${target.slot}`);
      }
    }
    for (const match of bracket.matches) {
      if (match.bracket === 'WINNERS' && match.round === 1) continue;
      if (match.isReset) continue; // populated by the grand final, conditionally
      for (const slot of [0, 1]) {
        assert.ok(fed.has(`${match.key}#${slot}`), `${match.key}#${slot} has no feeder`);
      }
    }
  });

  it('drops every winners loser into the losers bracket', () => {
    const winners = bracket.matches.filter((m) => m.bracket === 'WINNERS');
    for (const match of winners) {
      assert.notEqual(match.loserTo.matchKey, null, `${match.key} loser goes nowhere`);
      assert.ok(match.loserTo.matchKey!.startsWith('LOSERS'), match.key);
    }
  });

  it('eliminates every losers-bracket loser', () => {
    for (const match of bracket.matches.filter((m) => m.bracket === 'LOSERS')) {
      assert.equal(match.loserTo.matchKey, null, `${match.key} should end it`);
    }
  });

  it('separates same-team entries in round 1', () => {
    assert.equal(bracket.sameTeamRoundOneClash, false);
    const round1 = bracket.matches.filter((m) => m.bracket === 'WINNERS' && m.round === 1);
    for (const match of round1) {
      const teams = match.participants.map((id) => id?.split('-')[0]);
      assert.notEqual(teams[0], teams[1], `${match.key}: ${match.participants.join(' v ')}`);
    }
  });
});

describe('a full 8-entry double-elim run (CLAUDE.md requires this)', () => {
  it('crowns the top seed when the stronger seed always wins', () => {
    const bracket = generateBracket(beerPongEntries(), 'DOUBLE');
    const chalk = (a: string, b: string) =>
      seedIndex(bracket, a) < seedIndex(bracket, b) ? a : b;

    const { state, results } = playOut(bracket, chalk);

    assert.ok(state.complete, 'the bracket should finish');
    const topSeed = Object.entries(bracket.seedByEntry).find(([, seed]) => seed === 1)![0];
    assert.equal(state.championEntryId, topSeed, 'top seed should win chalk');
    // 14 matches decide it; the reset never happens when the winners entry wins.
    assert.equal(results.length, 14);
    assert.equal(state.resetActive, false);
  });

  it('gives every entry a unique placement from 1 to 8', () => {
    const bracket = generateBracket(beerPongEntries(), 'DOUBLE');
    const chalk = (a: string, b: string) =>
      seedIndex(bracket, a) < seedIndex(bracket, b) ? a : b;
    const { state } = playOut(bracket, chalk);

    const placements = derivePlacements(bracket, state);
    assert.equal(placements.length, 8);
    assert.deepEqual(
      placements.map((p) => p.placement),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.equal(new Set(placements.map((p) => p.entryId)).size, 8, 'no duplicates');
  });

  it('knocks everyone out exactly once, with two losses each bar the finalists', () => {
    const bracket = generateBracket(beerPongEntries(), 'DOUBLE');
    const chalk = (a: string, b: string) =>
      seedIndex(bracket, a) < seedIndex(bracket, b) ? a : b;
    const { state } = playOut(bracket, chalk);

    assert.equal(state.eliminationOrder.length, 7, 'seven of eight get knocked out');
    assert.equal(new Set(state.eliminationOrder).size, 7, 'nobody eliminated twice');

    for (const entryId of state.eliminationOrder) {
      assert.equal(state.losses.get(entryId), 2, `${entryId} should be out on two losses`);
    }
    assert.equal(state.losses.get(state.championEntryId!) ?? 0, 0, 'chalk champion never loses');
  });

  it('lets a losers-bracket entry win, via the grand final reset', () => {
    const bracket = generateBracket(beerPongEntries(), 'DOUBLE');
    const chalk = (a: string, b: string) =>
      seedIndex(bracket, a) < seedIndex(bracket, b) ? a : b;

    // The underdog loses its opening match, then wins everything. That is the
    // only way to reach the grand final from the losers side, which is the only
    // way the reset can happen.
    const underdog = Object.entries(bracket.seedByEntry).find(([, seed]) => seed === 8)![0];
    let underdogHasLost = false;

    const { state, results } = playOut(bracket, (a, b) => {
      if (a !== underdog && b !== underdog) return chalk(a, b);
      const other = a === underdog ? b : a;
      if (!underdogHasLost) {
        underdogHasLost = true;
        return other;
      }
      return underdog;
    });

    assert.ok(state.complete);
    assert.equal(state.championEntryId, underdog, 'the underdog should win it all');
    assert.equal(state.resetActive, true, 'the reset must activate');
    assert.equal(results.length, 15, 'all 15 matches, reset included');
    assert.equal(state.losses.get(underdog), 1, 'champion carries exactly its one early loss');

    const reset = state.matches.find((m) => m.isReset)!;
    assert.equal(reset.winnerEntryId, underdog);

    // The grand final's loser is 2nd, not eliminated by the first grand final.
    const placements = derivePlacements(bracket, state);
    assert.equal(placements[0].entryId, underdog);
    assert.equal(placements.length, 8);
  });

  it('never puts an inactive reset match in the queue', () => {
    const bracket = generateBracket(beerPongEntries(), 'DOUBLE');
    const chalk = (a: string, b: string) =>
      seedIndex(bracket, a) < seedIndex(bracket, b) ? a : b;

    const results: ReportedResult[] = [];
    let state = replay(bracket, results);
    while (!state.complete) {
      const ready = readyMatches(state);
      for (const match of ready) {
        assert.ok(!match.isReset || state.resetActive, 'reset queued while inactive');
      }
      const match = ready[0];
      const [a, b] = match.resolvedParticipants as [string, string];
      results.push({ matchKey: match.key, winnerEntryId: chalk(a, b) });
      state = replay(bracket, results);
    }
    const finalReady = readyMatches(state);
    assert.equal(finalReady.length, 0, 'nothing left ready once complete');
  });
});
