CREATE TABLE "project_change_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"note_date" text NOT NULL,
	"label" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_change_notes" ADD CONSTRAINT "project_change_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_change_notes_project_date_idx" ON "project_change_notes" USING btree ("project_id","note_date");