CREATE TABLE "sensor_samples" (
	"zone_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"temperature_c" double precision NOT NULL,
	"humidity_pct" double precision NOT NULL,
	"soil_moisture_pct" double precision NOT NULL,
	CONSTRAINT "sensor_samples_zone_id_at_pk" PRIMARY KEY("zone_id","at")
);
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN "automation" jsonb;--> statement-breakpoint
CREATE INDEX "sensor_samples_at" ON "sensor_samples" USING btree ("at");--> statement-breakpoint
CREATE INDEX "watering_cycles_zone_created" ON "watering_cycles" USING btree ("zone_id","created_at");