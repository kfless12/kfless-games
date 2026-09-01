'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { identify, isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { gameResults, games, matches } from '@/lib/db/schema';
import { scheduleGame, unscheduleGame } from '@/lib/engine/persist';
import { parseGameForm } from '@/lib/games';
import { isUuid } from '@/lib/uuid';

import type { GameActionState } from './state';

/*
 * Game management. SPEC.md §4.3: the admin can create, edit, reorder, and
 * delete games at any time, and deleting a game with recorded results needs a
 * confirmation and is logged.
 */

async function requireAdmin() {
  const identity = await identify();
  return isAdmin(identity) ? identity : null;
}

function fail(error: string): GameActionState {
  return { error, notice: null };
}

function revalidate() {
  revalidatePath('/admin/games');
  revalidatePath('/admin');
}

export async function createGame(
  _previous: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const actor = await requireAdmin();
  if (!actor) return fail('Admin only.');

  const parsed = parseGameForm(formData);
  if (!parsed.ok) return fail(parsed.errors.join(' '));

  const [created] = await getDb()
    .insert(games)
    .values({ ...parsed.game, status: 'DRAFT' })
    .returning({ id: games.id, name: games.name });

  await recordAudit({
    actor,
    action: 'game.create',
    targetType: 'game',
    targetId: created.id,
    after: { ...parsed.game },
  });

  revalidate();
  return { error: null, notice: `Added ${created.name}. Schedule it to build the bracket.` };
}

export async function updateGame(
  _previous: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const actor = await requireAdmin();
  if (!actor) return fail('Admin only.');

  const gameId = String(formData.get('gameId') ?? '');
  if (!isUuid(gameId)) return fail('Missing game.');

  const parsed = parseGameForm(formData);
  if (!parsed.ok) return fail(parsed.errors.join(' '));

  const db = getDb();
  const [before] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!before) return fail('That game no longer exists.');

  await db
    .update(games)
    .set({ ...parsed.game, updatedAt: new Date() })
    .where(eq(games.id, gameId));

  await recordAudit({
    actor,
    action: 'game.update',
    targetType: 'game',
    targetId: gameId,
    before: {
      name: before.name,
      format: before.format,
      entriesPerTeam: before.entriesPerTeam,
      pointsMatrix: before.pointsMatrix,
    },
    after: { ...parsed.game },
  });

  // Changing the format or entry count invalidates a generated bracket.
  const shapeChanged =
    before.format !== parsed.game.format ||
    before.entriesPerTeam !== parsed.game.entriesPerTeam;

  /*
   * Changing what a game pays invalidates its scores. The leaderboard sums
   * game_results.points_awarded (SPEC.md §4.7) rather than recomputing, so the
   * results are dropped and the game reopened — the same rule as editing a
   * match result (§8). That makes a stale total impossible.
   */
  const scoringChanged =
    JSON.stringify(before.pointsMatrix) !== JSON.stringify(parsed.game.pointsMatrix) ||
    before.pointsPerWin !== parsed.game.pointsPerWin;

  let rescoreNeeded = false;
  if (scoringChanged && before.status === 'COMPLETE') {
    await db.delete(gameResults).where(eq(gameResults.gameId, gameId));
    await db
      .update(games)
      .set({ status: 'ACTIVE', updatedAt: new Date() })
      .where(eq(games.id, gameId));
    rescoreNeeded = true;
  }

  revalidate();
  revalidatePath('/games');
  revalidatePath(`/games/${gameId}`);

  if (shapeChanged && before.status !== 'DRAFT') {
    return {
      error: null,
      notice: 'Saved. The shape changed, so re-schedule the game to rebuild the bracket.',
    };
  }
  if (rescoreNeeded) {
    return {
      error: null,
      notice: 'Saved. The points changed, so the old scores were dropped — mark it complete again to rescore.',
    };
  }

  return { error: null, notice: 'Saved.' };
}

/** SPEC.md §4.4: entries and the whole match graph are built here. */
export async function scheduleGameAction(
  _previous: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const actor = await requireAdmin();
  if (!actor) return fail('Admin only.');

  const gameId = String(formData.get('gameId') ?? '');
  if (!isUuid(gameId)) return fail('Missing game.');

  const outcome = await scheduleGame(gameId);
  if (!outcome.ok) return fail(outcome.error);

  await recordAudit({
    actor,
    action: 'game.schedule',
    targetType: 'game',
    targetId: gameId,
    after: { entries: outcome.entryCount, matches: outcome.matchCount },
  });

  revalidate();

  const warning = outcome.warnings.length > 0 ? ` ${outcome.warnings.join(' ')}` : '';
  return {
    error: null,
    notice: `Built ${outcome.matchCount} matches for ${outcome.entryCount} entries.${warning}`,
  };
}

export async function unscheduleGameAction(
  _previous: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const actor = await requireAdmin();
  if (!actor) return fail('Admin only.');

  const gameId = String(formData.get('gameId') ?? '');
  if (!isUuid(gameId)) return fail('Missing game.');

  const outcome = await unscheduleGame(gameId);
  if (!outcome.ok) return fail(outcome.error);

  await recordAudit({
    actor,
    action: 'game.unschedule',
    targetType: 'game',
    targetId: gameId,
  });

  revalidate();
  return { error: null, notice: 'Cleared the bracket. The game is back to draft.' };
}

/**
 * SPEC.md §4.3: deleting a game with recorded results requires a confirmation
 * and is logged. The confirmation is typing the game's name, because a
 * mis-tapped delete during the event would take real results with it.
 */
export async function deleteGame(
  _previous: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const actor = await requireAdmin();
  if (!actor) return fail('Admin only.');

  const gameId = String(formData.get('gameId') ?? '');
  if (!isUuid(gameId)) return fail('Missing game.');

  const db = getDb();
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) return fail('That game no longer exists.');

  const [counts] = await db
    .select({
      played: sql<number>`count(*) filter (where ${matches.status} = 'COMPLETE')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(matches)
    .where(eq(matches.gameId, gameId));

  if (counts.played > 0) {
    const typed = String(formData.get('confirmName') ?? '').trim();
    if (typed !== game.name) {
      return fail(
        `${game.name} has ${counts.played} recorded result(s). Type the game's name exactly to confirm.`,
      );
    }
  }

  await recordAudit({
    actor,
    action: 'game.delete',
    targetType: 'game',
    targetId: gameId,
    before: {
      name: game.name,
      format: game.format,
      status: game.status,
      matchesDeleted: counts.total,
      resultsDeleted: counts.played,
    },
  });

  await db.delete(games).where(eq(games.id, gameId));

  revalidate();
  return { error: null, notice: `Deleted ${game.name}.` };
}
