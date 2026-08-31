import { config as loadEnv } from 'dotenv';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import {
  auditLog,
  credentials,
  eventState,
  images,
  players,
  teams,
} from '../lib/db/schema';
import { checkImage } from '../lib/images';
import { newJoinCode, newToken } from '../lib/credentials';
import { fakeAvatarPng, fakeProfile, fakeTeamLogoPng } from './fake-profiles';
import { SEED_PLAYERS, SEED_TEAMS } from './seed-data';
import { validateRoster } from './seed-validate';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

/*
 * Seeds the roster from scripts/seed-data.ts and issues everyone a credential.
 *
 * Refuses to run against a non-empty players table unless SEED_RESET=1, so it
 * cannot quietly wipe the real roster mid-event.
 *
 * SEED_FAKE_PROFILES=1 (via `npm run db:demo`) also fills in placeholder
 * avatars, bios, and ratings so the draft board has something to show before
 * the real people fill theirs in. Off by default: at the actual event, an
 * invented stat line nobody wrote is worse than an obviously empty card.
 *
 * Token and code formats come from lib/credentials.ts, the same module
 * lib/auth.ts uses, so a seeded credential is indistinguishable from an
 * app-issued one.
 */

function validate() {
  const problems = validateRoster(SEED_PLAYERS, SEED_TEAMS);
  if (problems.length === 0) return;

  console.error('scripts/seed-data.ts is not valid:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}


type Tx = Parameters<Parameters<ReturnType<typeof drizzle>['transaction']>[0]>[0];

/**
 * Placeholder avatars, bios, and ratings. Every generated PNG goes through the
 * same checkImage() the upload route uses, so a bug in lib/png.ts fails the seed
 * loudly instead of putting an unservable row in the images table.
 */
async function fillFakeProfiles(
  tx: Tx,
  insertedPlayers: { id: string; email: string }[],
  insertedTeams: { id: string; captainId: string }[],
) {
  for (const player of insertedPlayers) {
    const png = fakeAvatarPng(player.email);
    const check = checkImage(png);
    if (!check.ok) throw new Error(`generated avatar rejected: ${check.reason}`);

    const [image] = await tx
      .insert(images)
      .values({
        mimeType: check.info.mimeType,
        bytes: png,
        byteSize: png.length,
        width: check.info.width,
        height: check.info.height,
        uploadedBy: player.id,
      })
      .returning({ id: images.id });

    await tx
      .update(players)
      .set({ ...fakeProfile(player.email), photoUrl: `/api/images/${image.id}` })
      .where(eq(players.id, player.id));
  }

  for (const team of insertedTeams) {
    const [current] = await tx
      .select({ name: teams.name, colorHex: teams.colorHex })
      .from(teams)
      .where(eq(teams.id, team.id))
      .limit(1);

    const png = fakeTeamLogoPng(current.name, current.colorHex);
    const check = checkImage(png);
    if (!check.ok) throw new Error(`generated logo rejected: ${check.reason}`);

    const [image] = await tx
      .insert(images)
      .values({
        mimeType: check.info.mimeType,
        bytes: png,
        byteSize: png.length,
        width: check.info.width,
        height: check.info.height,
        uploadedBy: team.captainId,
      })
      .returning({ id: images.id });

    await tx.update(teams).set({ logoUrl: `/api/images/${image.id}` }).where(eq(teams.id, team.id));
  }

  console.log(
    `filled ${insertedPlayers.length} placeholder profiles and ${insertedTeams.length} team logos`,
  );
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
        await tx.update(players).set({ photoUrl: null });
        await tx.update(teams).set({ logoUrl: null });
        await tx.delete(images);
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

      if (process.env.SEED_FAKE_PROFILES === '1') {
        await fillFakeProfiles(tx, insertedPlayers, insertedTeams);
      }

      // Reset the draft too. onConflictDoNothing would leave a half-finished
      // draft from a previous run pointing at players that no longer exist.
      await tx
        .insert(eventState)
        .values({ id: 1, draftStatus: 'NOT_STARTED', draftPaused: false })
        .onConflictDoUpdate({
          target: eventState.id,
          set: { draftStatus: 'NOT_STARTED', draftPaused: false, updatedAt: new Date() },
        });

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
        images: sql<number>`(select count(*)::int from images)`,
        profilesComplete: sql<number>`(select count(*)::int from players where profile_complete)`,
        draftStatus: sql<string>`(select draft_status from event_state where id = 1)`,
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
