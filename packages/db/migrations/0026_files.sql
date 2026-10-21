CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`purpose` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`max_size` integer NOT NULL,
	`size` integer,
	`r2_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`uploaded_by_user_id` text,
	`expires_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_org_id_uq` ON `files` (`org_id`,`id`);--> statement-breakpoint
CREATE INDEX `files_expires_idx` ON `files` (`expires_at`);