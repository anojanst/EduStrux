CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`file_id` text NOT NULL,
	`status` text DEFAULT 'mapping' NOT NULL,
	`headers` text NOT NULL,
	`row_count` integer NOT NULL,
	`mapping` text,
	`defaults` text,
	`problems` text,
	`job_id` text,
	`result` text,
	`created_by_user_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `imports_org_id_uq` ON `imports` (`org_id`,`id`);