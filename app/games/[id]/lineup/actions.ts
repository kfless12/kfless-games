'use server';

import { and, eq, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { canActForTeam, identify } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { entries, games, players } from '@/lib/db/schema';
import { isUuid } from '@/lib/uuid';

import type { LineupState } from './state';

function fail(error: string): LineupState {
  return { error, notice: null };
}

/**
 * Assigns players to one entry. SPEC.md §4.4: "Captains may optionally assign
 * which of their players fill each entry. Not required."
 *
 * Optional is load-bearing. Clearing an entry is allowed, an entry may be
 * partly filled, and nothing downstream requires an assignment — SPEC.md §8
 * keeps captains able to report either way, and lib/queue.ts falls back to
 * pinging the whole team. So this can never wedge a game.
 *
 * SPEC.md §12 rejects bench/rotation logic and that still holds: this records
 * who is in an entry, and nothing enforces that they are the ones who played.
 * The 5th player still subs in freely and nobody audits it.
 */
export async function saveLineup(
  _previous: LineupState,
  formData: FormData,
): Promise<LineupState> {
  const identity = await identify();
  if (!identity) return fail('Sign in first.');

  const entryId = String(formData.get('entryId') ?? '');
  if (!isUuid(entryId)) return fail('Missing entry.');

  const chosen = formData
    .getAll('playerId')
    .map((value) => String(value))
    .filter((value) => value !== '');

  if (chosen.some((playerId) => !isUuid(playerId))) return fail('Bad player id.');
  if (new Set(chosen).size !== chosen.length) {
    return fail('That lists the same player twice.');
  }

  const db = getDb();

  const [entry] = await db.select().from(entries).where(eq(entries.id, entryId)).limit(1);
  if (!entry) return fail('That entry no longer exists.');

  /*
   * Server-side authorization — CLAUDE.md invariant 6. The form only ever
   * renders a captain their own team's entries, but the entry id comes from the
   * request, so the check has to happen here.
   */
  if (!canActForTeam(identity, entry.teamId)) {
    return fail('Only that team’s captain or the admin can set its lineup.');
  }

  const [game] = await db.select().from(games).where(eq(games.id, entry.gameId)).limit(1);
  if (!game) return fail('That game no longer exists.');
  if (game.status === 'COMPLETE') {
    return fail('That game is finished. Its lineup is history now.');
  }

  if (game.entrySize !== null && chosen.length > game.entrySize) {
    return fail(
      `${entry.label} holds ${game.entrySize} player${game.entrySize === 1 ? '' : 's'}.`,
    );
  }

  // Everyone named must actually be on the team that owns the entry.
  if (chosen.length > 0) {
    const roster = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.teamId, entry.teamId));
    const onTeam = new Set(roster.map((row) => row.id));
    if (chosen.some((playerId) => !onTeam.has(playerId))) {
      return fail('That player is not on this team.');
    }
  }

  /*
   * Nobody may hold two entries in the same game — in beer pong that would mean
   * playing themselves, and the bracket would eventually pair the two entries.
   * Checked against the other entries of this game only; the same person in two
   * different games is normal.
   */
  if (chosen.length > 0) {
    const siblings = await db
      .select({ label: entries.label, playerIds: entries.playerIds })
      .from(entries)
      .where(and(eq(entries.gameId, entry.gameId), ne(entries.id, entryId)));

    for (const sibling of siblings) {
      const clash = chosen.find((playerId) => (sibling.playerIds ?? []).includes(playerId));
      if (clash) {
        return fail(`Someone there is already in ${sibling.label}. Take them out first.`);
      }
    }
  }

  await db
    .update(entries)
    .set({ playerIds: chosen })
    .where(eq(entries.id, entryId));

  await recordAudit({
    actor: identity,
    action: 'entry.lineup',
    targetType: 'entry',
    targetId: entryId,
    before: { playerIds: entry.playerIds ?? [] },
    after: { playerIds: chosen },
  });

  revalidatePath(`/games/${entry.gameId}/lineup`);
  revalidatePath(`/games/${entry.gameId}`);
  revalidatePath('/queue');
  revalidatePath('/');

  return {
    error: null,
    notice: chosen.length === 0 ? `${entry.label} cleared.` : `${entry.label} saved.`,
  };
}
