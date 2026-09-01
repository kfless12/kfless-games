import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assignBracketSlots,
  bracketSize,
  findSameTeamRoundOneClash,
  seedSlotOrder,
  type SeedableEntry,
} from './seeding';

/** Round-1 pairings as sorted seed pairs, so presentation order is irrelevant. */
function pairings(size: number): string[] {
  const order = seedSlotOrder(size);
  const pairs: string[] = [];
  for (let i = 0; i + 1 < order.length; i += 2) {
    pairs.push([order[i], order[i + 1]].sort((a, b) => a - b).join('v'));
  }
  return pairs.sort();
}

/** N teams with `per` entries each, labelled T<team>-<n>. */
function entries(teams: number, per: number): SeedableEntry[] {
  const out: SeedableEntry[] = [];
  for (let t = 1; t <= teams; t += 1) {
    for (let n = 1; n <= per; n += 1) {
      out.push({ id: `T${t}-${n}`, teamId: `team-${t}` });
    }
  }
  return out;
}

describe('bracketSize', () => {
  it('rounds up to the next power of two', () => {
    const cases: [number, number][] = [
      [1, 1], [2, 2], [3, 4], [4, 4], [5, 8], [6, 8], [7, 8], [8, 8], [9, 16], [16, 16], [17, 32],
    ];
    for (const [n, expected] of cases) {
      assert.equal(bracketSize(n), expected, `${n} entries`);
    }
  });

  it('is zero for no entries', () => {
    assert.equal(bracketSize(0), 0);
  });
});

describe('seedSlotOrder', () => {
  // Asserted as pairings rather than a literal sequence: several published
  // orderings describe the same bracket, differing only in which slot of a
  // match a seed sits in. The pairings are what actually determine the bracket.
  it('produces the standard round-1 pairings', () => {
    assert.deepEqual(pairings(8), ['1v8', '2v7', '3v6', '4v5']);
    assert.deepEqual(pairings(4), ['1v4', '2v3']);
    assert.deepEqual(pairings(2), ['1v2']);
  });

  // Assuming the higher seed always wins, every round must pair to a constant.
  // This is the property that makes a bracket "standard" — it is what stops
  // seeds 1 and 2 from meeting before the final.
  it('keeps pairings balanced in every round, not just the first', () => {
    let survivors = seedSlotOrder(16);

    while (survivors.length > 1) {
      const expectedSum = survivors.length + 1;
      const winners: number[] = [];

      for (let i = 0; i + 1 < survivors.length; i += 2) {
        assert.equal(
          survivors[i] + survivors[i + 1],
          expectedSum,
          `round of ${survivors.length}: ${survivors[i]} v ${survivors[i + 1]}`,
        );
        winners.push(Math.min(survivors[i], survivors[i + 1]));
      }

      survivors = winners;
    }

    assert.deepEqual(survivors, [1], 'the top seed should win a chalk bracket');
  });

  it('pairs every round-1 match to sum to size + 1', () => {
    for (const size of [2, 4, 8, 16, 32]) {
      const order = seedSlotOrder(size);
      for (let i = 0; i + 1 < order.length; i += 2) {
        assert.equal(order[i] + order[i + 1], size + 1, `size ${size}, slot ${i}`);
      }
    }
  });

  it('uses every seed exactly once', () => {
    for (const size of [2, 4, 8, 16]) {
      const order = seedSlotOrder(size);
      assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: size }, (_, i) => i + 1));
    }
  });

  // Seeds 1 and 2 must be in opposite halves, or the final is not the final.
  it('keeps the top two seeds in opposite halves', () => {
    for (const size of [4, 8, 16, 32]) {
      const order = seedSlotOrder(size);
      const half = size / 2;
      assert.ok(order.indexOf(1) < half, `size ${size}: seed 1 in first half`);
      assert.ok(order.indexOf(2) >= half, `size ${size}: seed 2 in second half`);
    }
  });
});

describe('same-team separation — the SPEC.md §6.1 rule', () => {
  // Beer pong: 8 entries, 4 teams, 2 each. The actual event case.
  it('never pairs a team against itself in round 1 at 8 entries from 4 teams', () => {
    const slots = assignBracketSlots(entries(4, 2));
    assert.equal(findSameTeamRoundOneClash(slots), null);
  });

  it('puts each team\'s two entries in opposite halves at 8 entries', () => {
    const slots = assignBracketSlots(entries(4, 2));
    const half = slots.length / 2;
    const byTeam = new Map<string, number[]>();
    slots.forEach((entry, index) => {
      if (!entry) return;
      const halves = byTeam.get(entry.teamId) ?? [];
      halves.push(index < half ? 0 : 1);
      byTeam.set(entry.teamId, halves);
    });
    for (const [teamId, halves] of byTeam) {
      assert.deepEqual([...halves].sort(), [0, 1], `${teamId} should straddle the halves`);
    }
  });

  it('holds for other shapes too', () => {
    const shapes: [number, number][] = [
      [4, 2], [4, 1], [2, 2], [2, 4], [4, 4], [3, 2], [8, 2], [4, 3], [5, 3], [2, 8],
    ];
    for (const [teams, per] of shapes) {
      const slots = assignBracketSlots(entries(teams, per));
      const clash = findSameTeamRoundOneClash(slots);
      assert.equal(clash, null, `${teams} teams x ${per}: clash at slots ${clash?.slotA}/${clash?.slotB}`);
    }
  });

  // Unavoidable: one team with every entry has to meet itself.
  it('reports a clash rather than pretending, when separation is impossible', () => {
    const slots = assignBracketSlots(entries(1, 4));
    assert.notEqual(findSameTeamRoundOneClash(slots), null);
  });
});

describe('assignBracketSlots', () => {
  it('returns a full bracket with byes as nulls', () => {
    const slots = assignBracketSlots(entries(3, 2));
    assert.equal(slots.length, 8, '6 entries -> bracket of 8');
    assert.equal(slots.filter((s) => s === null).length, 2, 'two byes');
    assert.equal(slots.filter((s) => s !== null).length, 6);
  });

  it('places every entry exactly once', () => {
    const source = entries(4, 2);
    const placed = assignBracketSlots(source).filter((s) => s !== null).map((s) => s!.id);
    assert.deepEqual([...placed].sort(), source.map((entry) => entry.id).sort());
  });

  it('is deterministic', () => {
    const source = entries(4, 2);
    const a = assignBracketSlots(source).map((s) => s?.id ?? null);
    const b = assignBracketSlots(source).map((s) => s?.id ?? null);
    assert.deepEqual(a, b);
  });

  it('does not depend on the order entries arrive in', () => {
    const source = entries(4, 2);
    const shuffled = [source[7], source[2], source[5], source[0], source[3], source[6], source[1], source[4]];
    const clash = findSameTeamRoundOneClash(assignBracketSlots(shuffled));
    assert.equal(clash, null);
  });

  it('is empty for no entries', () => {
    assert.deepEqual(assignBracketSlots([]), []);
  });

  it('handles a single entry', () => {
    const slots = assignBracketSlots(entries(1, 1));
    assert.equal(slots.length, 1);
    assert.equal(slots[0]?.id, 'T1-1');
  });
});

describe('explicit seeds override the automatic spread', () => {
  it('honours admin-assigned seeds when every entry has one', () => {
    const source: SeedableEntry[] = [
      { id: 'a', teamId: 'team-1', seed: 3 },
      { id: 'b', teamId: 'team-1', seed: 1 },
      { id: 'c', teamId: 'team-2', seed: 4 },
      { id: 'd', teamId: 'team-2', seed: 2 },
    ];
    // Bracket of 4, slot order [1,4,2,3] -> seeds b(1), c(4), d(2), a(3).
    const slots = assignBracketSlots(source).map((e) => e?.id ?? null);
    assert.deepEqual(slots, ['b', 'c', 'd', 'a']);
  });

  it('falls back to the spread when only some entries are seeded', () => {
    const source: SeedableEntry[] = [
      { id: 'a', teamId: 'team-1', seed: 1 },
      { id: 'b', teamId: 'team-1' },
      { id: 'c', teamId: 'team-2' },
      { id: 'd', teamId: 'team-2' },
    ];
    assert.equal(findSameTeamRoundOneClash(assignBracketSlots(source)), null);
  });
});

describe('seedSlotOrder guards itself', () => {
  // A broken seed order is worse than a crash: it yields a bracket with
  // duplicate seeds, which surfaces much later as a bracket that will not play.
  it('is always a permutation of 1..size', () => {
    for (const size of [1, 2, 4, 8, 16, 32, 64]) {
      const order = seedSlotOrder(size);
      assert.equal(order.length, size);
      assert.equal(new Set(order).size, size, `size ${size} has duplicates`);
      assert.equal(Math.min(...order), 1);
      assert.equal(Math.max(...order), size);
    }
  });
});
