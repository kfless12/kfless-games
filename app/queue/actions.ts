'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { identify, isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { matches } from '@/lib/db/schema';
import { authorizeSubmission } from '@/lib/engine/submit';
import { loadQueueMatches, teamsInMatch } from '@/lib/queue-db';
import {
  bumpPositionFor,
  buildStationQueues,
  explainStartRefusal,
  stationNameOf,
} from '@/lib/queue';
import { isUuid } from '@/lib/uuid';

import type { QueueActionState } from './state';

/*
 * Queue controls. SPEC.md §7.1.
 *
 * "Start" is what turns the first match at a station into NOW_PLAYING. §7.1
 * names the admin; a captain playing in the match may also start it, for the
 * same reason §8 lets them report the result — one person doing it for three
 * days is a single point of failure, and that person wants to be drinking.
 * Bumping the queue stays admin-only, since it reorders other people's games.
 */

function fail(error: string): QueueActionState {
  return { error, notice: null };
}

function revalidate() {
  revalidatePath('/queue');
  revalidatePath('/');
  revalidatePath('/games');
}

async function startMatch(formData: FormData): Promise<QueueActionState> {
  const identity = await identify();

  const matchId = String(formData.get('matchId') ?? '');
  if (!isUuid(matchId)) return fail('Missing match.');

  const involved = await teamsInMatch(matchId);
  const authorization = authorizeSubmission({
    identity,
    teamIdsInMatch: involved,
    captainTeamId: identity?.teamId ?? null,
  });
  if (!authorization.allowed) {
    return fail(authorization.reason ?? 'Only the admin or a captain in this match can start it.');
  }

  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) return fail('That match no longer exists.');
  if (match.status !== 'READY') {
    return fail(
      match.status === 'IN_PROGRESS' ? 'That match is already under way.' : 'That match is not ready.',
    );
  }

  /*
   * Only the match on deck can be started, and only when its station is free.
   * SPEC.md §7.1 has NOW_PLAYING as "the first match at each station" — without
   * this, tapping start on something further back would promote it past other
   * teams' games. Bump it first if it genuinely needs to jump.
   */
  const refusal = explainStartRefusal(buildStationQueues(await loadQueueMatches()), matchId);
  if (refusal) return fail(refusal);

  await db.update(matches).set({ status: 'IN_PROGRESS' }).where(eq(matches.id, matchId));

  await recordAudit({
    actor: identity,
    action: 'queue.start',
    targetType: 'match',
    targetId: matchId,
    after: { station: match.station },
  });

  revalidate();
  return { error: null, notice: 'Started.' };
}

/** Puts a started match back in the queue, e.g. it was started by mistake. */
async function unstartMatch(formData: FormData): Promise<QueueActionState> {
  const identity = await identify();

  const matchId = String(formData.get('matchId') ?? '');
  if (!isUuid(matchId)) return fail('Missing match.');

  const involved = await teamsInMatch(matchId);
  const authorization = authorizeSubmission({
    identity,
    teamIdsInMatch: involved,
    captainTeamId: identity?.teamId ?? null,
  });
  if (!authorization.allowed) return fail(authorization.reason ?? 'Not allowed.');

  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) return fail('That match no longer exists.');
  if (match.status !== 'IN_PROGRESS') return fail('That match is not under way.');

  await db.update(matches).set({ status: 'READY' }).where(eq(matches.id, matchId));

  await recordAudit({
    actor: identity,
    action: 'queue.unstart',
    targetType: 'match',
    targetId: matchId,
  });

  revalidate();
  return { error: null, notice: 'Put back in the queue.' };
}

/** SPEC.md §7.1: the admin's manual override to bump a match to the front. */
async function bumpMatch(formData: FormData): Promise<QueueActionState> {
  const identity = await identify();
  if (!isAdmin(identity)) return fail('Admin only.');

  const matchId = String(formData.get('matchId') ?? '');
  if (!isUuid(matchId)) return fail('Missing match.');

  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) return fail('That match no longer exists.');

  // Position is relative to the other matches at the same station.
  const all = await loadQueueMatches();
  const target = all.find((candidate) => candidate.id === matchId);
  const station = target ? stationNameOf(target) : null;
  const atStation = station
    ? all.filter((candidate) => stationNameOf(candidate) === station)
    : [];

  const position = bumpPositionFor(atStation);
  await db.update(matches).set({ queuePosition: position }).where(eq(matches.id, matchId));

  await recordAudit({
    actor: identity,
    action: 'queue.bump',
    targetType: 'match',
    targetId: matchId,
    after: { queuePosition: position, station },
  });

  revalidate();
  return { error: null, notice: 'Bumped to the front of its station.' };
}

/** Clears every manual override at a station, returning it to derived order. */
async function clearBumps(formData: FormData): Promise<QueueActionState> {
  const identity = await identify();
  if (!isAdmin(identity)) return fail('Admin only.');

  const station = String(formData.get('station') ?? '');
  const all = await loadQueueMatches();
  const ids = all
    .filter((match) => stationNameOf(match) === station && match.queuePosition !== null)
    .map((match) => match.id);

  if (ids.length === 0) return fail('Nothing is bumped at that station.');

  await getDb()
    .update(matches)
    .set({ queuePosition: null })
    .where(and(inArray(matches.id, ids)));

  await recordAudit({
    actor: identity,
    action: 'queue.clear_bumps',
    targetType: 'station',
    targetId: station,
    after: { cleared: ids.length },
  });

  revalidate();
  return { error: null, notice: 'Back to the derived order.' };
}

/**
 * One action for every queue control, dispatched by an `op` field.
 *
 * One action means one piece of state and therefore one message. With four
 * separate useActionState hooks the stale notice from whichever ran first kept
 * winning, so clearing a bump still said "bumped to the front".
 */
export async function queueAction(
  _previous: QueueActionState,
  formData: FormData,
): Promise<QueueActionState> {
  const op = String(formData.get('op') ?? '');

  switch (op) {
    case 'start':
      return startMatch(formData);
    case 'unstart':
      return unstartMatch(formData);
    case 'bump':
      return bumpMatch(formData);
    case 'clear-bumps':
      return clearBumps(formData);
    default:
      return fail('Unknown queue action.');
  }
}
