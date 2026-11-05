CREATE TABLE `thread_execution_reports` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`reasoning_level` text,
	`permission_mode` text,
	`service_tier` text,
	`reported_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
