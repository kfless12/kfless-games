CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "images_mime_type_allowed" CHECK ("images"."mime_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "images_byte_size_capped" CHECK ("images"."byte_size" > 0 and "images"."byte_size" <= 5242880),
	CONSTRAINT "images_dimensions_capped" CHECK ("images"."width" between 1 and 2000 and "images"."height" between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "profile_complete" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "players" drop column "profile_complete";--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "profile_complete" boolean GENERATED ALWAYS AS ((
          photo_url is not null
          and beer_pong is not null and chugging is not null and flip_cup is not null
          and endurance is not null and clutch is not null and trash_talk is not null
          and hand_eye is not null and recovery is not null
          and scouting_report is not null and btrim(scouting_report) <> ''
        )) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_uploaded_by_players_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;