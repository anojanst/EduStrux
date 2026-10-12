CREATE TABLE `enrolments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`price_override_amount` integer,
	`price_override_currency` text,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `enrolments_org_class_idx` ON `enrolments` (`org_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `enrolments_org_student_idx` ON `enrolments` (`org_id`,`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `enrolments_org_student_class_active_uq` ON `enrolments` (`org_id`,`student_id`,`class_id`) WHERE "enrolments"."deleted_at" is null and "enrolments"."status" = 'active';