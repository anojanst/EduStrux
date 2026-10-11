CREATE TABLE `class_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`class_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `class_schedules_org_class_idx` ON `class_schedules` (`org_id`,`class_id`);--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`course_id` text NOT NULL,
	`grade_level_id` text NOT NULL,
	`term_id` text,
	`branch_id` text NOT NULL,
	`room_id` text,
	`teacher_membership_id` text,
	`name` text NOT NULL,
	`capacity` integer,
	`start_date` text,
	`end_date` text
);
--> statement-breakpoint
CREATE INDEX `classes_org_branch_idx` ON `classes` (`org_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `classes_org_teacher_idx` ON `classes` (`org_id`,`teacher_membership_id`);--> statement-breakpoint
CREATE INDEX `classes_org_term_idx` ON `classes` (`org_id`,`term_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `classes_org_course_term_branch_name_uq` ON `classes` (`org_id`,`course_id`,(case when "term_id" is null then '' else "term_id" end),`branch_id`,lower("name")) WHERE "classes"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`class_id` text NOT NULL,
	`room_id` text,
	`teacher_membership_id` text,
	`date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_org_date_idx` ON `sessions` (`org_id`,`date`,`start_time`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_org_class_date_start_uq` ON `sessions` (`org_id`,`class_id`,`date`,`start_time`) WHERE "sessions"."deleted_at" is null;