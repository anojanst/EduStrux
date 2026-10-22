CREATE TABLE `exports` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`job_id` text,
	`file_id` text,
	`counts` text,
	`created_by_user_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exports_org_id_uq` ON `exports` (`org_id`,`id`);