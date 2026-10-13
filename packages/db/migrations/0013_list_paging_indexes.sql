DROP INDEX `invoices_org_family_idx`;--> statement-breakpoint
DROP INDEX `invoices_org_status_idx`;--> statement-breakpoint
DROP INDEX `invoices_org_term_idx`;--> statement-breakpoint
DROP INDEX `invoices_org_month_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_org_id_uq` ON `invoices` (`org_id`,`id`);--> statement-breakpoint
CREATE INDEX `invoices_org_family_idx` ON `invoices` (`org_id`,`family_id`,`id`);--> statement-breakpoint
CREATE INDEX `invoices_org_status_idx` ON `invoices` (`org_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `invoices_org_term_idx` ON `invoices` (`org_id`,`term_id`,`id`);--> statement-breakpoint
CREATE INDEX `invoices_org_month_idx` ON `invoices` (`org_id`,`month`,`id`);--> statement-breakpoint
DROP INDEX `classes_org_branch_idx`;--> statement-breakpoint
DROP INDEX `classes_org_teacher_idx`;--> statement-breakpoint
DROP INDEX `classes_org_term_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `classes_org_id_uq` ON `classes` (`org_id`,`id`);--> statement-breakpoint
CREATE INDEX `classes_org_course_idx` ON `classes` (`org_id`,`course_id`,`id`);--> statement-breakpoint
CREATE INDEX `classes_org_branch_idx` ON `classes` (`org_id`,`branch_id`,`id`);--> statement-breakpoint
CREATE INDEX `classes_org_teacher_idx` ON `classes` (`org_id`,`teacher_membership_id`,`id`);--> statement-breakpoint
CREATE INDEX `classes_org_term_idx` ON `classes` (`org_id`,`term_id`,`id`);--> statement-breakpoint
DROP INDEX `enrolments_org_class_idx`;--> statement-breakpoint
DROP INDEX `enrolments_org_student_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `enrolments_org_id_uq` ON `enrolments` (`org_id`,`id`);--> statement-breakpoint
CREATE INDEX `enrolments_org_class_idx` ON `enrolments` (`org_id`,`class_id`,`id`);--> statement-breakpoint
CREATE INDEX `enrolments_org_student_idx` ON `enrolments` (`org_id`,`student_id`,`id`);--> statement-breakpoint
DROP INDEX `rooms_org_branch_idx`;--> statement-breakpoint
CREATE INDEX `rooms_org_branch_idx` ON `rooms` (`org_id`,`branch_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `branches_org_id_uq` ON `branches` (`org_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `courses_org_id_uq` ON `courses` (`org_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_org_id_uq` ON `subjects` (`org_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tax_rates_org_id_uq` ON `tax_rates` (`org_id`,`id`);