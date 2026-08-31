import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { eventState, players, teams } from '@/lib/db/schema';
import {
  currentSlot,
  type DraftSlot,
  picksPerPosition,
  totalPicksFor,
  upcomingSlots,
} from '@/lib/draft';

/*
 * Everything the draft board needs, in one read. SPEC.md §5.
 *
 * Counts come from the database rather than constants, per SPEC.md §1.
 */

export type DraftStatus = 'NOT_STARTED' | 'LIVE' | 'COMPLETE';

export type DraftTeam = {
  id: string;
  name: string;
  colorHex: string;
  logoUrl: string | null;
  draftPosition: number;
  captainId: string;
  captainName: string;
  roster: DraftPlayer[];
  picksRemaining: number;
};

export type DraftPlayer = {
  id: string;
  fullName: string;
  nickname: string | null;
  photoUrl: string | null;
  draftPickNumber: number | null;
  isCaptain: boolean;
  isMisterIrrelevant: boolean;
  teamId: string | null;
  ratings: Record<string, number | null>;
  scoutingReport: string | null;
  hometown: string | null;
  preferredBeverage: string | null;
  personalRecordBeers: number | null;
};

export type PickHistoryEntry = {
  pickNumber: number;
  round: number;
  player: DraftPlayer;
  teamId: string;
  teamName: string;
  teamColor: string;
};

export type DraftState = {
  status: DraftStatus;
  paused: boolean;
  teamCount: number;
  totalPicks: number;
  picksMade: number;
  onTheClock: (DraftSlot & { team: DraftTeam }) | null;
  upcoming: (DraftSlot & { team: DraftTeam })[];
  teams: DraftTeam[];
  pool: DraftPlayer[];
  history: PickHistoryEntry[];
};

const RATING_COLUMNS = [
  'beerPong',
  'chugging',
  'flipCup',
  'endurance',
  'clutch',
  'trashTalk',
  'handEye',
  'recovery',
] as const;

type PlayerRow = typeof players.$inferSelect;

function toDraftPlayer(row: PlayerRow): DraftPlayer {
  const ratings: Record<string, number | null> = {};
  for (const key of RATING_COLUMNS) ratings[key] = row[key];

  return {
    id: row.id,
    fullName: row.fullName,
    nickname: row.nickname,
    photoUrl: row.photoUrl,
    draftPickNumber: row.draftPickNumber,
    isCaptain: row.isCaptain,
    isMisterIrrelevant: row.isMisterIrrelevant,
    teamId: row.teamId,
    ratings,
    scoutingReport: row.scoutingReport,
    hometown: row.hometown,
    preferredBeverage: row.preferredBeverage,
    personalRecordBeers: row.personalRecordBeers,
  };
}

/** Reads or creates the single event_state row. */
export async function readEventState() {
  const db = getDb();
  const [existing] = await db.select().from(eventState).where(eq(eventState.id, 1)).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(eventState).values({ id: 1 }).onConflictDoNothing().returning();
  if (created) return created;

  const [again] = await db.select().from(eventState).where(eq(eventState.id, 1)).limit(1);
  return again;
}

export async function loadDraftState(): Promise<DraftState> {
  const db = getDb();

  const [state, allPlayers, allTeams] = await Promise.all([
    readEventState(),
    db.select().from(players).orderBy(asc(players.fullName)),
    db
      .select({
        id: teams.id,
        name: teams.name,
        colorHex: teams.colorHex,
        logoUrl: teams.logoUrl,
        draftPosition: teams.draftPosition,
        captainId: teams.captainId,
      })
      .from(teams)
      .orderBy(asc(teams.draftPosition)),
  ]);

  const teamCount = allTeams.length;
  const captainCount = allPlayers.filter((p) => p.isCaptain).length;
  const totalPicks = totalPicksFor(allPlayers.length, captainCount);
  const picksMade = allPlayers.filter((p) => p.draftPickNumber !== null).length;

  const perPosition = picksPerPosition(totalPicks, teamCount);

  const byId = new Map(allPlayers.map((p) => [p.id, p]));

  const draftTeams: DraftTeam[] = allTeams.map((team) => {
    const roster = allPlayers
      .filter((p) => p.teamId === team.id)
      // Captain first, then in pick order.
      .sort((a, b) => {
        if (a.isCaptain !== b.isCaptain) return a.isCaptain ? -1 : 1;
        return (a.draftPickNumber ?? 0) - (b.draftPickNumber ?? 0);
      })
      .map(toDraftPlayer);

    const owed = perPosition[team.draftPosition - 1] ?? 0;
    const taken = roster.filter((p) => !p.isCaptain).length;

    return {
      ...team,
      captainName: byId.get(team.captainId)?.fullName ?? 'Unknown',
      roster,
      picksRemaining: Math.max(0, owed - taken),
    };
  });

  const teamByPosition = new Map(draftTeams.map((t) => [t.draftPosition, t]));
  const attach = (slot: DraftSlot) => {
    const team = teamByPosition.get(slot.draftPosition);
    return team ? { ...slot, team } : null;
  };

  const clockSlot = currentSlot(picksMade, totalPicks, teamCount);
  const onTheClock = clockSlot ? attach(clockSlot) : null;

  const upcoming = upcomingSlots(picksMade, totalPicks, teamCount)
    .map(attach)
    .filter((entry): entry is DraftSlot & { team: DraftTeam } => entry !== null);

  const history: PickHistoryEntry[] = allPlayers
    .filter((p) => p.draftPickNumber !== null)
    .sort((a, b) => (b.draftPickNumber ?? 0) - (a.draftPickNumber ?? 0))
    .map((row) => {
      const team = draftTeams.find((t) => t.id === row.teamId);
      const pickNumber = row.draftPickNumber!;
      return {
        pickNumber,
        round: Math.floor((pickNumber - 1) / teamCount) + 1,
        player: toDraftPlayer(row),
        teamId: row.teamId ?? '',
        teamName: team?.name ?? 'Unknown',
        teamColor: team?.colorHex ?? '#000000',
      };
    });

  const pool = allPlayers
    .filter((p) => !p.isCaptain && p.draftPickNumber === null)
    .map(toDraftPlayer);

  return {
    status: (state?.draftStatus ?? 'NOT_STARTED') as DraftStatus,
    paused: state?.draftPaused ?? false,
    teamCount,
    totalPicks,
    picksMade,
    onTheClock,
    upcoming,
    teams: draftTeams,
    pool,
    history,
  };
}

/** The undrafted, non-captain players still available. Used by the pick action. */
export async function countAvailable(): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(players)
    .where(and(eq(players.isCaptain, false), isNull(players.draftPickNumber)));
  return row?.count ?? 0;
}

export async function countPicksMade(): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(players)
    .where(isNotNull(players.draftPickNumber));
  return row?.count ?? 0;
}
