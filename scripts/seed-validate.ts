import type { SeedPlayer, SeedTeam } from './seed-data';

/*
 * Roster validation, separated from scripts/seed.ts so it can be tested against
 * deliberately broken rosters without running a seed or exiting the process.
 *
 * Returns a list of problems, empty when the roster is valid. It never throws
 * and never exits — the caller decides what to do.
 */

/** SPEC.md §1: exactly 17 players, exactly 4 teams, 4 captains. */
export const EXPECTED_PLAYERS = 17;
export const EXPECTED_TEAMS = 4;

export function validateRoster(players: SeedPlayer[], teams: SeedTeam[]): string[] {
  const problems: string[] = [];

  if (players.length !== EXPECTED_PLAYERS) {
    problems.push(`expected ${EXPECTED_PLAYERS} players, found ${players.length}`);
  }
  if (teams.length !== EXPECTED_TEAMS) {
    problems.push(`expected ${EXPECTED_TEAMS} teams, found ${teams.length}`);
  }

  const captains = players.filter((p) => p.isCaptain);
  if (captains.length !== EXPECTED_TEAMS) {
    problems.push(`expected ${EXPECTED_TEAMS} captains, found ${captains.length}`);
  }

  const admins = players.filter((p) => p.isAdmin);
  if (admins.length !== 1) {
    problems.push(`expected exactly 1 admin, found ${admins.length}`);
  }

  const emails = players.map((p) => p.email.toLowerCase());
  const duplicateEmails = emails.filter((e, i) => emails.indexOf(e) !== i);
  if (duplicateEmails.length > 0) {
    problems.push(`duplicate emails: ${[...new Set(duplicateEmails)].join(', ')}`);
  }

  for (const player of players) {
    if (!player.fullName.trim()) problems.push(`a player has a blank name (${player.email})`);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(player.email)) {
      problems.push(`"${player.email}" is not an email address`);
    }
  }

  const positions = teams.map((t) => t.draftPosition).sort((a, b) => a - b);
  const expectedPositions = Array.from({ length: EXPECTED_TEAMS }, (_, i) => i + 1);
  if (positions.join(',') !== expectedPositions.join(',')) {
    problems.push(
      `draft positions must be ${expectedPositions.join(',')} with no repeats; got ${positions.join(',')}`,
    );
  }

  const captainEmails = new Set(captains.map((c) => c.email.toLowerCase()));
  const claimed = new Set<string>();
  for (const team of teams) {
    const email = team.captainEmail.toLowerCase();
    if (!captainEmails.has(email)) {
      problems.push(`team "${team.name}" captain ${team.captainEmail} is not a captain`);
    }
    if (claimed.has(email)) {
      problems.push(`${team.captainEmail} is captain of more than one team`);
    }
    claimed.add(email);
  }

  for (const team of teams) {
    if (!/^#[0-9a-fA-F]{6}$/.test(team.colorHex)) {
      problems.push(`team "${team.name}" colorHex ${team.colorHex} is not #rrggbb`);
    }
    if (!team.name.trim()) problems.push('a team has a blank name');
  }

  return problems;
}
