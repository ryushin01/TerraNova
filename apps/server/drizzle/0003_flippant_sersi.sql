ALTER TABLE "crops" ADD COLUMN "alarm_times" jsonb;--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN "schedule_updated_at" timestamp with time zone;