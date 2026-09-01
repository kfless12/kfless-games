CREATE TABLE "standings_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standings_overrides_reason_not_blank" CHECK (btrim("standings_overrides"."reason") <> '')
);
--> statement-breakpoint
ALTER TABLE "standings_overrides" ADD CONSTRAINT "standings_overrides_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings_overrides" ADD CONSTRAINT "standings_overrides_created_by_players_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "standings_overrides_team_id_key" ON "standings_overrides" USING btree ("team_id");