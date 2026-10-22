CREATE TABLE `student_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`student_id` text NOT NULL,
	`type` text NOT NULL,
	`granted` integer NOT NULL,
	`guardian_id` text,
	`note` text,
	`recorded_by_user_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_consents_org_student_type_uq` ON `student_consents` (`org_id`,`student_id`,`type`) WHERE "student_consents"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE `families` ADD `erased_at` text;