import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Drizzle has no built-in bytea column, so declare one. Maps to Buffer. */
const customBytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/*
 * Data model per SPEC.md §4.
 *
 * Two structural rules this file exists to enforce:
 *   - There is no points column anywhere. Standings are computed from
 *     game_results and match rows at read time (SPEC.md §2, §4.2).
 *   - Every table lives in Postgres. No process holds state (SPEC.md §10.2).
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** SPEC.md §3.4. PUBLIC is the absence of a credential and is never stored. */
export const roleEnum = pgEnum('role', ['ADMIN', 'CAPTAIN', 'PLAYER']);

export const gameFormatEnum = pgEnum('game_format', [
  'DOUBLE_ELIM',
  'SINGLE_ELIM',
  'ROUND_ROBIN',
  'RANKED_FFA',
]);

export const entryAggregationEnum = pgEnum('entry_aggregation', ['SUM', 'BEST']);

export const gameStatusEnum = pgEnum('game_status', [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'COMPLETE',
]);

export const matchBracketEnum = pgEnum('match_bracket', [
  'WINNERS',
  'LOSERS',
  'GRAND_FINAL',
  'RR',
  'HEAT',
]);

export const matchStatusEnum = pgEnum('match_status', [
  'PENDING',
  'READY',
  'IN_PROGRESS',
  'COMPLETE',
]);

/** SPEC.md §5.1. */
export const draftStatusEnum = pgEnum('draft_status', ['NOT_STARTED', 'LIVE', 'COMPLETE']);

// ---------------------------------------------------------------------------
// players — SPEC.md §4.1
// ---------------------------------------------------------------------------

/** Scouting ratings are 1–100, nullable, self-entered, and decorative. */
const rating = (column: string) => integer(column);

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: text('full_name').notNull(),
    nickname: text('nickname'),
    email: text('email').notNull(),

    // Null until drafted. Captains are set to their own team at seed time.
    teamId: uuid('team_id').references((): AnyPgColumn => teams.id, {
      onDelete: 'set null',
    }),

    isCaptain: boolean('is_captain').notNull().default(false),

    // Grants the ADMIN role to this person's magic link. The event admin is one
    // of the 17, so admin actions stay attributable in audit_log.
    isAdmin: boolean('is_admin').notNull().default(false),

    // 1–13, null for captains. SPEC.md §1.1.
    draftPickNumber: integer('draft_pick_number'),

    // Derived in the database, exactly as SPEC.md §4.1 describes it. A generated
    // column means SPEC.md §1.1's "cannot be edited away" is structurally true,
    // and an undone pick 13 clears the label with no extra code.
    isMisterIrrelevant: boolean('is_mister_irrelevant')
      .notNull()
      .generatedAlwaysAs(sql`(coalesce(draft_pick_number, 0) = 13)`),

    photoUrl: text('photo_url'),
    /*
     * Derived, not stored — the same reasoning as isMisterIrrelevant below it.
     * A boolean that a save handler is supposed to keep in sync is a boolean
     * that eventually lies, and the admin's completion checklist (SPEC.md §9.1)
     * is only useful if it is true.
     *
     * "Complete" means the parts that make a draft card work (SPEC.md §5.3):
     * a photo, all eight scouting ratings, and a scouting report. The
     * biographical fields are flavour and are not required. SPEC.md does not
     * define this, so it is defined here.
     */
    profileComplete: boolean('profile_complete')
      .notNull()
      .generatedAlwaysAs(
        sql`(
          photo_url is not null
          and beer_pong is not null and chugging is not null and flip_cup is not null
          and endurance is not null and clutch is not null and trash_talk is not null
          and hand_eye is not null and recovery is not null
          and scouting_report is not null and btrim(scouting_report) <> ''
        )`,
      ),

    // Biographical. All nullable, all self-entered, all decorative.
    height: text('height'),
    weight: integer('weight'),
    hometown: text('hometown'),
    college: text('college'),
    preferredBeverage: text('preferred_beverage'),
    signatureCelebration: text('signature_celebration'),
    walkoutSong: text('walkout_song'),
    scoutingReport: text('scouting_report'),

    // Scouting ratings, 1–100. SPEC.md §4.1: these must never feed scoring,
    // seeding, or matchmaking.
    beerPong: rating('beer_pong'),
    chugging: rating('chugging'),
    flipCup: rating('flip_cup'),
    endurance: rating('endurance'),
    clutch: rating('clutch'),
    trashTalk: rating('trash_talk'),
    handEye: rating('hand_eye'),
    recovery: rating('recovery'),

    personalRecordBeers: integer('personal_record_beers'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('players_email_key').on(table.email),
    uniqueIndex('players_draft_pick_number_key').on(table.draftPickNumber),
    index('players_team_id_idx').on(table.teamId),
    check(
      'players_draft_pick_number_range',
      sql`${table.draftPickNumber} is null or ${table.draftPickNumber} between 1 and 13`,
    ),
    // Captains are not drafted.
    check(
      'players_captains_are_not_drafted',
      sql`not (${table.isCaptain} and ${table.draftPickNumber} is not null)`,
    ),
    check(
      'players_ratings_range',
      sql`(${table.beerPong} is null or ${table.beerPong} between 1 and 100)
        and (${table.chugging} is null or ${table.chugging} between 1 and 100)
        and (${table.flipCup} is null or ${table.flipCup} between 1 and 100)
        and (${table.endurance} is null or ${table.endurance} between 1 and 100)
        and (${table.clutch} is null or ${table.clutch} between 1 and 100)
        and (${table.trashTalk} is null or ${table.trashTalk} between 1 and 100)
        and (${table.handEye} is null or ${table.handEye} between 1 and 100)
        and (${table.recovery} is null or ${table.recovery} between 1 and 100)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// teams — SPEC.md §4.2. No points column, ever.
// ---------------------------------------------------------------------------

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    logoUrl: text('logo_url'),
    colorHex: text('color_hex').notNull(),
    motto: text('motto'),
    captainId: uuid('captain_id')
      .notNull()
      .references((): AnyPgColumn => players.id, { onDelete: 'restrict' }),
    // 1–4, set manually by the admin. SPEC.md §5.1: no randomizer.
    draftPosition: integer('draft_position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('teams_draft_position_key').on(table.draftPosition),
    uniqueIndex('teams_captain_id_key').on(table.captainId),
    check(
      'teams_draft_position_range',
      sql`${table.draftPosition} between 1 and 4`,
    ),
    check('teams_color_hex_format', sql`${table.colorHex} ~* '^#[0-9a-f]{6}$'`),
  ],
);

// ---------------------------------------------------------------------------
// games — SPEC.md §4.3
// ---------------------------------------------------------------------------

export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    rules: text('rules'),
    format: gameFormatEnum('format').notNull(),
    entriesPerTeam: integer('entries_per_team').notNull().default(1),
    // Players per entry. Informational only (beer pong = 2).
    entrySize: integer('entry_size'),
    // placement -> points, e.g. {"1":100,"2":70,"3":50,"4":30}.
    pointsMatrix: jsonb('points_matrix').notNull().default({}),
    entryAggregation: entryAggregationEnum('entry_aggregation').notNull().default('SUM'),
    scheduledDay: integer('scheduled_day'),
    sortOrder: integer('sort_order').notNull().default(0),
    station: text('station'),
    status: gameStatusEnum('status').notNull().default('DRAFT'),
    spansMultipleDays: boolean('spans_multiple_days').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('games_sort_order_idx').on(table.sortOrder),
    index('games_status_idx').on(table.status),
    check(
      'games_scheduled_day_range',
      sql`${table.scheduledDay} is null or ${table.scheduledDay} between 1 and 3`,
    ),
    check('games_entries_per_team_positive', sql`${table.entriesPerTeam} >= 1`),
    check(
      'games_entry_size_positive',
      sql`${table.entrySize} is null or ${table.entrySize} >= 1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// entries — SPEC.md §4.4. The unit that actually competes.
// ---------------------------------------------------------------------------

export const entries = pgTable(
  'entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    seed: integer('seed'),
    // Optional. Captains may assign which of their players fill each entry.
    playerIds: uuid('player_ids').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('entries_game_id_idx').on(table.gameId),
    index('entries_team_id_idx').on(table.teamId),
    uniqueIndex('entries_game_id_label_key').on(table.gameId, table.label),
  ],
);

// ---------------------------------------------------------------------------
// matches — SPEC.md §4.5
// ---------------------------------------------------------------------------

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    bracket: matchBracketEnum('bracket').notNull(),
    // Position within the round.
    slot: integer('slot').notNull(),
    status: matchStatusEnum('status').notNull().default('PENDING'),
    station: text('station'),
    queuePosition: integer('queue_position'),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Advancement pointers, brackets only. Wired at generation time so that
    // reporting a result is "write into the target slot" and undo is "clear the
    // target slot". SPEC.md §6.1.
    winnerToMatchId: uuid('winner_to_match_id').references((): AnyPgColumn => matches.id, {
      onDelete: 'set null',
    }),
    winnerToSlot: integer('winner_to_slot'),
    loserToMatchId: uuid('loser_to_match_id').references((): AnyPgColumn => matches.id, {
      onDelete: 'set null',
    }),
    loserToSlot: integer('loser_to_slot'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('matches_game_bracket_round_slot_key').on(
      table.gameId,
      table.bracket,
      table.round,
      table.slot,
    ),
    index('matches_game_id_status_idx').on(table.gameId, table.status),
    index('matches_station_idx').on(table.station),
  ],
);

// ---------------------------------------------------------------------------
// match_participants — SPEC.md §4.6
//
// A participants table rather than participant_a / participant_b is deliberate:
// a 2-entry bracket match and a 4-entry FFA heat share one code path.
// ---------------------------------------------------------------------------

export const matchParticipants = pgTable(
  'match_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    // Nullable: an empty bracket slot waiting on an upstream result.
    entryId: uuid('entry_id').references(() => entries.id, { onDelete: 'set null' }),
    slot: integer('slot').notNull(),
    score: integer('score'),
    rank: integer('rank'),
    isWinner: boolean('is_winner'),
  },
  (table) => [
    uniqueIndex('match_participants_match_id_slot_key').on(table.matchId, table.slot),
    index('match_participants_entry_id_idx').on(table.entryId),
  ],
);

// ---------------------------------------------------------------------------
// game_results — SPEC.md §4.7. The only input to the leaderboard.
// ---------------------------------------------------------------------------

export const gameResults = pgTable(
  'game_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    placement: integer('placement').notNull(),
    pointsAwarded: integer('points_awarded').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('game_results_game_id_entry_id_key').on(table.gameId, table.entryId),
    index('game_results_game_id_idx').on(table.gameId),
    check('game_results_placement_positive', sql`${table.placement} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// audit_log — SPEC.md §4.8
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    // Null only for actions with no signed-in actor (e.g. the seed script).
    actorPersonId: uuid('actor_person_id').references(() => players.id, {
      onDelete: 'set null',
    }),
    actorRole: roleEnum('actor_role'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
  },
  (table) => [
    index('audit_log_timestamp_idx').on(table.timestamp),
    index('audit_log_target_idx').on(table.targetType, table.targetId),
  ],
);

// ---------------------------------------------------------------------------
// images — SPEC.md §4.9
//
// Player photos and team logos, as bytes in Postgres. Bytes live in their own
// table so that listing players never drags image data along with it.
// ---------------------------------------------------------------------------

export const images = pgTable(
  'images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mimeType: text('mime_type').notNull(),
    bytes: customBytea('bytes').notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => players.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'images_mime_type_allowed',
      sql`${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    // Mirrors the caps in lib/images.ts so a bug there cannot put a huge row in.
    check('images_byte_size_capped', sql`${table.byteSize} > 0 and ${table.byteSize} <= 5242880`),
    check(
      'images_dimensions_capped',
      sql`${table.width} between 1 and 2000 and ${table.height} between 1 and 2000`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// standings_overrides
//
// NOT IN SPEC.md §4. Required by SPEC.md §6.5's fifth global tie-breaker:
// "admin manual override with a required reason string". The reason is NOT NULL
// because the spec calls it required, and an override nobody can explain three
// days later is worse than a coin flip.
//
// Only consulted when total points, 1st places, 2nd places and round-robin
// head-to-head are all level. It nudges the order; it never adds points, so the
// "derived, never mutated" rule in SPEC.md §2 still holds.
// ---------------------------------------------------------------------------

export const standingsOverrides = pgTable(
  'standings_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    /** Lower sorts higher among otherwise-level teams. */
    priority: integer('priority').notNull().default(0),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by').references(() => players.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('standings_overrides_team_id_key').on(table.teamId),
    check('standings_overrides_reason_not_blank', sql`btrim(${table.reason}) <> ''`),
  ],
);

// ---------------------------------------------------------------------------
// credentials
//
// NOT IN SPEC.md §4. SPEC.md §3.1 delegates credential storage to lib/auth.ts
// ("no feature code reads a PIN or a token directly"), so the shape lives here
// rather than on players. Nothing outside lib/auth.ts may read this table.
//
// Both values are stored in plaintext on purpose (SPEC.md §3.2): the admin page
// has to display the link to copy and read the 6-digit code aloud in a yard.
// Revoked rows are kept so the audit trail survives a re-issue.
// ---------------------------------------------------------------------------

export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    // 32 random bytes, base64url. The path segment of /join/<token>.
    token: text('token').notNull(),
    // 6 digits, zero-padded, stored as text so leading zeros survive.
    joinCode: text('join_code').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('credentials_token_key').on(table.token),
    // Codes and links only need to be unique among those still usable.
    uniqueIndex('credentials_active_join_code_key')
      .on(table.joinCode)
      .where(sql`${table.revokedAt} is null`),
    uniqueIndex('credentials_active_player_key')
      .on(table.playerId)
      .where(sql`${table.revokedAt} is null`),
    check('credentials_join_code_format', sql`${table.joinCode} ~ '^[0-9]{6}$'`),
  ],
);

// ---------------------------------------------------------------------------
// auth_attempts
//
// NOT IN SPEC.md §4. Required by SPEC.md §3.4 ("5 attempts per IP, then
// exponential backoff"). It lives in Postgres rather than in a module-level
// map because SPEC.md §10.2 forbids in-memory state across requests — an
// in-process rate limiter silently stops working on a second container.
// ---------------------------------------------------------------------------

export const authAttempts = pgTable(
  'auth_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Client IP as reported by the proxy. Spoofable; adequate for this threat
    // model, which SPEC.md §3.2 states is "a friend being annoying".
    ip: text('ip').notNull(),
    succeeded: boolean('succeeded').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('auth_attempts_ip_attempted_at_idx').on(table.ip, table.attemptedAt)],
);

// ---------------------------------------------------------------------------
// event_state
//
// NOT IN SPEC.md §4. SPEC.md §5.1 requires a draft status
// (NOT_STARTED -> LIVE -> COMPLETE) and §5.4 requires pause/resume, but §4
// gives them nowhere to live, and SPEC.md §10.2 forbids holding them in
// memory. Single row, enforced by the primary key check.
// ---------------------------------------------------------------------------

export const eventState = pgTable(
  'event_state',
  {
    id: integer('id').primaryKey().default(1),
    draftStatus: draftStatusEnum('draft_status').notNull().default('NOT_STARTED'),
    draftPaused: boolean('draft_paused').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('event_state_singleton', sql`${table.id} = 1`)],
);
