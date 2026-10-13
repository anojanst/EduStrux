CREATE TABLE `invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`invoice_id` text NOT NULL,
	`enrolment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`period_key` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`basis` text NOT NULL,
	`unit_amount` integer NOT NULL,
	`quantity` integer NOT NULL,
	`lessons` integer NOT NULL,
	`period_lessons` integer,
	`free_lessons` integer DEFAULT 0 NOT NULL,
	`price_source` text,
	`price_rule_id` text,
	`price_overridden` integer DEFAULT false NOT NULL,
	`tax_rate_id` text,
	`tax_name` text,
	`tax_rate_bps` integer,
	`tax_inclusive` integer,
	`subtotal_amount` integer NOT NULL,
	`tax_amount` integer NOT NULL,
	`total_amount` integer NOT NULL,
	`voided_at` text
);
--> statement-breakpoint
CREATE INDEX `invoice_lines_org_invoice_idx` ON `invoice_lines` (`org_id`,`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_lines_org_enrolment_period_uq` ON `invoice_lines` (`org_id`,`enrolment_id`,`period_key`) WHERE "invoice_lines"."deleted_at" is null and "invoice_lines"."voided_at" is null;--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`family_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`term_id` text,
	`month` text,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`currency` text NOT NULL,
	`subtotal_amount` integer NOT NULL,
	`tax_amount` integer NOT NULL,
	`total_amount` integer NOT NULL,
	`bank_reference` text,
	`due_date` text,
	`notes` text,
	`issued_at` text,
	`voided_at` text,
	`job_id` text
);
--> statement-breakpoint
CREATE INDEX `invoices_org_family_idx` ON `invoices` (`org_id`,`family_id`);--> statement-breakpoint
CREATE INDEX `invoices_org_status_idx` ON `invoices` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `invoices_org_term_idx` ON `invoices` (`org_id`,`term_id`);--> statement-breakpoint
CREATE INDEX `invoices_org_month_idx` ON `invoices` (`org_id`,`month`);--> statement-breakpoint
CREATE INDEX `invoices_org_job_idx` ON `invoices` (`org_id`,`job_id`);--> statement-breakpoint
ALTER TABLE `families` ADD `bank_reference` text;--> statement-breakpoint
CREATE UNIQUE INDEX `families_org_bank_reference_uq` ON `families` (`org_id`,`bank_reference`) WHERE "families"."bank_reference" is not null;