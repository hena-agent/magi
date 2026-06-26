CREATE TABLE `session_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_events_session_sequence_idx` ON `session_events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `session_events_session_type_idx` ON `session_events` (`session_id`,`type`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_root` text NOT NULL,
	`title` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
