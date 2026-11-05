CREATE TABLE "crops" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "crops" ("id", "name", "icon", "created_at") VALUES
	('bellflower', '도라지', 'flower', '2026-01-01T00:00:00Z'),
	('rice', '벼', 'wheat', '2026-01-01T00:00:01Z'),
	('lettuce', '상추', 'leaf', '2026-01-01T00:00:02Z');--> statement-breakpoint
CREATE UNIQUE INDEX "crops_name_unique" ON "crops" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "zone_sections" ADD CONSTRAINT "zone_sections_crop_crops_id_fk" FOREIGN KEY ("crop") REFERENCES "public"."crops"("id") ON DELETE no action ON UPDATE no action;