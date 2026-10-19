CREATE TABLE `absence_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`student_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`reason` text,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `absence_notices_org_id_uq` ON `absence_notices` (`org_id`,`id`);--> statement-breakpoint
CREATE INDEX `absence_notices_org_student_idx` ON `absence_notices` (`org_id`,`student_id`,`id`);--> statement-breakpoint
CREATE TABLE `lesson_homework` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`session_id` text NOT NULL,
	`homework` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_homework_org_session_uq` ON `lesson_homework` (`org_id`,`session_id`) WHERE "lesson_homework"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `lesson_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`session_id` text NOT NULL,
	`student_id` text NOT NULL,
	`note` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_notes_org_session_student_uq` ON `lesson_notes` (`org_id`,`session_id`,`student_id`) WHERE "lesson_notes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `lesson_notes_org_student_idx` ON `lesson_notes` (`org_id`,`student_id`);