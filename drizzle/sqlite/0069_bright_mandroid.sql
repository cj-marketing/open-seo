CREATE TABLE `audit_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`start_url` text NOT NULL,
	`max_pages` integer NOT NULL,
	`lighthouse_strategy` text DEFAULT 'none' NOT NULL,
	`render_javascript` integer DEFAULT false NOT NULL,
	`schedule_interval` text DEFAULT 'monthly' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`next_check_at` text,
	`last_started_at` text,
	`last_skip_reason` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_schedules_project_id_idx` ON `audit_schedules` (`project_id`);--> statement-breakpoint
CREATE INDEX `audit_schedules_due_idx` ON `audit_schedules` (`is_active`,`next_check_at`);--> statement-breakpoint
CREATE INDEX `audit_issues_audit_type_page_idx` ON `audit_issues` (`audit_id`,`issue_type`,`page_url`);