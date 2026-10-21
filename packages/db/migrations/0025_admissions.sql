CREATE TABLE `enquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`branch_id` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`student_name` text,
	`message` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`ip_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enquiries_org_id_uq` ON `enquiries` (`org_id`,`id`);--> statement-breakpoint
CREATE INDEX `enquiries_org_status_idx` ON `enquiries` (`org_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `enquiries_org_ip_idx` ON `enquiries` (`org_id`,`ip_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `enrolment_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`branch_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`guardian` text NOT NULL,
	`students` text NOT NULL,
	`notes` text,
	`ip_hash` text,
	`decided_by_user_id` text,
	`decided_at` text,
	`reason` text,
	`result` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrolment_requests_org_id_uq` ON `enrolment_requests` (`org_id`,`id`);--> statement-breakpoint
CREATE INDEX `enrolment_requests_org_status_idx` ON `enrolment_requests` (`org_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `enrolment_requests_org_ip_idx` ON `enrolment_requests` (`org_id`,`ip_hash`,`created_at`);