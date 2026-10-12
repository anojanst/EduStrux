CREATE TABLE `families` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`name_norm` text NOT NULL,
	`branch_id` text NOT NULL,
	`address` text,
	`billing_guardian_id` text
);
--> statement-breakpoint
CREATE INDEX `families_org_name_idx` ON `families` (`org_id`,`name_norm`,`id`);--> statement-breakpoint
CREATE INDEX `families_org_branch_idx` ON `families` (`org_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `guardians` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`family_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`first_name_norm` text NOT NULL,
	`last_name_norm` text NOT NULL,
	`relationship` text,
	`email` text,
	`phone` text,
	`preferred_channel` text DEFAULT 'email' NOT NULL,
	`language` text,
	`emergency_contact` integer DEFAULT true NOT NULL,
	`membership_id` text
);
--> statement-breakpoint
CREATE INDEX `guardians_org_family_idx` ON `guardians` (`org_id`,`family_id`);--> statement-breakpoint
CREATE INDEX `guardians_org_membership_idx` ON `guardians` (`org_id`,`membership_id`);--> statement-breakpoint
CREATE TABLE `student_grades` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`student_id` text NOT NULL,
	`academic_year_id` text NOT NULL,
	`grade_level_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_grades_org_student_year_uq` ON `student_grades` (`org_id`,`student_id`,`academic_year_id`) WHERE "student_grades"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `student_grades_org_year_grade_idx` ON `student_grades` (`org_id`,`academic_year_id`,`grade_level_id`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`family_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`first_name_norm` text NOT NULL,
	`last_name_norm` text NOT NULL,
	`date_of_birth` text,
	`notes` text
);
--> statement-breakpoint
CREATE INDEX `students_org_name_idx` ON `students` (`org_id`,`last_name_norm`,`first_name_norm`,`id`);--> statement-breakpoint
CREATE INDEX `students_org_family_idx` ON `students` (`org_id`,`family_id`);