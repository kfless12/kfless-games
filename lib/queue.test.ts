import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bumpPositionFor,
  buildStationQueues,
  compareQueueOrder,
  explainStartRefusal,
  authorizeQueueStart,
  findMyMatches,
  findYoureUp,
  isViewersMatch,
  type QueueViewer,
  type MatchStatus,
  type QueueMatch,
  startableMatchIds,
  UNASSIGNED_STATION,
} from './queue';

let counter = 0;

function match(overrides: Partial<QueueMatch> = {}): QueueMatch {
  counter += 1;
  return {
    id: overrides.id ?? `m${counter}`,
    gameId: 'game-1',
    gameName: 'Beer Pong',
    gameSortOrder: 0,
    station: 'Pong Table',
    bracket: 'WINNERS',
    round: 1,
    slot: 0,
    status: 'READY' as MatchStatus,
    queuePosition: null,
    wholeTeamGame: false,
    sides: [
      {
        entryId: 'e1',
        label: 'Team One — A',
        shortLabel: 'T1-A',
        teamId: 'team-1',
        teamName: 'One',
        teamColor: '#f00',
        playerIds: [],
      },
      {
        entryId: 'e2',
        label: 'Team Two — A',
        shortLabel: 'T2-A',
        teamId: 'team-2',
        teamName: 'Two',
        teamColor: '#00f',
        playerIds: [],
      },
    ],
    ...overrides,
  };
}

/** A viewer on team-1 who is not assigned to any entry. */
function viewer(teamId: string | null, personId = 'nobody'): QueueViewer {
  return { personId, teamId };
}

describe('buildStationQueues', () => {
  it('fills now playing, on deck and in the hole in order', () => {
    const queues = buildStationQueues([
      match({ id: 'c', round: 1, slot: 2 }),
      match({ id: 'a', round: 1, slot: 0, status: 'IN_PROGRESS' }),
      match({ id: 'b', round: 1, slot: 1 }),
      match({ id: 'd', round: 2, slot: 0 }),
    ]);

    assert.equal(queues.length, 1);
    const [queue] = queues;
    assert.equal(queue.nowPlaying?.id, 'a');
    assert.equal(queue.onDeck?.id, 'b');
    assert.equal(queue.inTheHole?.id, 'c');
    assert.deepEqual(queue.waiting.map((m) => m.id), ['d']);
  });

  // SPEC.md §7.1: now playing appears "once the admin taps start". Until then
  // the first in line is on deck, and nothing is playing.
  it('has nothing playing until a match is started', () => {
    const [queue] = buildStationQueues([
      match({ id: 'a', slot: 0 }),
      match({ id: 'b', slot: 1 }),
    ]);
    assert.equal(queue.nowPlaying, null);
    assert.equal(queue.onDeck?.id, 'a');
    assert.equal(queue.inTheHole?.id, 'b');
  });

  it('keeps a started match at the front even if it is not first in order', () => {
    // People are stood at the table playing it; reordering it away would be a lie.
    const [queue] = buildStationQueues([
      match({ id: 'first', round: 1, slot: 0 }),
      match({ id: 'started', round: 9, slot: 9, status: 'IN_PROGRESS' }),
    ]);
    assert.equal(queue.nowPlaying?.id, 'started');
    assert.equal(queue.onDeck?.id, 'first');
  });

  // SPEC.md §6.1: only READY matches enter the queue.
  it('leaves out matches that are pending or already complete', () => {
    const queues = buildStationQueues([
      match({ id: 'pending', status: 'PENDING' }),
      match({ id: 'done', status: 'COMPLETE' }),
      match({ id: 'ready', status: 'READY' }),
    ]);
    assert.equal(queues.length, 1);
    assert.equal(queues[0].onDeck?.id, 'ready');
    assert.equal(queues[0].inTheHole, null);
    assert.deepEqual(queues[0].waiting, []);
  });

  it('is empty when nothing is queueable', () => {
    assert.deepEqual(buildStationQueues([match({ status: 'PENDING' })]), []);
    assert.deepEqual(buildStationQueues([]), []);
  });

  it('separates stations and sorts them alphabetically', () => {
    const queues = buildStationQueues([
      match({ id: 'lawn', station: 'Lawn' }),
      match({ id: 'patio', station: 'Pong Table — Patio' }),
      match({ id: 'deck', station: 'Deck' }),
    ]);
    assert.deepEqual(queues.map((q) => q.station), ['Deck', 'Lawn', 'Pong Table — Patio']);
    for (const queue of queues) {
      assert.equal(queue.waiting.length, 0);
      assert.notEqual(queue.onDeck, null);
    }
  });

  it('buckets stationless games separately and puts them last', () => {
    const queues = buildStationQueues([
      match({ id: 'none', station: null }),
      match({ id: 'blank', station: '   ' }),
      match({ id: 'real', station: 'Zebra Table' }),
    ]);
    assert.deepEqual(queues.map((q) => q.station), ['Zebra Table', UNASSIGNED_STATION]);
    assert.equal(queues[1].unassigned, true);
    assert.equal(queues[0].unassigned, false);
    // A blank string is the same as no station.
    assert.equal(queues[1].onDeck !== null && queues[1].inTheHole !== null, true);
  });

  // Two matches at one station cannot both be "the" one being played.
  it('treats only the first started match as now playing', () => {
    const [queue] = buildStationQueues([
      match({ id: 'a', round: 1, slot: 0, status: 'IN_PROGRESS' }),
      match({ id: 'b', round: 1, slot: 1, status: 'IN_PROGRESS' }),
    ]);
    assert.equal(queue.nowPlaying?.id, 'a');
    assert.equal(queue.onDeck?.id, 'b', 'the second stays in the queue rather than vanishing');
  });
});

describe('queue ordering', () => {
  it('orders by round then slot', () => {
    const ordered = [
      match({ id: 'r2s0', round: 2, slot: 0 }),
      match({ id: 'r1s1', round: 1, slot: 1 }),
      match({ id: 'r1s0', round: 1, slot: 0 }),
    ].sort(compareQueueOrder);
    assert.deepEqual(ordered.map((m) => m.id), ['r1s0', 'r1s1', 'r2s0']);
  });

  // The manual override from SPEC.md §7.1.
  it('puts a bumped match in front of everything', () => {
    const [queue] = buildStationQueues([
      match({ id: 'a', round: 1, slot: 0 }),
      match({ id: 'b', round: 1, slot: 1 }),
      match({ id: 'bumped', round: 9, slot: 9, queuePosition: -1 }),
    ]);
    assert.equal(queue.onDeck?.id, 'bumped');
    assert.equal(queue.inTheHole?.id, 'a');
  });

  it('orders two bumped matches by their positions', () => {
    const ordered = [
      match({ id: 'second', queuePosition: -1 }),
      match({ id: 'first', queuePosition: -5 }),
      match({ id: 'normal', queuePosition: null }),
    ].sort(compareQueueOrder);
    assert.deepEqual(ordered.map((m) => m.id), ['first', 'second', 'normal']);
  });

  it('is deterministic for two matches that tie on everything else', () => {
    const a = match({ id: 'aaa', gameName: 'Game', round: 1, slot: 0 });
    const b = match({ id: 'bbb', gameName: 'Game', round: 1, slot: 0 });
    assert.deepEqual([b, a].sort(compareQueueOrder).map((m) => m.id), ['aaa', 'bbb']);
    assert.deepEqual([a, b].sort(compareQueueOrder).map((m) => m.id), ['aaa', 'bbb']);
  });

  // SPEC.md §7.1 says round then slot, so two games at one station interleave by
  // round rather than being grouped by game. Asserted so the behaviour is a
  // decision rather than an accident.
  it('interleaves two games at the same station by round', () => {
    const ordered = [
      match({ id: 'g2r1', gameId: 'g2', gameName: 'Flip Cup', gameSortOrder: 1, round: 1, slot: 0 }),
      match({ id: 'g1r2', gameId: 'g1', gameName: 'Beer Pong', gameSortOrder: 0, round: 2, slot: 0 }),
      match({ id: 'g1r1', gameId: 'g1', gameName: 'Beer Pong', gameSortOrder: 0, round: 1, slot: 0 }),
    ].sort(compareQueueOrder);
    assert.deepEqual(ordered.map((m) => m.id), ['g1r1', 'g2r1', 'g1r2']);
  });
});

describe('bumpPositionFor', () => {
  it('is -1 when nothing has been bumped yet', () => {
    assert.equal(bumpPositionFor([match(), match()]), -1);
  });

  it('goes in front of an existing bump', () => {
    assert.equal(bumpPositionFor([match({ queuePosition: -1 }), match()]), -2);
    assert.equal(bumpPositionFor([match({ queuePosition: -7 })]), -8);
  });

  it('handles an empty station', () => {
    assert.equal(bumpPositionFor([]), -1);
  });
});

describe('findYoureUp — SPEC.md §7.2', () => {
  const mine = 'team-1';
  // `mine` is a team id (for side()); `me` is the viewer on that team.
  const me = viewer(mine);

  it('fires for a match that is now playing', () => {
    const queues = buildStationQueues([match({ id: 'a', status: 'IN_PROGRESS' })]);
    const hits = findYoureUp(queues, me);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].slot, 'NOW_PLAYING');
    assert.equal(hits[0].match.id, 'a');
    assert.equal(hits[0].station, 'Pong Table', 'the banner needs the station name');
  });

  it('fires for a match that is on deck', () => {
    const queues = buildStationQueues([match({ id: 'a' })]);
    const hits = findYoureUp(queues, me);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].slot, 'ON_DECK');
  });

  // Two matches out is not "you're up"; firing then would train people to
  // ignore the banner. This has to put the team genuinely in the hole — an
  // earlier version of this test left them further back, so it never tested
  // the boundary at all.
  it('does not fire when the team is only in the hole', () => {
    const queues = buildStationQueues([
      match({ id: 'theirs', slot: 0, sides: [side('team-8'), side('team-9')] }),
      match({ id: 'mine', slot: 1 }),
    ]);
    const [queue] = queues;
    assert.equal(queue.onDeck?.id, 'theirs');
    assert.equal(queue.inTheHole?.id, 'mine', 'the team must actually be in the hole');
    assert.deepEqual(findYoureUp(queues, me), []);
  });

  it('does not fire for a match further back than in the hole', () => {
    const queues = buildStationQueues([
      match({ id: 'a', slot: 0, sides: [side('team-8'), side('team-9')] }),
      match({ id: 'b', slot: 1, sides: [side('team-8'), side('team-9')] }),
      match({ id: 'mine', slot: 2 }),
    ]);
    assert.deepEqual(queues[0].waiting.map((m) => m.id), ['mine']);
    assert.deepEqual(findYoureUp(queues, me), []);
  });

  it('fires at both stations when a team is up twice at once', () => {
    const queues = buildStationQueues([
      match({ id: 'a', station: 'Pong Table', status: 'IN_PROGRESS' }),
      match({ id: 'b', station: 'Lawn' }),
    ]);
    const hits = findYoureUp(queues, me);
    assert.equal(hits.length, 2, 'a team with two entries can be up in two places');
    assert.deepEqual(hits.map((h) => h.station).sort(), ['Lawn', 'Pong Table']);
  });

  it('is silent for a team that is not up, and for nobody signed in', () => {
    const queues = buildStationQueues([match({ id: 'a', status: 'IN_PROGRESS' })]);
    assert.deepEqual(findYoureUp(queues, viewer('team-99')), []);
    assert.deepEqual(findYoureUp(queues, null), []);
  });

  // A team's two entries can meet each other; the banner should fire once.
  it('fires once for a match between a team and itself', () => {
    const queues = buildStationQueues([
      match({ id: 'a', status: 'IN_PROGRESS', sides: [side(mine), side(mine)] }),
    ]);
    assert.equal(findYoureUp(queues, me).length, 1);
  });

  it('ignores an empty slot', () => {
    const queues = buildStationQueues([
      match({
        id: 'a',
        status: 'IN_PROGRESS',
        sides: [side(mine), { entryId: null, label: null, shortLabel: null, teamId: null, teamName: null, teamColor: null, playerIds: [] }],
      }),
    ]);
    assert.equal(findYoureUp(queues, me).length, 1);
    assert.deepEqual(findYoureUp(queues, null), []);
  });
});

function side(teamId: string, playerIds: string[] = []) {
  return {
    entryId: `entry-${teamId}`,
    label: `Label ${teamId}`,
    shortLabel: `S-${teamId}`,
    teamId,
    teamName: teamId,
    teamColor: '#000',
    playerIds,
  };
}

describe('findMyMatches — SPEC.md §7.2', () => {
  it('returns the team\'s queueable matches in queue order', () => {
    const matches = [
      match({ id: 'later', round: 3 }),
      match({ id: 'sooner', round: 1 }),
      match({ id: 'theirs', round: 2, sides: [side('team-8'), side('team-9')] }),
    ];
    assert.deepEqual(
      findMyMatches(matches, viewer('team-1')).map((m) => m.id),
      ['sooner', 'later'],
    );
  });

  it('spans games and stations', () => {
    const matches = [
      match({ id: 'pong', gameId: 'g1', gameName: 'Beer Pong', station: 'Patio', round: 2 }),
      match({ id: 'flip', gameId: 'g2', gameName: 'Flip Cup', station: 'Lawn', round: 1 }),
    ];
    assert.deepEqual(findMyMatches(matches, viewer('team-1')).map((m) => m.id), ['flip', 'pong']);
  });

  it('leaves out matches whose slots are not filled yet', () => {
    const matches = [match({ id: 'pending', status: 'PENDING' })];
    assert.deepEqual(findMyMatches(matches, viewer('team-1')), []);
  });

  it('is empty for nobody signed in', () => {
    assert.deepEqual(findMyMatches([match()], null), []);
  });
});

describe('startableMatchIds — SPEC.md §7.1', () => {
  it('is the on-deck match when the station is free', () => {
    const queues = buildStationQueues([
      match({ id: 'first', slot: 0 }),
      match({ id: 'second', slot: 1 }),
    ]);
    assert.deepEqual(startableMatchIds(queues), ['first']);
  });

  // A station is one physical table.
  it('is nothing while a match is under way at that station', () => {
    const queues = buildStationQueues([
      match({ id: 'playing', slot: 0, status: 'IN_PROGRESS' }),
      match({ id: 'next', slot: 1 }),
    ]);
    assert.deepEqual(startableMatchIds(queues), []);
  });

  // Tapping start on something three deep would promote it past other teams.
  it('never offers a match that is not next', () => {
    const queues = buildStationQueues([
      match({ id: 'a', slot: 0 }),
      match({ id: 'b', slot: 1 }),
      match({ id: 'c', slot: 2 }),
    ]);
    const startable = startableMatchIds(queues);
    assert.deepEqual(startable, ['a']);
    assert.ok(!startable.includes('b'));
    assert.ok(!startable.includes('c'));
  });

  it('offers one per free station', () => {
    const queues = buildStationQueues([
      match({ id: 'lawn', station: 'Lawn', slot: 0 }),
      match({ id: 'patio-playing', station: 'Patio', slot: 0, status: 'IN_PROGRESS' }),
      match({ id: 'patio-next', station: 'Patio', slot: 1 }),
      match({ id: 'field', station: 'Field', slot: 0 }),
    ]);
    assert.deepEqual(startableMatchIds(queues).sort(), ['field', 'lawn']);
  });

  it('honours a bump, so the bumped match becomes the startable one', () => {
    const queues = buildStationQueues([
      match({ id: 'normal', slot: 0 }),
      match({ id: 'bumped', slot: 9, queuePosition: -1 }),
    ]);
    assert.deepEqual(startableMatchIds(queues), ['bumped']);
  });

  it('is empty when nothing is queued', () => {
    assert.deepEqual(startableMatchIds([]), []);
  });
});

describe('explainStartRefusal', () => {
  it('allows the on-deck match', () => {
    const queues = buildStationQueues([match({ id: 'a', slot: 0 })]);
    assert.equal(explainStartRefusal(queues, 'a'), null);
  });

  it('says why when something else is on at that station', () => {
    const queues = buildStationQueues([
      match({ id: 'playing', slot: 0, status: 'IN_PROGRESS' }),
      match({ id: 'next', slot: 1 }),
    ]);
    const reason = explainStartRefusal(queues, 'next');
    assert.ok(reason && /still on at Pong Table/.test(reason), reason ?? 'no reason');
  });

  it('says a match is already under way', () => {
    const queues = buildStationQueues([match({ id: 'a', status: 'IN_PROGRESS' })]);
    assert.ok(/already under way/.test(explainStartRefusal(queues, 'a') ?? ''));
  });

  it('points at the bump when a match is not next', () => {
    const queues = buildStationQueues([
      match({ id: 'a', slot: 0 }),
      match({ id: 'b', slot: 1 }),
    ]);
    const reason = explainStartRefusal(queues, 'b');
    assert.ok(reason && /Bump it first/.test(reason), reason ?? 'no reason');
  });

  it('reports a match that is not queued at all', () => {
    assert.ok(/not in the queue/.test(explainStartRefusal([], 'nope') ?? ''));
  });
});

/*
 * SPEC.md §7.4. The banner is the only thing telling people to walk to a table,
 * so a false positive trains them to ignore it and a false negative means they
 * never show up. Both directions are asserted.
 */
describe('isViewersMatch — SPEC.md §7.4', () => {
  const ALICE = 'p-alice';
  const BOB = 'p-bob';

  it('fires for a player assigned to an entry', () => {
    const m = match({ sides: [side('team-1', [ALICE]), side('team-2', [BOB])] });
    assert.equal(isViewersMatch(m, { personId: ALICE, teamId: 'team-1' }), true);
  });

  it('does not fire for a teammate who is not in this entry', () => {
    // The whole point: a beer pong team fields two pairs, and the pair that is
    // not playing must not be told to go to the table.
    const m = match({ sides: [side('team-1', [ALICE]), side('team-2', [BOB])] });
    assert.equal(isViewersMatch(m, { personId: 'p-carol', teamId: 'team-1' }), false);
  });

  it('falls back to the whole team when the entry has nobody assigned', () => {
    // §4.4 makes assignment optional. Telling nobody would be worse.
    const m = match({ sides: [side('team-1'), side('team-2')] });
    assert.equal(isViewersMatch(m, { personId: 'p-carol', teamId: 'team-1' }), true);
  });

  it('narrows as soon as that entry is assigned', () => {
    const before = match({ sides: [side('team-1'), side('team-2')] });
    const after = match({ sides: [side('team-1', [ALICE]), side('team-2')] });
    const carol = { personId: 'p-carol', teamId: 'team-1' };
    assert.equal(isViewersMatch(before, carol), true, 'unassigned pings the team');
    assert.equal(isViewersMatch(after, carol), false, 'assigning someone else must exclude her');
  });

  it('pings the whole team in a whole-team game even when players are named', () => {
    // Everyone really is playing, so honouring the assignment would be wrong.
    const m = match({
      wholeTeamGame: true,
      sides: [side('team-1', [ALICE]), side('team-2', [BOB])],
    });
    assert.equal(isViewersMatch(m, { personId: 'p-carol', teamId: 'team-1' }), true);
  });

  it('still ignores the other team in a whole-team game', () => {
    const m = match({ wholeTeamGame: true, sides: [side('team-1'), side('team-2')] });
    assert.equal(isViewersMatch(m, { personId: 'p-dave', teamId: 'team-9' }), false);
  });

  it('fires on the assignment even if the viewer has no team recorded', () => {
    const m = match({ sides: [side('team-1', [ALICE]), side('team-2', [BOB])] });
    assert.equal(isViewersMatch(m, { personId: ALICE, teamId: null }), true);
  });

  it('is false for nobody signed in', () => {
    assert.equal(isViewersMatch(match(), null), false);
  });

  it('ignores an empty bracket slot', () => {
    const m = match({
      sides: [
        side('team-1', [ALICE]),
        {
          entryId: null,
          label: null,
          shortLabel: null,
          teamId: null,
          teamName: null,
          teamColor: null,
          playerIds: [],
        },
      ],
    });
    assert.equal(isViewersMatch(m, { personId: 'p-carol', teamId: null }), false);
  });
});

describe('authorizeQueueStart — SPEC.md §7.1', () => {
  it('allows the admin', () => {
    assert.equal(authorizeQueueStart({ role: 'ADMIN' }).allowed, true);
  });

  it('allows any team captain, not only one playing in the match', () => {
    assert.equal(authorizeQueueStart({ role: 'CAPTAIN' }).allowed, true);
  });

  it('refuses a plain player', () => {
    const verdict = authorizeQueueStart({ role: 'PLAYER' });
    assert.equal(verdict.allowed, false);
    assert.ok(/captain/i.test(verdict.reason ?? ''));
  });

  it('refuses nobody signed in', () => {
    const verdict = authorizeQueueStart(null);
    assert.equal(verdict.allowed, false);
    assert.ok(/sign in/i.test(verdict.reason ?? ''));
  });
});

