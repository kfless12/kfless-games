/**
 * The roster. SPEC.md §1: exactly 17 players, exactly 4 teams, 4 captains.
 *
 * ============================================================================
 * PLACEHOLDER DATA. Replace every name, email, team name, colour and motto
 * below with the real ones before the event. Nothing else needs to change —
 * scripts/seed.ts reads only this file.
 * ============================================================================
 *
 * Rules the seed script enforces, so a typo here fails loudly:
 *   - exactly 17 players
 *   - exactly 4 of them are captains
 *   - exactly 1 of them is the admin (SPEC.md's admin is one of the 17)
 *   - emails unique
 *   - exactly 4 teams, draft positions 1–4 with no repeats
 *   - every team's captain is one of the 4 captains, each used once
 *
 * draftPosition is set by hand and decided offline. SPEC.md §5.1: do not build
 * a randomizer. Position 4 gets pick 13 and ends with 5 players (§1.1).
 */

export type SeedPlayer = {
  fullName: string;
  nickname?: string;
  email: string;
  isCaptain?: boolean;
  isAdmin?: boolean;
};

export type SeedTeam = {
  name: string;
  colorHex: string;
  motto?: string;
  captainEmail: string;
  draftPosition: number;
};

export const SEED_PLAYERS: SeedPlayer[] = [
  // --- captains ---
  { fullName: 'Captain One', email: 'captain1@example.com', isCaptain: true, isAdmin: true },
  { fullName: 'Captain Two', email: 'captain2@example.com', isCaptain: true },
  { fullName: 'Captain Three', email: 'captain3@example.com', isCaptain: true },
  { fullName: 'Captain Four', email: 'captain4@example.com', isCaptain: true },

  // --- the 13 draftable players ---
  { fullName: 'Player Five', email: 'player5@example.com' },
  { fullName: 'Player Six', email: 'player6@example.com' },
  { fullName: 'Player Seven', email: 'player7@example.com' },
  { fullName: 'Player Eight', email: 'player8@example.com' },
  { fullName: 'Player Nine', email: 'player9@example.com' },
  { fullName: 'Player Ten', email: 'player10@example.com' },
  { fullName: 'Player Eleven', email: 'player11@example.com' },
  { fullName: 'Player Twelve', email: 'player12@example.com' },
  { fullName: 'Player Thirteen', email: 'player13@example.com' },
  { fullName: 'Player Fourteen', email: 'player14@example.com' },
  { fullName: 'Player Fifteen', email: 'player15@example.com' },
  { fullName: 'Player Sixteen', email: 'player16@example.com' },
  { fullName: 'Player Seventeen', email: 'player17@example.com' },
];

export const SEED_TEAMS: SeedTeam[] = [
  {
    name: 'Team One',
    colorHex: '#b91c1c',
    motto: 'Placeholder motto',
    captainEmail: 'captain1@example.com',
    draftPosition: 1,
  },
  {
    name: 'Team Two',
    colorHex: '#1d4ed8',
    motto: 'Placeholder motto',
    captainEmail: 'captain2@example.com',
    draftPosition: 2,
  },
  {
    name: 'Team Three',
    colorHex: '#15803d',
    motto: 'Placeholder motto',
    captainEmail: 'captain3@example.com',
    draftPosition: 3,
  },
  {
    // Position 4 picks 4th in round one and therefore takes pick 13,
    // ending with 5 players. SPEC.md §1.1 — intentional, do not "fix".
    name: 'Team Four',
    colorHex: '#a16207',
    motto: 'Placeholder motto',
    captainEmail: 'captain4@example.com',
    draftPosition: 4,
  },
];
