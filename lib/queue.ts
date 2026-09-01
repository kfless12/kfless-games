/*
 * The queue derives itself. SPEC.md §7.1.
 *
 * "The admin must not have to drag matches around for three days" — so nothing
 * here is stored ordering except the one manual override (queue_position). Feed
 * it the match rows and it produces each station's now playing / on deck / in
 * the hole, which means submitting a result advances the queue with no extra
 * work: the completed match drops out and newly-READY matches appear.
 *
 * Pure. No database, no request context.
 */

export type MatchStatus = 'PENDING' | 'READY' | 'IN_PROGRESS' | 'COMPLETE';

export type QueueSide = {
  entryId: string | null;
  label: string | null;
  teamId: string | null;
  teamName: string | null;
  teamColor: string | null;
};

export type QueueMatch = {
  id: string;
  gameId: string;
  gameName: string;
  gameSortOrder: number;
  /** Copied from the game when the tournament was generated. */
  station: string | null;
  bracket: string;
  round: number;
  slot: number;
  status: MatchStatus;
  /** The manual override. Lower sorts earlier; null means "no override". */
  queuePosition: number | null;
  sides: QueueSide[];
};

/** Matches from a game with no station still have to be visible somewhere. */
export const UNASSIGNED_STATION = 'No station set';

export type QueueSlotName = 'NOW_PLAYING' | 'ON_DECK' | 'IN_THE_HOLE';

export type StationQueue = {
  station: string;
  /** True when this is the bucket for games with no station configured. */
  unassigned: boolean;
  nowPlaying: QueueMatch | null;
  onDeck: QueueMatch | null;
  inTheHole: QueueMatch | null;
  /** Everything after in-the-hole, in order. */
  waiting: QueueMatch[];
};

/** Only these can be in the queue. SPEC.md §6.1: only READY matches queue. */
function isQueueable(match: QueueMatch): boolean {
  return match.status === 'READY' || match.status === 'IN_PROGRESS';
}

export function stationNameOf(match: QueueMatch): string {
  const trimmed = match.station?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : UNASSIGNED_STATION;
}

/**
 * SPEC.md §7.1: "ordered by round then slot", with the manual override first.
 *
 * The game is only a final tiebreak, so two games sharing one station interleave
 * by round exactly as the spec describes rather than being grouped by game.
 */
export function compareQueueOrder(a: QueueMatch, b: QueueMatch): number {
  const positionA = a.queuePosition ?? Number.MAX_SAFE_INTEGER;
  const positionB = b.queuePosition ?? Number.MAX_SAFE_INTEGER;
  if (positionA !== positionB) return positionA - positionB;

  if (a.round !== b.round) return a.round - b.round;
  if (a.slot !== b.slot) return a.slot - b.slot;

  if (a.gameSortOrder !== b.gameSortOrder) return a.gameSortOrder - b.gameSortOrder;
  return a.gameName.localeCompare(b.gameName) || a.id.localeCompare(b.id);
}

export function buildStationQueues(matches: QueueMatch[]): StationQueue[] {
  const byStation = new Map<string, QueueMatch[]>();

  for (const match of matches) {
    if (!isQueueable(match)) continue;
    const station = stationNameOf(match);
    byStation.set(station, [...(byStation.get(station) ?? []), match]);
  }

  const queues: StationQueue[] = [];

  for (const [station, stationMatches] of byStation) {
    const ordered = [...stationMatches].sort(compareQueueOrder);

    /*
     * NOW_PLAYING is whatever the admin has actually started, not simply the
     * first in line — SPEC.md §7.1 has it appear "once the admin taps start".
     * A started match stays at the front even if a bump would otherwise
     * reorder around it, because people are stood at the table playing it.
     */
    const playing = ordered.find((match) => match.status === 'IN_PROGRESS') ?? null;
    const rest = ordered.filter((match) => match.id !== playing?.id);

    queues.push({
      station,
      unassigned: station === UNASSIGNED_STATION,
      nowPlaying: playing,
      onDeck: rest[0] ?? null,
      inTheHole: rest[1] ?? null,
      waiting: rest.slice(2),
    });
  }

  // Stations alphabetical, with the unassigned bucket last so it never pushes a
  // real station off the top of the screen.
  return queues.sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
    return a.station.localeCompare(b.station);
  });
}

// ---------------------------------------------------------------------------
// "You're up" — SPEC.md §7.2
// ---------------------------------------------------------------------------

export type YoureUp = {
  match: QueueMatch;
  slot: QueueSlotName;
  station: string;
};

function teamsIn(match: QueueMatch): string[] {
  return match.sides
    .map((side) => side.teamId)
    .filter((teamId): teamId is string => teamId !== null);
}

/**
 * Every place the team is now playing or on deck. SPEC.md §7.2 wants a banner
 * with the station name; a team with two entries can genuinely be up at two
 * stations at once, so this returns a list rather than one hit.
 *
 * In the hole is deliberately excluded — the banner is for "go now", and firing
 * it three matches out would train people to ignore it.
 */
export function findYoureUp(queues: StationQueue[], teamId: string | null): YoureUp[] {
  if (!teamId) return [];

  const hits: YoureUp[] = [];

  for (const queue of queues) {
    for (const [slot, match] of [
      ['NOW_PLAYING', queue.nowPlaying],
      ['ON_DECK', queue.onDeck],
    ] as const) {
      if (match && teamsIn(match).includes(teamId)) {
        hits.push({ match, slot, station: queue.station });
      }
    }
  }

  return hits;
}

/**
 * The team's upcoming matches, across every game and day. SPEC.md §7.2.
 *
 * Only queueable matches: a PENDING bracket match has empty slots, so nobody
 * knows yet whether this team is in it.
 */
export function findMyMatches(matches: QueueMatch[], teamId: string | null): QueueMatch[] {
  if (!teamId) return [];
  return matches
    .filter((match) => isQueueable(match) && teamsIn(match).includes(teamId))
    .sort(compareQueueOrder);
}

/**
 * The queue_position to give a match so it jumps the queue at its station.
 *
 * One below the lowest in use, so a later bump goes in front of an earlier one
 * rather than tying with it.
 */
export function bumpPositionFor(stationMatches: QueueMatch[]): number {
  const positions = stationMatches
    .map((match) => match.queuePosition)
    .filter((position): position is number => position !== null);

  if (positions.length === 0) return -1;
  return Math.min(...positions) - 1;
}

/**
 * Whether a match may be started right now.
 *
 * Only the match on deck can be started, and only when nothing is already under
 * way at that station. SPEC.md §7.1 has NOW_PLAYING as "the first match at each
 * station" — without this, tapping start on something three deep would promote
 * it past other teams' games, which is exactly what the admin-only bump exists
 * to control. A station is also one physical table, so two matches cannot be
 * under way at once.
 *
 * To play something out of order: bump it, then start it. That path is audited.
 */
export function startableMatchIds(queues: StationQueue[]): string[] {
  const ids: string[] = [];

  for (const queue of queues) {
    if (queue.nowPlaying) continue; // that table is busy
    if (queue.onDeck) ids.push(queue.onDeck.id);
  }

  return ids;
}

/** Why a start was refused, or null when it is allowed. */
export function explainStartRefusal(
  queues: StationQueue[],
  matchId: string,
): string | null {
  const queue = queues.find(
    (candidate) =>
      candidate.nowPlaying?.id === matchId ||
      candidate.onDeck?.id === matchId ||
      candidate.inTheHole?.id === matchId ||
      candidate.waiting.some((match) => match.id === matchId),
  );

  if (!queue) return 'That match is not in the queue.';
  if (queue.nowPlaying?.id === matchId) return 'That match is already under way.';
  if (queue.nowPlaying) {
    return `${queue.nowPlaying.sides.map((side) => side.label ?? 'TBC').join(' v ')} is still on at ${queue.station}.`;
  }
  if (queue.onDeck?.id === matchId) return null;

  return `That match is not next at ${queue.station}. Bump it first if it needs to jump the queue.`;
}
