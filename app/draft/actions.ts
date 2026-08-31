'use server';

import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { identify, isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { eventState, players, teams } from '@/lib/db/schema';
import { authorizePick, currentSlot, totalPicksFor } from '@/lib/draft';
import { isUuid } from '@/lib/uuid';

import type { DraftActionState } from './state';

/*
 * Draft mutations. SPEC.md §5.2 makes server-side enforcement mandatory:
 * "reject any pick where the submitting person is not the current picker, or
 * where the player is already drafted. Do not rely on the UI to prevent this."
 *
 * Every mutation runs inside a transaction that first takes a row lock on
 * event_state. That serialises the whole draft: two captains tapping DRAFT at
 * the same instant cannot both read the same pick number and both write.
 */

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** Locks the draft so only one mutation can be in flight at a time. */
async function lockDraft(tx: Tx) {
  await tx.execute(sql`select 1 from ${eventState} where ${eventState.id} = 1 for update`);

  const [state] = await tx.select().from(eventState).where(eq(eventState.id, 1)).limit(1);
  return state;
}

async function rosterShape(tx: Tx) {
  const [counts] = await tx
    .select({
      playerCount: sql<number>`count(*)::int`,
      captainCount: sql<number>`count(*) filter (where ${players.isCaptain})::int`,
      picksMade: sql<number>`count(*) filter (where ${players.draftPickNumber} is not null)::int`,
    })
    .from(players);

  const [teamCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(teams);

  return {
    totalPicks: totalPicksFor(counts.playerCount, counts.captainCount),
    picksMade: counts.picksMade,
    teamCount: teamCount.count,
  };
}

// ---------------------------------------------------------------------------
// Making a pick
// ---------------------------------------------------------------------------

export async function makePick(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const identity = await identify();
  if (!identity) return fail('Sign in first.');

  const playerId = String(formData.get('playerId') ?? '');
  if (!isUuid(playerId)) return fail('Pick a player.');

  const db = getDb();

  const outcome = await db.transaction(async (tx) => {
    const state = await lockDraft(tx);

    const shape = await rosterShape(tx);
    const slot = state?.draftStatus === 'LIVE'
      ? currentSlot(shape.picksMade, shape.totalPicks, shape.teamCount)
      : null;

    const [onTheClock] = slot
      ? await tx
          .select({ id: teams.id, name: teams.name, captainId: teams.captainId })
          .from(teams)
          .where(eq(teams.draftPosition, slot.draftPosition))
          .limit(1)
      : [];

    // THE check, decided by lib/draft.ts so it is unit tested rather than only
    // reachable through a request.
    const verdict = authorizePick({
      status: (state?.draftStatus ?? 'NOT_STARTED') as 'NOT_STARTED' | 'LIVE' | 'COMPLETE',
      paused: state?.draftPaused ?? false,
      submitterId: identity.personId,
      submitterIsAdmin: isAdmin(identity),
      onTheClockCaptainId: onTheClock?.captainId ?? null,
      onTheClockTeamName: onTheClock?.name ?? null,
    });

    if (!verdict.allowed) return fail(verdict.reason);
    if (!slot || !onTheClock) return fail('Every pick is already in.');

    // Claim the player only if they are still genuinely available. Doing it as
    // a conditional UPDATE means the database decides, not a prior read.
    const claimed = await tx
      .update(players)
      .set({
        draftPickNumber: slot.pickNumber,
        teamId: onTheClock.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(players.id, playerId),
          eq(players.isCaptain, false),
          isNull(players.draftPickNumber),
        ),
      )
      .returning({ id: players.id, fullName: players.fullName });

    if (claimed.length === 0) {
      return fail('That player is already drafted.');
    }

    const nowComplete = slot.pickNumber >= shape.totalPicks;
    if (nowComplete) {
      // is_mister_irrelevant is a generated column, so pick 13's label is
      // already set by the UPDATE above. Nothing to write for it.
      await tx
        .update(eventState)
        .set({ draftStatus: 'COMPLETE', updatedAt: new Date() })
        .where(eq(eventState.id, 1));
    }

    return {
      ok: true as const,
      player: claimed[0],
      team: onTheClock,
      slot,
      nowComplete,
      onBehalf: verdict.onBehalf,
    };
  });

  if ('error' in outcome) return outcome;

  await recordAudit({
    actor: identity,
    action: outcome.onBehalf ? 'draft.pick_on_behalf' : 'draft.pick',
    targetType: 'player',
    targetId: outcome.player.id,
    after: {
      pickNumber: outcome.slot.pickNumber,
      round: outcome.slot.round,
      teamId: outcome.team.id,
      teamName: outcome.team.name,
      playerName: outcome.player.fullName,
    },
  });

  if (outcome.nowComplete) {
    await recordAudit({ actor: identity, action: 'draft.complete', targetType: 'event' });
  }

  revalidateDraft();
  return {
    error: null,
    notice: `${outcome.team.name} take ${outcome.player.fullName} at ${outcome.slot.pickNumber}.`,
  };
}

// ---------------------------------------------------------------------------
// Undo — SPEC.md §5.4
// ---------------------------------------------------------------------------

export async function undoLastPick(
  _previous: DraftActionState,
  _formData: FormData,
): Promise<DraftActionState> {
  const identity = await identify();
  if (!isAdmin(identity)) return fail('Admin only.');

  const db = getDb();

  const outcome = await db.transaction(async (tx) => {
    const state = await lockDraft(tx);
    if (!state) return fail('No draft state.');

    const [last] = await tx
      .select({
        id: players.id,
        fullName: players.fullName,
        draftPickNumber: players.draftPickNumber,
        teamId: players.teamId,
      })
      .from(players)
      .where(isNotNull(players.draftPickNumber))
      .orderBy(desc(players.draftPickNumber))
      .limit(1);

    if (!last) return fail('There are no picks to undo.');

    // Clearing draft_pick_number also clears is_mister_irrelevant, because that
    // column is generated from it. That is the whole point of SPEC.md §4.1.
    await tx
      .update(players)
      .set({ draftPickNumber: null, teamId: null, updatedAt: new Date() })
      .where(eq(players.id, last.id));

    // A completed draft reopens: the last pick no longer exists.
    const reopened = state.draftStatus === 'COMPLETE';
    if (reopened) {
      await tx
        .update(eventState)
        .set({ draftStatus: 'LIVE', updatedAt: new Date() })
        .where(eq(eventState.id, 1));
    }

    return { ok: true as const, last, reopened };
  });

  if ('error' in outcome) return outcome;

  await recordAudit({
    actor: identity,
    action: 'draft.undo_pick',
    targetType: 'player',
    targetId: outcome.last.id,
    before: {
      pickNumber: outcome.last.draftPickNumber,
      teamId: outcome.last.teamId,
      playerName: outcome.last.fullName,
    },
    after: { pickNumber: null, teamId: null, reopenedDraft: outcome.reopened },
  });

  revalidateDraft();
  return {
    error: null,
    notice: `Undid pick ${outcome.last.draftPickNumber} — ${outcome.last.fullName} is back in the pool.`,
  };
}

// ---------------------------------------------------------------------------
// Status and pause — SPEC.md §5.1, §5.4
// ---------------------------------------------------------------------------

export async function setDraftStatus(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const identity = await identify();
  if (!isAdmin(identity)) return fail('Admin only.');

  const requested = String(formData.get('status') ?? '');
  if (requested !== 'NOT_STARTED' && requested !== 'LIVE' && requested !== 'COMPLETE') {
    return fail('Unknown status.');
  }

  const db = getDb();
  const outcome = await db.transaction(async (tx) => {
    const state = await lockDraft(tx);
    if (!state) return fail('No draft state.');

    const shape = await rosterShape(tx);

    // Only guard the transitions that would corrupt the roster. Everything else
    // is the admin's call.
    if (requested === 'NOT_STARTED' && shape.picksMade > 0) {
      return fail('Undo the picks first — there are picks on the board.');
    }
    if (requested === 'COMPLETE' && shape.picksMade < shape.totalPicks) {
      return fail(
        `Only ${shape.picksMade} of ${shape.totalPicks} picks are in. The draft completes itself on the last pick.`,
      );
    }

    await tx
      .update(eventState)
      .set({ draftStatus: requested, draftPaused: false, updatedAt: new Date() })
      .where(eq(eventState.id, 1));

    return { ok: true as const, from: state.draftStatus, to: requested };
  });

  if ('error' in outcome) return outcome;

  await recordAudit({
    actor: identity,
    action: 'draft.set_status',
    targetType: 'event',
    before: { draftStatus: outcome.from },
    after: { draftStatus: outcome.to },
  });

  revalidateDraft();
  return { error: null, notice: `Draft is now ${outcome.to.toLowerCase().replace('_', ' ')}.` };
}

export async function setDraftPaused(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const identity = await identify();
  if (!isAdmin(identity)) return fail('Admin only.');

  const paused = String(formData.get('paused') ?? '') === 'true';

  await getDb()
    .update(eventState)
    .set({ draftPaused: paused, updatedAt: new Date() })
    .where(eq(eventState.id, 1));

  await recordAudit({
    actor: identity,
    action: paused ? 'draft.pause' : 'draft.resume',
    targetType: 'event',
  });

  revalidateDraft();
  return { error: null, notice: paused ? 'Draft paused.' : 'Draft resumed.' };
}

// ---------------------------------------------------------------------------

function fail(error: string): DraftActionState {
  return { error, notice: null };
}

function revalidateDraft() {
  revalidatePath('/draft');
  revalidatePath('/');
}
