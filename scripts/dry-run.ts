import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

/*
 * A full dry run of the event. SPEC.md §14, Phase 7: "a dry run with fake
 * results across all three days."
 *
 * Builds a plausible three-day schedule, plays every match, scores every game,
 * and leaves one game mid-play so the queue and the "you're up" banner have
 * something live to show. Deterministic, so the state is reproducible and
 * screenshots stay comparable.
 *
 *   npm run db:dry-run
 *
 * It rewrites the games and everything under them. Players, teams and
 * credentials are left alone, so join links keep working.
 */

const PER_WIN = 40;

type Plan = {
  name: string;
  format: 'DOUBLE_ELIM' | 'SINGLE_ELIM' | 'ROUND_ROBIN' | 'RANKED_FFA';
  entriesPerTeam: number;
  station: string;
  day: number;
  spansMultipleDays?: boolean;
  pointsMatrix?: Record<string, number>;
  pointsPerWin?: number;
  /** Left unplayed, so the queue has something on it. */
  leaveLive?: boolean;
};

const PLAN: Plan[] = [
  {
    name: 'Beer Pong',
    format: 'DOUBLE_ELIM',
    entriesPerTeam: 2,
    station: 'Pong Table — Patio',
    day: 1,
    spansMultipleDays: true,
    pointsMatrix: { '1': 200, '2': 160, '3': 130, '4': 100, '5': 80, '6': 60, '7': 40, '8': 20 },
  },
  {
    name: 'Flip Cup',
    format: 'ROUND_ROBIN',
    entriesPerTeam: 1,
    station: 'Lawn',
    day: 1,
    pointsPerWin: PER_WIN,
  },
  {
    name: 'Quarters',
    format: 'ROUND_ROBIN',
    entriesPerTeam: 1,
    station: 'Kitchen Table',
    day: 2,
    pointsPerWin: 25,
  },
  {
    name: 'Tug of War',
    format: 'RANKED_FFA',
    entriesPerTeam: 1,
    station: 'Back Field',
    day: 2,
    pointsMatrix: { '1': 100, '2': 70, '3': 50, '4': 30 },
  },
  {
    name: 'Cornhole',
    format: 'SINGLE_ELIM',
    entriesPerTeam: 1,
    station: 'Driveway',
    day: 3,
    pointsMatrix: { '1': 120, '2': 80, '3': 50, '4': 30 },
  },
  {
    name: 'Boat Race',
    format: 'RANKED_FFA',
    entriesPerTeam: 1,
    station: 'Back Field',
    day: 3,
    pointsMatrix: { '1': 150, '2': 100, '3': 70, '4': 40 },
    leaveLive: true,
  },
];

/** Deterministic pseudo-randomness, so a rerun produces the same event. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const { getDb } = await import('../lib/db');
  const { entries, eventState, games, matchParticipants, matches, players, teams } = await import(
    '../lib/db/schema'
  );
  const { draftOrder, totalPicksFor } = await import('../lib/draft');
  const { scheduleGame } = await import('../lib/engine/persist');
  const { completeGame, reportFfaResult, reportMatchResult } = await import(
    '../lib/engine/submit'
  );
  const { and, asc, eq, isNull, sql } = await import('drizzle-orm');

  const db = getDb();

  const [admin] = await db
    .select({ id: players.id, teamId: players.teamId })
    .from(players)
    .where(eq(players.isAdmin, true))
    .limit(1);

  if (!admin) {
    console.error('No admin found. Run `npm run db:demo` first.');
    process.exit(1);
  }

  const identity = { personId: admin.id, teamId: admin.teamId, role: 'ADMIN' as const };
  const random = seeded(20260901);

  console.log('clearing existing games');
  await db.execute(sql`delete from games`);

  await runDraft();

  for (const plan of PLAN) {
    const [game] = await db
      .insert(games)
      .values({
        name: plan.name,
        format: plan.format,
        entriesPerTeam: plan.entriesPerTeam,
        entrySize: plan.entriesPerTeam === 2 ? 2 : null,
        pointsMatrix: plan.pointsMatrix ?? {},
        pointsPerWin: plan.pointsPerWin ?? null,
        station: plan.station,
        scheduledDay: plan.day,
        spansMultipleDays: plan.spansMultipleDays ?? false,
        sortOrder: PLAN.indexOf(plan) + 1,
        rules: `Day ${plan.day}. Ask the admin.`,
      })
      .returning({ id: games.id, name: games.name });

    const scheduled = await scheduleGame(game.id);
    if (!scheduled.ok) {
      console.error(`  ${plan.name}: ${scheduled.error}`);
      continue;
    }

    if (plan.leaveLive) {
      // Left unplayed so the queue and the banner have something on them.
      const [next] = await db
        .select({ id: matches.id })
        .from(matches)
        .where(and(eq(matches.gameId, game.id), eq(matches.status, 'READY')))
        .orderBy(asc(matches.round), asc(matches.slot))
        .limit(1);
      if (next) {
        await db.update(matches).set({ status: 'IN_PROGRESS' }).where(eq(matches.id, next.id));
      }
      console.log(
        `  ${plan.name}: ${scheduled.matchCount} matches, left on at ${plan.station}`,
      );
      continue;
    }

    if (plan.format === 'RANKED_FFA') {
      const [heat] = await db
        .select({ id: matches.id })
        .from(matches)
        .where(eq(matches.gameId, game.id))
        .limit(1);
      const rows = await db
        .select({ entryId: matchParticipants.entryId })
        .from(matchParticipants)
        .where(eq(matchParticipants.matchId, heat.id));

      const order = rows
        .map((row) => row.entryId)
        .filter((id): id is string => id !== null)
        .map((id) => ({ id, key: random() }))
        .sort((a, b) => a.key - b.key)
        .map((row, index) => ({
          entryId: row.id,
          placement: index + 1,
          rawScore: 20 + Math.floor(random() * 40),
        }));

      const reported = await reportFfaResult(identity, { matchId: heat.id, placements: order });
      if (!reported.ok) console.error(`  ${plan.name}: ${reported.error}`);
    } else {
      // Play every ready match until none are left.
      for (let guard = 0; guard < 80; guard += 1) {
        const ready = await db
          .select({ id: matches.id })
          .from(matches)
          .where(and(eq(matches.gameId, game.id), eq(matches.status, 'READY')))
          .orderBy(asc(matches.round), asc(matches.slot))
          .limit(1);
        if (ready.length === 0) break;

        const sides = await db
          .select({ entryId: matchParticipants.entryId, slot: matchParticipants.slot })
          .from(matchParticipants)
          .where(eq(matchParticipants.matchId, ready[0].id))
          .orderBy(asc(matchParticipants.slot));

        const present = sides
          .map((side) => side.entryId)
          .filter((id): id is string => id !== null);
        if (present.length < 2) break;

        const winner = present[random() < 0.62 ? 0 : 1];
        const loserScore = Math.floor(random() * 9);
        const scores: Record<string, number> = {};
        for (const entryId of present) scores[entryId] = entryId === winner ? 10 : loserScore;

        const reported = await reportMatchResult(identity, {
          matchId: ready[0].id,
          winnerEntryId: winner,
          scores,
        });
        if (!reported.ok) {
          console.error(`  ${plan.name}: ${reported.error}`);
          break;
        }
      }
    }

    const scored = await completeGame(identity, game.id);
    if (!scored.ok) console.error(`  ${plan.name}: ${scored.error}`);
    else console.log(`  ${plan.name}: ${scored.notice}`);
  }

  /*
   * A played-out event has a finished draft. Without this the draft page is
   * empty in the dry run, which is the one page where "nothing here yet" looks
   * like a bug rather than a state.
   *
   * The order comes from lib/draft.ts rather than being invented here, so the
   * seeded board is the same snake order the live draft would produce. Who goes
   * where is drawn from the same seeded PRNG as the results, so a rerun gives an
   * identical board.
   */
  async function runDraft() {
    const teamRows = await db
      .select({ id: teams.id, name: teams.name, draftPosition: teams.draftPosition })
      .from(teams)
      .orderBy(asc(teams.draftPosition));

    // Undo any previous run first, so this script stays rerunnable.
    await db
      .update(players)
      .set({ draftPickNumber: null, teamId: null, updatedAt: new Date() })
      .where(eq(players.isCaptain, false));

    const undrafted = await db
      .select({ id: players.id, fullName: players.fullName })
      .from(players)
      .where(and(eq(players.isCaptain, false), isNull(players.draftPickNumber)))
      .orderBy(asc(players.fullName));

    // Fisher-Yates on the seeded PRNG, so the board is shuffled but fixed.
    const pool = [...undrafted];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const captainCount = teamRows.length;
    const totalPicks = totalPicksFor(undrafted.length + captainCount, captainCount);
    const order = draftOrder(totalPicks, teamRows.length);

    if (pool.length < totalPicks) {
      console.error(`draft needs ${totalPicks} players, found ${pool.length}. Run db:demo first.`);
      process.exit(1);
    }

    console.log(`drafting ${totalPicks} players in snake order`);

    for (const slot of order) {
      const team = teamRows[slot.draftPosition - 1];
      const player = pool[slot.pickNumber - 1];

      await db
        .update(players)
        .set({ draftPickNumber: slot.pickNumber, teamId: team.id, updatedAt: new Date() })
        .where(eq(players.id, player.id));
    }

    // is_mister_irrelevant is a generated column, so the last pick is already
    // labelled by the UPDATE above. Nothing to write for it.
    await db
      .update(eventState)
      .set({ draftStatus: 'COMPLETE', draftPaused: false, updatedAt: new Date() })
      .where(eq(eventState.id, 1));

    const [irrelevant] = await db
      .select({ fullName: players.fullName, pick: players.draftPickNumber })
      .from(players)
      .where(eq(players.isMisterIrrelevant, true))
      .limit(1);

    console.log(
      irrelevant
        ? `draft complete — Mister Irrelevant is ${irrelevant.fullName} (pick ${irrelevant.pick})`
        : 'draft complete',
    );
  }

  const [summary] = await db
    .select({
      games: sql<number>`(select count(*)::int from games)`,
      complete: sql<number>`(select count(*)::int from games where status = 'COMPLETE')`,
      matches: sql<number>`(select count(*)::int from matches)`,
      played: sql<number>`(select count(*)::int from matches where status = 'COMPLETE')`,
      live: sql<number>`(select count(*)::int from matches where status = 'IN_PROGRESS')`,
      results: sql<number>`(select count(*)::int from game_results)`,
      drafted: sql<number>`(select count(*)::int from players where draft_pick_number is not null)`,
    })
    .from(sql`(select 1) as one`);

  console.log('');
  console.log('dry run complete:', summary);
  console.log('Three days scheduled; one game left on so the queue has something to show.');

  void entries;
  process.exit(0);
}

main().catch((error) => {
  console.error('dry run failed');
  console.error(error);
  process.exit(1);
});
