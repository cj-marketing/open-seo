CREATE TABLE `project_change_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`note_date` text NOT NULL,
	`label` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_change_notes_project_date_idx` ON `project_change_notes` (`project_id`,`note_date`);