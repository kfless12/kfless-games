'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { identify, isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { games, standingsOverrides } from '@/lib/db/schema';
import {
  completeGame,
  reportFfaResult,
  reportMatchResult,
  undoMatch,
} from '@/lib/engine/submit';
import { isUuid } from '@/lib/uuid';

import type { ResultState } from './state';

/*
 * Result submission, editing and undo. SPEC.md §8.
 *
 * Authorization lives in lib/engine/submit.ts and is re-checked there on every
 * call; these are thin wrappers that also write the audit row, because §8
 * requires every submission to record its submitter.
 */

function fail(error: string): ResultState {
  return { error, notice: null };
}

function revalidate(gameId?: string) {
  revalidatePath('/games');
  revalidatePath('/');
  if (gameId) revalidatePath(`/games/${gameId}`);
}

function parseScores(formData: FormData): Record<string, number> | undefined {
  const scores: Record<string, number> = {};
  let any = false;

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('score-')) continue;
    const entryId = key.slice('score-'.length);
    const raw = String(value).trim();
    if (raw === '') continue;
    if (!/^\d+$/.test(raw)) continue;
    scores[entryId] = Number(raw);
    any = true;
  }

  return any ? scores : undefined;
}

export async function submitResult(
  _previous: ResultState,
  formData: FormData,
): Promise<ResultState> {
  const identity = await identify();

  const matchId = String(formData.get('matchId') ?? '');
  if (!isUuid(matchId)) return fail('Missing match.');

  const winnerEntryId = String(formData.get('winnerEntryId') ?? '');
  const outcome = await reportMatchResult(identity, {
    matchId,
    winnerEntryId: isUuid(winnerEntryId) ? winnerEntryId : undefined,
    scores: parseScores(formData),
  });

  if (!outcome.ok) return fail(outcome.error);

  await recordAudit({
    actor: identity,
    action: outcome.wasEdit ? 'result.edit' : 'result.submit',
    targetType: 'match',
    targetId: matchId,
    after: { winnerEntryId: winnerEntryId || null, scores: parseScores(formData) ?? null },
  });

  revalidate(outcome.gameId);
  return { error: null, notice: outcome.notice };
}

export async function undoResult(
  _previous: ResultState,
  formData: FormData,
): Promise<ResultState> {
  const identity = await identify();

  const matchId = String(formData.get('matchId') ?? '');
  if (!isUuid(matchId)) return fail('Missing match.');

  const outcome = await undoMatch(identity, matchId);
  if (!outcome.ok) return fail(outcome.error);

  await recordAudit({
    actor: identity,
    action: 'result.undo',
    targetType: 'match',
    targetId: matchId,
    after: { clearedMatches: outcome.cleared ?? 1 },
  });

  revalidate(outcome.gameId);
  return { error: null, notice: outcome.notice };
}

export async function submitFfaResult(
  _previous: ResultState,
  formData: FormData,
): Promise<ResultState> {
  const identity = await identify();

  const matchId = String(formData.get('matchId') ?? '');
  if (!isUuid(matchId)) return fail('Missing heat.');

  const placements: { entryId: string; placement: number; rawScore?: number | null }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('placement-')) continue;
    const entryId = key.slice('placement-'.length);
    const raw = String(value).trim();
    if (!/^\d+$/.test(raw)) return fail('Every entry needs a placement.');

    const rawScore = String(formData.get(`raw-${entryId}`) ?? '').trim();
    placements.push({
      entryId,
      placement: Number(raw),
      rawScore: /^\d+$/.test(rawScore) ? Number(rawScore) : null,
    });
  }

  const outcome = await reportFfaResult(identity, { matchId, placements });
  if (!outcome.ok) return fail(outcome.error);

  await recordAudit({
    actor: identity,
    action: 'result.submit_ffa',
    targetType: 'match',
    targetId: matchId,
    after: { placements },
  });

  revalidate(outcome.gameId);
  return { error: null, notice: outcome.notice };
}

/** SPEC.md §6.5: marking a game complete is what writes game_results. */
export async function markGameComplete(
  _previous: ResultState,
  formData: FormData,
): Promise<ResultState> {
  const identity = await identify();

  const gameId = String(formData.get('gameId') ?? '');
  if (!isUuid(gameId)) return fail('Missing game.');

  const coinFlip = String(formData.get('coinFlipOrder') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => isUuid(part));

  const outcome = await completeGame(identity, gameId, coinFlip);
  if (!outcome.ok) return fail(outcome.error);

  await recordAudit({
    actor: identity,
    action: 'game.complete',
    targetType: 'game',
    targetId: gameId,
    after: { placements: outcome.resultCount, coinFlipUsed: coinFlip.length > 0 },
  });

  revalidate(gameId);
  return { error: null, notice: outcome.notice };
}

/** Reopens a completed game so results can be edited. */
export async function reopenGame(
  _previous: ResultState,
  formData: FormData,
): Promise<ResultState> {
  const identity = await identify();
  if (!isAdmin(identity)) return fail('Admin only.');

  const gameId = String(formData.get('gameId') ?? '');
  if (!isUuid(gameId)) return fail('Missing game.');

  await getDb()
    .update(games)
    .set({ status: 'ACTIVE', updatedAt: new Date() })
    .where(eq(games.id, gameId));

  await recordAudit({ actor: identity, action: 'game.reopen', targetType: 'game', targetId: gameId });

  revalidate(gameId);
  return { error: null, notice: 'Reopened. Re-mark it complete to rescore.' };
}

/**
 * SPEC.md §6.5 tie-breaker 5. The reason is required, so a blank one is
 * rejected rather than stored.
 */
export async function setStandingsOverride(
  _previous: ResultState,
  formData: FormData,
): Promise<ResultState> {
  const identity = await identify();
  if (!isAdmin(identity)) return fail('Admin only.');

  const teamId = String(formData.get('teamId') ?? '');
  if (!isUuid(teamId)) return fail('Missing team.');

  const reason = String(formData.get('reason') ?? '').trim();
  const clearing = formData.get('clear') === 'true';

  const db = getDb();

  if (clearing) {
    await db.delete(standingsOverrides).where(eq(standingsOverrides.teamId, teamId));
    await recordAudit({
      actor: identity,
      action: 'standings.override_clear',
      targetType: 'team',
      targetId: teamId,
    });
    revalidate();
    return { error: null, notice: 'Override removed.' };
  }

  if (reason === '') return fail('A tie-break override needs a reason.');

  const priorityRaw = String(formData.get('priority') ?? '0').trim();
  const priority = /^-?\d+$/.test(priorityRaw) ? Number(priorityRaw) : 0;

  await db
    .insert(standingsOverrides)
    .values({ teamId, priority, reason, createdBy: identity!.personId })
    .onConflictDoUpdate({
      target: standingsOverrides.teamId,
      set: { priority, reason, createdBy: identity!.personId, createdAt: new Date() },
    });

  await recordAudit({
    actor: identity,
    action: 'standings.override_set',
    targetType: 'team',
    targetId: teamId,
    after: { priority, reason },
  });

  revalidate();
  return { error: null, notice: 'Override saved.' };
}
