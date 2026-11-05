CREATE TABLE "control_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"zone_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE INDEX "control_events_at" ON "control_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "control_events_zone" ON "control_events" USING btree ("zone_id","id");