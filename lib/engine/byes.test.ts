import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generateBracket, type BracketKind, type GeneratedBracket } from './bracket';
import { seedSlotOrder } from './seeding';
import { derivePlacements, readyMatches, replay, type ReportedResult } from './replay';
import type { SeedableEntry } from './seeding';

/*
 * Byes, and the empty matches they cascade into. SPEC.md §6.1: top seeds get
 * round-1 byes, a bye auto-completes, and no match for it appears in the queue.
 *
 * Not needed at 8 entries and not needed for flip cup at 4, but the spec asks
 * for it and a bracket that silently mishandles a bye is the kind of thing
 * nobody notices until the day.
 */

function plainEntries(count: number): SeedableEntry[] {
  return Array.from({ length: count }, (_, i) => ({ id: `E${i + 1}`, teamId: `team-${i + 1}` }));
}

function playOut(bracket: GeneratedBracket) {
  const results: ReportedResult[] = [];
  let state = replay(bracket, results);
  let guard = 0;

  while (!state.complete) {
    guard += 1;
    if (guard > bracket.matches.length * 3 + 10) {
      throw new Error(`did not converge: ${bracket.entryCount} entries, ${results.length} results`);
    }
    const ready = readyMatches(state);
    if (ready.length === 0) {
      throw new Error(`stuck: ${bracket.entryCount} entries, ${results.length} results`);
    }
    const match = ready[0];
    const [a, b] = match.resolvedParticipants as [string, string];
    // Chalk: the stronger seed always wins.
    const winner = bracket.seedByEntry[a] < bracket.seedByEntry[b] ? a : b;
    results.push({ matchKey: match.key, winnerEntryId: winner });
    state = replay(bracket, results);
  }

  return { results, state };
}

describe('byes go to the top seeds', () => {
  const seedOf = (bracket: GeneratedBracket, entryId: string) => bracket.seedByEntry[entryId];

  // SPEC.md §6.1: "If N is not a power of two, top seeds receive round-1 byes."
  it('hands the walkovers to exactly the strongest seeds', () => {
    for (const count of [5, 6, 7, 9, 11, 13]) {
      const bracket = generateBracket(plainEntries(count), 'DOUBLE');
      const byeWinners = bracket.matches
        .filter((m) => m.bracket === 'WINNERS' && m.round === 1 && m.autoCompleted && m.autoWinner)
        .map((m) => seedOf(bracket, m.autoWinner!))
        .sort((a, b) => a - b);

      const expected = Array.from({ length: bracket.byes }, (_, i) => i + 1).slice(
        0,
        byeWinners.length,
      );
      assert.deepEqual(byeWinners, expected, `${count} entries`);
    }
  });

  it('leaves the weakest seeds empty', () => {
    const bracket = generateBracket(plainEntries(5), 'DOUBLE');
    assert.equal(bracket.size, 8);
    assert.equal(bracket.byes, 3);

    const order = seedSlotOrder(8);
    const emptySeeds = bracket.slots
      .map((entry, slot) => (entry === null ? order[slot] : null))
      .filter((seed): seed is number => seed !== null)
      .sort((a, b) => a - b);
    assert.deepEqual(emptySeeds, [6, 7, 8], 'the three weakest seeds should be the byes');
  });

  // Every team having one entry is the case that broke this: without balancing,
  // all of them landed in one half and the other half was almost all byes.
  it('keeps the halves balanced', () => {
    for (const count of [4, 5, 6, 7, 8, 9, 11, 13, 16]) {
      const bracket = generateBracket(plainEntries(count), 'SINGLE');
      const half = bracket.size / 2;
      const inFirst = bracket.slots.slice(0, half).filter((s) => s !== null).length;
      const inSecond = bracket.slots.slice(half).filter((s) => s !== null).length;
      assert.ok(
        Math.abs(inFirst - inSecond) <= 1,
        `${count} entries split ${inFirst}/${inSecond}`,
      );
    }
  });

  it('auto-completes a bye and advances the entry immediately', () => {
    const bracket = generateBracket(plainEntries(5), 'DOUBLE');
    const byeMatches = bracket.matches.filter(
      (m) => m.bracket === 'WINNERS' && m.round === 1 && m.autoCompleted,
    );
    assert.equal(byeMatches.length, 3);

    for (const match of byeMatches) {
      assert.notEqual(match.autoWinner, null, `${match.key} should have a walkover winner`);
      const target = bracket.matches.find((m) => m.key === match.winnerTo.matchKey)!;
      assert.equal(
        target.participants[match.winnerTo.slot!],
        match.autoWinner,
        'the entry should already be in the next round',
      );
    }
  });

  it('keeps auto-completed matches out of the queue', () => {
    const bracket = generateBracket(plainEntries(5), 'DOUBLE');
    const ready = readyMatches(replay(bracket, []));
    for (const match of ready) {
      assert.equal(match.autoCompleted, false, `${match.key} was decided by a bye`);
      assert.equal(
        match.resolvedParticipants.filter((p) => p !== null).length,
        2,
        `${match.key} is queued without two participants`,
      );
    }
  });

  it('never queues a match with only one participant', () => {
    for (const count of [3, 5, 6, 7, 9, 11, 13]) {
      for (const kind of ['SINGLE', 'DOUBLE'] as BracketKind[]) {
        const bracket = generateBracket(plainEntries(count), kind);
        const { results } = playOut(bracket);

        // Re-walk every intermediate state, not just the final one.
        for (let i = 0; i <= results.length; i += 1) {
          const state = replay(bracket, results.slice(0, i));
          for (const match of readyMatches(state)) {
            assert.equal(
              match.resolvedParticipants.filter((p) => p !== null).length,
              2,
              `${kind} ${count}: ${match.key} queued with a hole`,
            );
          }
        }
      }
    }
  });
});

describe('brackets of every size finish and place everyone', () => {
  for (const kind of ['SINGLE', 'DOUBLE'] as BracketKind[]) {
    for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 12, 16]) {
      if (kind === 'DOUBLE' && count < 3) continue;
      it(`${kind}, ${count} entries`, () => {
        const bracket = generateBracket(plainEntries(count), kind);
        const { state } = playOut(bracket);

        assert.ok(state.complete, 'should finish');
        assert.notEqual(state.championEntryId, null, 'should have a champion');

        const placements = derivePlacements(bracket, state);
        assert.equal(placements.length, count, 'everyone placed');
        assert.deepEqual(
          placements.map((p) => p.placement),
          Array.from({ length: count }, (_, i) => i + 1),
          'placements are a unique 1..N',
        );
        assert.equal(new Set(placements.map((p) => p.entryId)).size, count, 'no duplicates');
        assert.equal(placements[0].entryId, state.championEntryId, 'champion is 1st');

        // Chalk: the top seed should win.
        const topSeed = Object.entries(bracket.seedByEntry).find(([, seed]) => seed === 1)![0];
        assert.equal(state.championEntryId, topSeed, 'chalk should crown the top seed');
      });
    }
  }
});

describe('SINGLE_ELIM (SPEC.md §6.2)', () => {
  it('is the winners bracket only — no losers matches, no reset', () => {
    const bracket = generateBracket(plainEntries(8), 'SINGLE');
    assert.equal(bracket.matches.length, 7, '8 entries -> 7 matches');
    assert.equal(bracket.losersRounds, 0);
    assert.equal(bracket.matches.filter((m) => m.bracket === 'LOSERS').length, 0);
    assert.equal(bracket.matches.filter((m) => m.bracket === 'GRAND_FINAL').length, 0);
    assert.equal(bracket.matches.filter((m) => m.isReset).length, 0);
  });

  it('eliminates every loser immediately', () => {
    const bracket = generateBracket(plainEntries(8), 'SINGLE');
    for (const match of bracket.matches) {
      assert.equal(match.loserTo.matchKey, null, `${match.key} should eliminate its loser`);
    }
  });

  it('knocks everyone out on a single loss', () => {
    const bracket = generateBracket(plainEntries(8), 'SINGLE');
    const { state } = playOut(bracket);
    assert.equal(state.eliminationOrder.length, 7);
    for (const entryId of state.eliminationOrder) {
      assert.equal(state.losses.get(entryId), 1, `${entryId} should be out on one loss`);
    }
  });

  // Flip cup's likely shape: 4 entries, one per team.
  it('runs flip cup at 4 entries in 3 matches', () => {
    const bracket = generateBracket(plainEntries(4), 'SINGLE');
    assert.equal(bracket.matches.length, 3);
    const { state, results } = playOut(bracket);
    assert.equal(results.length, 3);
    assert.equal(state.championEntryId, bracket.slots[0]);

    // Both semi-final losers are ranked, and by seed, so 3rd and 4th are
    // distinct and points_matrix has no dead rung.
    const placements = derivePlacements(bracket, state);
    assert.deepEqual(placements.map((p) => p.placement), [1, 2, 3, 4]);
  });
});

describe('degenerate shapes', () => {
  it('refuses double elimination below three entries rather than deadlocking', () => {
    assert.throws(() => generateBracket(plainEntries(2), 'DOUBLE'), /at least 3 entries/);
    assert.throws(() => generateBracket(plainEntries(1), 'DOUBLE'), /at least 3 entries/);
  });

  it('still runs single elimination at two entries', () => {
    const bracket = generateBracket(plainEntries(2), 'SINGLE');
    assert.equal(bracket.matches.length, 1);
    const { state } = playOut(bracket);
    assert.equal(state.championEntryId, bracket.slots[0]);
  });
});

describe('placement order — not just uniqueness', () => {
  const seed = (bracket: GeneratedBracket, entryId: string) => bracket.seedByEntry[entryId];

  // A chalk bracket is the one case where the right answer is knowable by hand:
  // if the stronger seed always wins, placements must come out in seed order.
  it('places a chalk single-elim bracket in exact seed order', () => {
    for (const count of [4, 8, 16]) {
      const bracket = generateBracket(plainEntries(count), 'SINGLE');
      const { state } = playOut(bracket);
      const placements = derivePlacements(bracket, state);

      assert.deepEqual(
        placements.map((p) => seed(bracket, p.entryId)),
        Array.from({ length: count }, (_, i) => i + 1),
        `${count} entries should place 1..N in seed order`,
      );
    }
  });

  // This is the assertion that catches placements being handed out backwards.
  it('places the last entry knocked out 2nd, and the weakest earliest-out last', () => {
    for (const kind of ['SINGLE', 'DOUBLE'] as BracketKind[]) {
      const bracket = generateBracket(plainEntries(8), kind);
      const { state } = playOut(bracket);
      const placements = derivePlacements(bracket, state);
      const placementOf = new Map(placements.map((p) => [p.entryId, p.placement]));

      // The final loss is always its own stage, so this one is unambiguous.
      const lastOut = state.eliminationOrder.at(-1)!;
      assert.equal(placementOf.get(lastOut), 2, `${kind}: last knocked out should be 2nd`);

      // Several entries share the earliest stage, so last place goes to the
      // weakest seed among them rather than to whoever was reported first.
      const lowestStage = Math.min(...state.eliminations.map((e) => e.stage));
      const earliest = state.eliminations.filter((e) => e.stage === lowestStage);
      const weakest = earliest.reduce((worst, candidate) =>
        seed(bracket, candidate.entryId) > seed(bracket, worst.entryId) ? candidate : worst,
      );
      assert.equal(
        placementOf.get(weakest.entryId),
        8,
        `${kind}: weakest of the first-round exits should place last`,
      );
    }
  });

  // Under double elimination, surviving into a later losers round has to place
  // you better. Without this the "later stage places better" check below is
  // vacuous, because nothing would have differing stages.
  it('ranks losers-bracket depth, not just "eliminated at all"', () => {
    const bracket = generateBracket(plainEntries(8), 'DOUBLE');
    const { state } = playOut(bracket);

    const stages = new Set(state.eliminations.map((e) => e.stage));
    assert.ok(
      stages.size >= 4,
      `expected several distinct elimination stages, got ${[...stages].join(',')}`,
    );

    const placements = derivePlacements(bracket, state);
    const placementOf = new Map(placements.map((p) => [p.entryId, p.placement]));

    // The deepest losers run before the grand final places 3rd: 1st and 2nd are
    // the two grand finalists.
    const grandFinalStage = Math.max(...state.eliminations.map((e) => e.stage));
    const lastLosersStage = Math.max(
      ...state.eliminations.filter((e) => e.stage < grandFinalStage).map((e) => e.stage),
    );
    const deepestLosersExit = state.eliminations.filter((e) => e.stage === lastLosersStage);
    assert.equal(deepestLosersExit.length, 1, 'the losers final knocks out exactly one');
    assert.equal(
      placementOf.get(deepestLosersExit[0].entryId),
      3,
      'the losers-final loser should place 3rd',
    );
  });

  it('no losers-round-1 match is a rematch of a winners-round-1 match', () => {
    const bracket = generateBracket(plainEntries(8), 'DOUBLE');
    const winnersRound1 = bracket.matches.filter(
      (m) => m.bracket === 'WINNERS' && m.round === 1,
    );

    // Which losers slot each winners-round-1 loser drops into.
    const dropTarget = new Map<string, string>();
    for (const match of winnersRound1) {
      dropTarget.set(match.key, match.loserTo.matchKey!);
    }

    // Two entries that played each other must not be routed to the same losers
    // match, or they meet again immediately.
    const seen = new Map<string, string>();
    for (const [matchKey, target] of dropTarget) {
      const existing = seen.get(target);
      assert.notEqual(
        existing,
        matchKey,
        `${matchKey} sends both its entries to ${target}`,
      );
      seen.set(target, matchKey);
    }

    // And each losers-round-1 match takes its two entries from two different
    // winners matches.
    const feedersPerTarget = new Map<string, Set<string>>();
    for (const match of winnersRound1) {
      const target = match.loserTo.matchKey!;
      feedersPerTarget.set(target, (feedersPerTarget.get(target) ?? new Set()).add(match.key));
    }
    for (const [target, feeders] of feedersPerTarget) {
      assert.equal(feeders.size, 2, `${target} should draw from two winners matches`);
    }
  });

  it('never places someone knocked out earlier above someone knocked out later', () => {
    for (const kind of ['SINGLE', 'DOUBLE'] as BracketKind[]) {
      for (const count of [4, 5, 8, 11, 16]) {
        if (kind === 'DOUBLE' && count < 3) continue;
        const bracket = generateBracket(plainEntries(count), kind);
        const { state } = playOut(bracket);
        const placements = derivePlacements(bracket, state);
        const placementOf = new Map(placements.map((p) => [p.entryId, p.placement]));
        const stageOf = new Map(state.eliminations.map((e) => [e.entryId, e.stage]));

        for (const a of state.eliminations) {
          for (const b of state.eliminations) {
            if (stageOf.get(a.entryId)! <= stageOf.get(b.entryId)!) continue;
            assert.ok(
              placementOf.get(a.entryId)! < placementOf.get(b.entryId)!,
              `${kind} ${count}: ${a.entryId} survived longer but placed worse`,
            );
          }
        }
      }
    }
  });

  // SPEC.md §6.2: co-eliminated entries are ordered by seed, so points_matrix
  // has no dead rung and the ordering is not an accident of reporting order.
  it('breaks a same-stage tie by seed, not by which match was reported first', () => {
    const bracket = generateBracket(plainEntries(8), 'SINGLE');
    const { state } = playOut(bracket);
    const placements = derivePlacements(bracket, state);
    const placementOf = new Map(placements.map((p) => [p.entryId, p.placement]));

    const byStage = new Map<number, string[]>();
    for (const { entryId, stage } of state.eliminations) {
      byStage.set(stage, [...(byStage.get(stage) ?? []), entryId]);
    }

    let checkedAGroup = false;
    for (const group of byStage.values()) {
      if (group.length < 2) continue;
      checkedAGroup = true;
      const bySeed = [...group].sort((a, b) => seed(bracket, a) - seed(bracket, b));
      const byPlacement = [...group].sort(
        (a, b) => placementOf.get(a)! - placementOf.get(b)!,
      );
      assert.deepEqual(byPlacement, bySeed, 'a tied stage should be ordered by seed');
    }
    assert.ok(checkedAGroup, 'there should be at least one tied stage to check');
  });
});

describe('dropdowns avoid immediate rematches', () => {
  /*
   * A winners-bracket loser drops into a losers match whose other side comes up
   * from an earlier losers round. If both feeders trace back to the same corner
   * of the winners bracket, the dropdown can face the very entry it just beat.
   * Reversing the dropdown order stops that.
   *
   * It can only be avoided where there is a choice. The losers final has a
   * single match, so a rematch there is structurally unavoidable in any double
   * elimination bracket and is not a defect.
   */
  it('never drops into the losers match fed by its own sub-bracket, where a choice exists', () => {
    for (const size of [8, 16, 32]) {
      const bracket = generateBracket(plainEntries(size), 'DOUBLE');

      for (const match of bracket.matches) {
        if (match.bracket !== 'WINNERS' || match.round < 2) continue;
        if (match.loserTo.matchKey === null) continue;

        const targetMatch = bracket.matches.find((m) => m.key === match.loserTo.matchKey)!;
        const siblings = bracket.matches.filter(
          (m) => m.bracket === 'LOSERS' && m.round === targetMatch.round,
        ).length;
        if (siblings < 2) continue; // no alternative to drop into

        const survivorFeeder = bracket.matches.find(
          (m) =>
            m.bracket === 'LOSERS' &&
            m.winnerTo.matchKey === targetMatch.key &&
            m.winnerTo.slot === 0,
        );
        if (!survivorFeeder) continue;

        assert.notEqual(
          survivorFeeder.slot,
          match.slot,
          `size ${size}: ${match.key} drops into ${targetMatch.key}, whose other side ` +
            `comes from ${survivorFeeder.key} — the same corner of the bracket`,
        );
      }
    }
  });

  /*
   * The behavioural version, scoped to the early losers rounds.
   *
   * Deeper rematches are normal in double elimination and SPEC.md does not ask
   * for them to be avoided — it only requires same-team separation in round 1
   * and says later same-team meetings are fine. At 8 entries the only repeat
   * before the grand final is the losers final, which has a single match.
   */
  it('produces no rematch in the first two losers rounds', () => {
    for (const size of [8, 16]) {
      const bracket = generateBracket(plainEntries(size), 'DOUBLE');
      const { results } = playOut(bracket);
      const state = replay(bracket, results);

      const playedIn = new Map<string, string[]>();
      for (const match of state.matches) {
        if (!match.winnerEntryId || match.walkover || match.loserEntryId === null) continue;
        const pair = [match.winnerEntryId, match.loserEntryId].sort().join(' v ');
        playedIn.set(pair, [...(playedIn.get(pair) ?? []), match.key]);
      }

      for (const [pair, keys] of playedIn) {
        if (keys.length < 2) continue;
        for (const repeat of keys.slice(1)) {
          const match = state.byKey.get(repeat)!;
          const early = match.bracket === 'LOSERS' && match.round <= 2;
          assert.ok(!early, `size ${size}: ${pair} met again in ${repeat}, too soon`);
        }
      }
    }
  });

  it('has the losers final as the only pre-grand-final repeat at 8 entries', () => {
    const bracket = generateBracket(plainEntries(8), 'DOUBLE');
    const { results } = playOut(bracket);
    const state = replay(bracket, results);

    const repeats: string[] = [];
    const seen = new Set<string>();
    for (const match of state.matches) {
      if (!match.winnerEntryId || match.walkover || match.loserEntryId === null) continue;
      if (match.bracket === 'GRAND_FINAL') continue;
      const pair = [match.winnerEntryId, match.loserEntryId].sort().join(' v ');
      if (seen.has(pair)) repeats.push(match.key);
      seen.add(pair);
    }

    // One repeat, and it is the losers final — the one match with no alternative.
    assert.deepEqual(repeats, ['LOSERS-4-0']);
  });
});
