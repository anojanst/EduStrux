CREATE TABLE `admin_access_log` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_clerk_user_id` text NOT NULL,
	`admin_user_id` text,
	`action` text NOT NULL,
	`org_id` text,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_access_log_created_idx` ON `admin_access_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `admin_access_log_org_idx` ON `admin_access_log` (`org_id`,`created_at`);