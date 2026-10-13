CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`session_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_org_session_student_uq` ON `attendance` (`org_id`,`session_id`,`student_id`) WHERE "attendance"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `attendance_org_student_idx` ON `attendance` (`org_id`,`student_id`);