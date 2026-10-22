ALTER TABLE "alert_groups" ADD COLUMN "thread_id" integer;--> statement-breakpoint
ALTER TABLE "alert_outbox" ADD COLUMN "thread_id" integer;
