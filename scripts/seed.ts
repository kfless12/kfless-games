import { config as loadEnv } from 'dotenv';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import {
  auditLog,
  credentials,
  eventState,
  players,
  teams,
} from '../lib/db/schema';
import { newJoinCode, newToken } from '../lib/credentials';
import { SEED_PLAYERS, SEED_TEAMS } from './seed-data';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

/*
 * Seeds the roster from scripts/seed-data.ts and issues everyone a credential.
 *
 * Refuses to run against a non-empty players table unless SEED_RESET=1, so it
 * cannot quietly wipe the real roster mid-event.
 *
 * Token and code formats come from lib/credentials.ts, the same module
 * lib/auth.ts uses, so a seeded credential is indistinguishable from an
 * app-issued one.
 */

const EXPECTED_PLAYERS = 17;
const EXPECTED_TEAMS = 4;

function validate() {
  const problems: string[] = [];

  if (SEED_PLAYERS.length !== EXPECTED_PLAYERS) {
    problems.push(`expected ${EXPECTED_PLAYERS} players, found ${SEED_PLAYERS.length}`);
  }
  if (SEED_TEAMS.length !== EXPECTED_TEAMS) {
    problems.push(`expected ${EXPECTED_TEAMS} teams, found ${SEED_TEAMS.length}`);
  }

  const captains = SEED_PLAYERS.filter((p) => p.isCaptain);
  if (captains.length !== EXPECTED_TEAMS) {
    problems.push(`expected ${EXPECTED_TEAMS} captains, found ${captains.length}`);
  }

  const admins = SEED_PLAYERS.filter((p) => p.isAdmin);
  if (admins.length !== 1) {
    problems.push(`expected exactly 1 admin, found ${admins.length}`);
  }

  const emails = SEED_PLAYERS.map((p) => p.email.toLowerCase());
  const duplicateEmails = emails.filter((e, i) => emails.indexOf(e) !== i);
  if (duplicateEmails.length > 0) {
    problems.push(`duplicate emails: ${[...new Set(duplicateEmails)].join(', ')}`);
  }

  const positions = SEED_TEAMS.map((t) => t.draftPosition).sort((a, b) => a - b);
  if (positions.join(',') !== '1,2,3,4') {
    problems.push(`draft positions must be 1,2,3,4 with no repeats; got ${positions.join(',')}`);
  }

  const captainEmails = new Set(captains.map((c) => c.email.toLowerCase()));
  const claimed = new Set<string>();
  for (const team of SEED_TEAMS) {
    const email = team.captainEmail.toLowerCase();
    if (!captainEmails.has(email)) {
      problems.push(`team "${team.name}" captain ${team.captainEmail} is not a captain`);
    }
    if (claimed.has(email)) {
      problems.push(`${team.captainEmail} is captain of more than one team`);
    }
    claimed.add(email);
  }

  for (const team of SEED_TEAMS) {
    if (!/^#[0-9a-fA-F]{6}$/.test(team.colorHex)) {
      problems.push(`team "${team.name}" colorHex ${team.colorHex} is not #rrggbb`);
    }
  }

  if (problems.length > 0) {
    console.error('scripts/seed-data.ts is not valid:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}

async function main() {
  validate();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool);

  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(players);

    if (count > 0 && process.env.SEED_RESET !== '1') {
      console.error(
        `players already has ${count} row(s). Re-run with SEED_RESET=1 to wipe and reseed.`,
      );
      process.exit(1);
    }

    await db.transaction(async (tx) => {
      if (count > 0) {
        console.log(`SEED_RESET=1 — clearing ${count} existing player(s) and all teams`);
        await tx.delete(auditLog);
        await tx.delete(credentials);
        await tx.update(players).set({ teamId: null });
        await tx.delete(teams);
        await tx.delete(players);
      }

      // Players first: teams.captain_id points at a player, so the player rows
      // have to exist before the team rows.
      const insertedPlayers = await tx
        .insert(players)
        .values(
          SEED_PLAYERS.map((player) => ({
            fullName: player.fullName,
            nickname: player.nickname ?? null,
            email: player.email.toLowerCase(),
            isCaptain: player.isCaptain ?? false,
            isAdmin: player.isAdmin ?? false,
          })),
        )
        .returning({ id: players.id, email: players.email });

      const idByEmail = new Map(insertedPlayers.map((p) => [p.email, p.id]));

      const insertedTeams = await tx
        .insert(teams)
        .values(
          SEED_TEAMS.map((team) => ({
            name: team.name,
            colorHex: team.colorHex,
            motto: team.motto ?? null,
            captainId: idByEmail.get(team.captainEmail.toLowerCase())!,
            draftPosition: team.draftPosition,
          })),
        )
        .returning({ id: teams.id, captainId: teams.captainId });

      // Captains belong to the team they captain. The other 13 stay unassigned
      // until the draft (SPEC.md §4.1: team_id is null until drafted).
      for (const team of insertedTeams) {
        await tx.update(players).set({ teamId: team.id }).where(eq(players.id, team.captainId));
      }

      // Credentials for all 17 — magic link plus 6-digit fallback (SPEC.md §3.2).
      const used = new Set<string>();
      const credentialRows = insertedPlayers.map((player) => {
        let joinCode = newJoinCode();
        while (used.has(joinCode)) joinCode = newJoinCode();
        used.add(joinCode);
        return { playerId: player.id, token: newToken(), joinCode };
      });
      await tx.insert(credentials).values(credentialRows);

      await tx
        .insert(eventState)
        .values({ id: 1 })
        .onConflictDoNothing();

      await tx.insert(auditLog).values({
        action: 'seed.roster',
        targetType: 'event',
        targetId: 'seed',
        after: {
          players: insertedPlayers.length,
          teams: insertedTeams.length,
          credentials: credentialRows.length,
        },
      });
    });

    const [summary] = await db
      .select({
        players: sql<number>`(select count(*)::int from players)`,
        captains: sql<number>`(select count(*)::int from players where is_captain)`,
        admins: sql<number>`(select count(*)::int from players where is_admin)`,
        teams: sql<number>`(select count(*)::int from teams)`,
        credentials: sql<number>`(select count(*)::int from credentials where revoked_at is null)`,
      })
      .from(sql`(select 1) as one`);

    console.log('seeded:', summary);
    console.log('Credentials are listed at /admin — copy links from there.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('seed failed');
  console.error(error);
  process.exit(1);
});
