CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`address` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_org_name_uq` ON `branches` (`org_id`,lower("name")) WHERE "branches"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `grade_levels` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `grade_levels_org_sort_idx` ON `grade_levels` (`org_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `grade_levels_org_name_uq` ON `grade_levels` (`org_id`,lower("name")) WHERE "grade_levels"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`capacity` integer
);
--> statement-breakpoint
CREATE INDEX `rooms_org_branch_idx` ON `rooms` (`org_id`,`branch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_org_branch_name_uq` ON `rooms` (`org_id`,`branch_id`,lower("name")) WHERE "rooms"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_org_name_uq` ON `subjects` (`org_id`,lower("name")) WHERE "subjects"."deleted_at" is null;