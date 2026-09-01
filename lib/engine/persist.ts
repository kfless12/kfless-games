import { and, asc, eq, inArray } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { entries, games, matchParticipants, matches, teams } from '@/lib/db/schema';

import { generateBracket, type BracketKind, type GeneratedMatch } from './bracket';
import { generateFfaHeat } from './ffa';
import { generateRoundRobin } from './round-robin';
import type { SeedableEntry } from './seeding';

/*
 * Writes a generated tournament into Postgres. SPEC.md §4.4: entries are
 * generated when the admin sets a game to SCHEDULED.
 *
 * The generators stay pure; this module is the only place that knows about
 * tables. It maps each generated match's stable key to a uuid, then wires
 * winner_to_match_id / loser_to_match_id from the same map, so the whole graph
 * exists before any result is reported (SPEC.md §6.1).
 */

export type ScheduleOutcome =
  | { ok: true; entryCount: number; matchCount: number; warnings: string[] }
  | { ok: false; error: string };

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const KIND_BY_FORMAT: Record<string, BracketKind | null> = {
  DOUBLE_ELIM: 'DOUBLE',
  SINGLE_ELIM: 'SINGLE',
  ROUND_ROBIN: null,
  RANKED_FFA: null,
};

/**
 * Builds every entry and match for a game, replacing anything already there.
 *
 * Refuses if any result has been recorded — regenerating would silently discard
 * played matches. The admin has to undo those first.
 */
export async function scheduleGame(gameId: string): Promise<ScheduleOutcome> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).limit(1);
    if (!game) return { ok: false as const, error: 'That game no longer exists.' };

    const existing = await tx
      .select({ id: matches.id, status: matches.status })
      .from(matches)
      .where(eq(matches.gameId, gameId));

    const played = existing.filter((match) => match.status === 'COMPLETE');
    if (played.length > 0) {
      return {
        ok: false as const,
        error: `${played.length} match(es) already have results. Undo them before regenerating.`,
      };
    }

    // Clear any previous skeleton. match_participants cascades from matches.
    if (existing.length > 0) {
      await tx.delete(matches).where(eq(matches.gameId, gameId));
    }
    await tx.delete(entries).where(eq(entries.gameId, gameId));

    const allTeams = await tx
      .select({ id: teams.id, name: teams.name, draftPosition: teams.draftPosition })
      .from(teams)
      .orderBy(asc(teams.draftPosition));

    if (allTeams.length === 0) {
      return { ok: false as const, error: 'There are no teams yet.' };
    }

    // SPEC.md §4.4: one entry per team per entries_per_team. Beer pong is 2.
    const perTeam = Math.max(1, game.entriesPerTeam);
    const entryRows = allTeams.flatMap((team) =>
      Array.from({ length: perTeam }, (_, index) => ({
        gameId,
        teamId: team.id,
        label: perTeam === 1 ? team.name : `${team.name} — ${String.fromCharCode(65 + index)}`,
      })),
    );

    const insertedEntries = await tx
      .insert(entries)
      .values(entryRows)
      .returning({ id: entries.id, teamId: entries.teamId, label: entries.label });

    const warnings: string[] = [];
    const kind = KIND_BY_FORMAT[game.format];

    let matchCount = 0;
    if (kind) {
      const result = await writeBracket(tx, gameId, insertedEntries, kind, game.station);
      matchCount = result.matchCount;
      warnings.push(...result.warnings);
    } else if (game.format === 'ROUND_ROBIN') {
      matchCount = await writeRoundRobin(tx, gameId, insertedEntries, game.station);
    } else {
      matchCount = await writeFfa(tx, gameId, insertedEntries, game.station);
    }

    await tx
      .update(games)
      .set({ status: 'SCHEDULED', updatedAt: new Date() })
      .where(eq(games.id, gameId));

    return {
      ok: true as const,
      entryCount: insertedEntries.length,
      matchCount,
      warnings,
    };
  });
}

type InsertedEntry = { id: string; teamId: string; label: string };

async function writeBracket(
  tx: Tx,
  gameId: string,
  inserted: InsertedEntry[],
  kind: BracketKind,
  station: string | null,
): Promise<{ matchCount: number; warnings: string[] }> {
  const seedable: SeedableEntry[] = inserted.map((entry) => ({
    id: entry.id,
    teamId: entry.teamId,
  }));

  const bracket = generateBracket(seedable, kind);
  const warnings: string[] = [];
  if (bracket.sameTeamRoundOneClash) {
    warnings.push(
      'Two entries from the same team meet in round 1 — the shape made separation impossible.',
    );
  }

  // Record the seeds so the bracket can be re-derived and rendered in order.
  for (const entry of inserted) {
    const seed = bracket.seedByEntry[entry.id];
    if (seed !== undefined) {
      await tx.update(entries).set({ seed }).where(eq(entries.id, entry.id));
    }
  }

  // Pass 1: insert every match and remember its uuid by generated key.
  const idByKey = new Map<string, string>();
  for (const match of bracket.matches) {
    const [row] = await tx
      .insert(matches)
      .values({
        gameId,
        round: match.round,
        bracket: match.bracket === 'GRAND_FINAL' ? 'GRAND_FINAL' : match.bracket,
        slot: match.slot,
        station,
        status: statusFor(match),
        completedAt: match.autoCompleted ? new Date() : null,
      })
      .returning({ id: matches.id });
    idByKey.set(match.key, row.id);
  }

  // Pass 2: wire the pointers, now that every match has an id.
  for (const match of bracket.matches) {
    const id = idByKey.get(match.key)!;
    await tx
      .update(matches)
      .set({
        winnerToMatchId: resolve(idByKey, match.winnerTo.matchKey),
        winnerToSlot: match.winnerTo.slot,
        loserToMatchId: resolve(idByKey, match.loserTo.matchKey),
        loserToSlot: match.loserTo.slot,
      })
      .where(eq(matches.id, id));

    // Participants, including the empty slots that upstream results will fill.
    await tx.insert(matchParticipants).values(
      match.participants.map((entryId, slot) => ({
        matchId: id,
        entryId,
        slot,
        isWinner:
          match.autoCompleted && match.autoWinner !== null
            ? entryId === match.autoWinner
            : null,
      })),
    );
  }

  return { matchCount: bracket.matches.length, warnings };
}

function statusFor(match: GeneratedMatch): 'PENDING' | 'READY' | 'COMPLETE' {
  if (match.autoCompleted) return 'COMPLETE';
  const filled = match.participants.filter((participant) => participant !== null).length;
  return filled === 2 ? 'READY' : 'PENDING';
}

function resolve(idByKey: Map<string, string>, key: string | null): string | null {
  return key === null ? null : idByKey.get(key) ?? null;
}

async function writeRoundRobin(
  tx: Tx,
  gameId: string,
  inserted: InsertedEntry[],
  station: string | null,
): Promise<number> {
  const generated = generateRoundRobin(inserted.map((entry) => entry.id));

  for (const match of generated) {
    const [row] = await tx
      .insert(matches)
      .values({
        gameId,
        round: match.round,
        bracket: 'RR',
        slot: match.slot,
        station,
        // Round robin pairings are known up front, so every match is playable.
        status: 'READY',
      })
      .returning({ id: matches.id });

    await tx.insert(matchParticipants).values(
      match.participants.map((entryId, slot) => ({ matchId: row.id, entryId, slot })),
    );
  }

  return generated.length;
}

async function writeFfa(
  tx: Tx,
  gameId: string,
  inserted: InsertedEntry[],
  station: string | null,
): Promise<number> {
  const heat = generateFfaHeat(inserted.map((entry) => entry.id));
  if (!heat) return 0;

  const [row] = await tx
    .insert(matches)
    .values({
      gameId,
      round: heat.round,
      bracket: 'HEAT',
      slot: heat.slot,
      station,
      status: 'READY',
    })
    .returning({ id: matches.id });

  await tx.insert(matchParticipants).values(
    heat.participants.map((entryId, slot) => ({ matchId: row.id, entryId, slot })),
  );

  return 1;
}

/** Clears a game's generated tournament, refusing if anything has been played. */
export async function unscheduleGame(gameId: string): Promise<ScheduleOutcome> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const played = await tx
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.gameId, gameId), inArray(matches.status, ['COMPLETE'])));

    if (played.length > 0) {
      return {
        ok: false as const,
        error: `${played.length} match(es) already have results. Undo them first.`,
      };
    }

    await tx.delete(matches).where(eq(matches.gameId, gameId));
    await tx.delete(entries).where(eq(entries.gameId, gameId));
    await tx
      .update(games)
      .set({ status: 'DRAFT', updatedAt: new Date() })
      .where(eq(games.id, gameId));

    return { ok: true as const, entryCount: 0, matchCount: 0, warnings: [] };
  });
}
