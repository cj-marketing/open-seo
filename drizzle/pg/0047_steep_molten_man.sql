CREATE TABLE "audit_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"start_url" text NOT NULL,
	"max_pages" integer NOT NULL,
	"lighthouse_strategy" text DEFAULT 'none' NOT NULL,
	"render_javascript" boolean DEFAULT false NOT NULL,
	"schedule_interval" text DEFAULT 'monthly' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"next_check_at" text,
	"last_started_at" text,
	"last_skip_reason" text,
	"created_by_user_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_schedules" ADD CONSTRAINT "audit_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_schedules_project_id_idx" ON "audit_schedules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_schedules_due_idx" ON "audit_schedules" USING btree ("is_active","next_check_at");--> statement-breakpoint
CREATE INDEX "audit_issues_audit_type_page_idx" ON "audit_issues" USING btree ("audit_id","issue_type","page_url");