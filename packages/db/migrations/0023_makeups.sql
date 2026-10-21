CREATE TABLE `makeup_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`credit_id` text NOT NULL,
	`student_id` text NOT NULL,
	`session_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `makeup_bookings_org_id_uq` ON `makeup_bookings` (`org_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `makeup_bookings_org_session_student_uq` ON `makeup_bookings` (`org_id`,`session_id`,`student_id`) WHERE "makeup_bookings"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `makeup_bookings_org_credit_uq` ON `makeup_bookings` (`org_id`,`credit_id`) WHERE "makeup_bookings"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `makeup_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`student_id` text NOT NULL,
	`session_id` text NOT NULL,
	`class_id` text NOT NULL,
	`course_id` text NOT NULL,
	`missed_on` text NOT NULL,
	`expires_on` text,
	`status` text DEFAULT 'available' NOT NULL,
	`booking_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `makeup_credits_org_id_uq` ON `makeup_credits` (`org_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `makeup_credits_org_session_student_uq` ON `makeup_credits` (`org_id`,`session_id`,`student_id`) WHERE "makeup_credits"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `makeup_credits_org_student_idx` ON `makeup_credits` (`org_id`,`student_id`,`id`);--> statement-breakpoint
CREATE INDEX `makeup_credits_org_status_idx` ON `makeup_credits` (`org_id`,`status`,`expires_on`);--> statement-breakpoint
CREATE TABLE `makeup_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`enabled` integer DEFAULT false NOT NULL,
	`credit_for_excused` integer DEFAULT true NOT NULL,
	`credit_for_absent` integer DEFAULT false NOT NULL,
	`require_notice` integer DEFAULT true NOT NULL,
	`expiry_days` integer,
	`same_course_only` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `makeup_policies_org_uq` ON `makeup_policies` (`org_id`) WHERE "makeup_policies"."deleted_at" is null;