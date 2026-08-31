CREATE TYPE "public"."draft_status" AS ENUM('NOT_STARTED', 'LIVE', 'COMPLETE');--> statement-breakpoint
CREATE TYPE "public"."entry_aggregation" AS ENUM('SUM', 'BEST');--> statement-breakpoint
CREATE TYPE "public"."game_format" AS ENUM('DOUBLE_ELIM', 'ROUND_ROBIN', 'RANKED_FFA');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETE');--> statement-breakpoint
CREATE TYPE "public"."match_bracket" AS ENUM('WINNERS', 'LOSERS', 'GRAND_FINAL', 'RR', 'HEAT');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('PENDING', 'READY', 'IN_PROGRESS', 'COMPLETE');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'CAPTAIN', 'PLAYER');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_person_id" uuid,
	"actor_role" "role",
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "auth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"token" text NOT NULL,
	"join_code" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "credentials_join_code_format" CHECK ("credentials"."join_code" ~ '^[0-9]{6}$')
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"label" text NOT NULL,
	"seed" integer,
	"player_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"draft_status" "draft_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"draft_paused" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_state_singleton" CHECK ("event_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "game_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"placement" integer NOT NULL,
	"points_awarded" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_results_placement_positive" CHECK ("game_results"."placement" >= 1)
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"rules" text,
	"format" "game_format" NOT NULL,
	"entries_per_team" integer DEFAULT 1 NOT NULL,
	"entry_size" integer,
	"points_matrix" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entry_aggregation" "entry_aggregation" DEFAULT 'SUM' NOT NULL,
	"scheduled_day" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"station" text,
	"status" "game_status" DEFAULT 'DRAFT' NOT NULL,
	"spans_multiple_days" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_scheduled_day_range" CHECK ("games"."scheduled_day" is null or "games"."scheduled_day" between 1 and 3),
	CONSTRAINT "games_entries_per_team_positive" CHECK ("games"."entries_per_team" >= 1),
	CONSTRAINT "games_entry_size_positive" CHECK ("games"."entry_size" is null or "games"."entry_size" >= 1)
);
--> statement-breakpoint
CREATE TABLE "match_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"entry_id" uuid,
	"slot" integer NOT NULL,
	"score" integer,
	"rank" integer,
	"is_winner" boolean
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"bracket" "match_bracket" NOT NULL,
	"slot" integer NOT NULL,
	"status" "match_status" DEFAULT 'PENDING' NOT NULL,
	"station" text,
	"queue_position" integer,
	"completed_at" timestamp with time zone,
	"winner_to_match_id" uuid,
	"winner_to_slot" integer,
	"loser_to_match_id" uuid,
	"loser_to_slot" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"nickname" text,
	"email" text NOT NULL,
	"team_id" uuid,
	"is_captain" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"draft_pick_number" integer,
	"is_mister_irrelevant" boolean GENERATED ALWAYS AS ((coalesce(draft_pick_number, 0) = 13)) STORED NOT NULL,
	"photo_url" text,
	"profile_complete" boolean DEFAULT false NOT NULL,
	"height" text,
	"weight" integer,
	"hometown" text,
	"college" text,
	"preferred_beverage" text,
	"signature_celebration" text,
	"walkout_song" text,
	"scouting_report" text,
	"beer_pong" integer,
	"chugging" integer,
	"flip_cup" integer,
	"endurance" integer,
	"clutch" integer,
	"trash_talk" integer,
	"hand_eye" integer,
	"recovery" integer,
	"personal_record_beers" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_draft_pick_number_range" CHECK ("players"."draft_pick_number" is null or "players"."draft_pick_number" between 1 and 13),
	CONSTRAINT "players_captains_are_not_drafted" CHECK (not ("players"."is_captain" and "players"."draft_pick_number" is not null)),
	CONSTRAINT "players_ratings_range" CHECK (("players"."beer_pong" is null or "players"."beer_pong" between 1 and 100)
        and ("players"."chugging" is null or "players"."chugging" between 1 and 100)
        and ("players"."flip_cup" is null or "players"."flip_cup" between 1 and 100)
        and ("players"."endurance" is null or "players"."endurance" between 1 and 100)
        and ("players"."clutch" is null or "players"."clutch" between 1 and 100)
        and ("players"."trash_talk" is null or "players"."trash_talk" between 1 and 100)
        and ("players"."hand_eye" is null or "players"."hand_eye" between 1 and 100)
        and ("players"."recovery" is null or "players"."recovery" between 1 and 100))
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"color_hex" text NOT NULL,
	"motto" text,
	"captain_id" uuid NOT NULL,
	"draft_position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_draft_position_range" CHECK ("teams"."draft_position" between 1 and 4),
	CONSTRAINT "teams_color_hex_format" CHECK ("teams"."color_hex" ~* '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_person_id_players_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_to_match_id_matches_id_fk" FOREIGN KEY ("winner_to_match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_loser_to_match_id_matches_id_fk" FOREIGN KEY ("loser_to_match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_captain_id_players_id_fk" FOREIGN KEY ("captain_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_timestamp_idx" ON "audit_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "auth_attempts_ip_attempted_at_idx" ON "auth_attempts" USING btree ("ip","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_token_key" ON "credentials" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_active_join_code_key" ON "credentials" USING btree ("join_code") WHERE "credentials"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_active_player_key" ON "credentials" USING btree ("player_id") WHERE "credentials"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "entries_game_id_idx" ON "entries" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "entries_team_id_idx" ON "entries" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_game_id_label_key" ON "entries" USING btree ("game_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "game_results_game_id_entry_id_key" ON "game_results" USING btree ("game_id","entry_id");--> statement-breakpoint
CREATE INDEX "game_results_game_id_idx" ON "game_results" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "games_sort_order_idx" ON "games" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "games_status_idx" ON "games" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "match_participants_match_id_slot_key" ON "match_participants" USING btree ("match_id","slot");--> statement-breakpoint
CREATE INDEX "match_participants_entry_id_idx" ON "match_participants" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_game_bracket_round_slot_key" ON "matches" USING btree ("game_id","bracket","round","slot");--> statement-breakpoint
CREATE INDEX "matches_game_id_status_idx" ON "matches" USING btree ("game_id","status");--> statement-breakpoint
CREATE INDEX "matches_station_idx" ON "matches" USING btree ("station");--> statement-breakpoint
CREATE UNIQUE INDEX "players_email_key" ON "players" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "players_draft_pick_number_key" ON "players" USING btree ("draft_pick_number");--> statement-breakpoint
CREATE INDEX "players_team_id_idx" ON "players" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_draft_position_key" ON "teams" USING btree ("draft_position");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_captain_id_key" ON "teams" USING btree ("captain_id");