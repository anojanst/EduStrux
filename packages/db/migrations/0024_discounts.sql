CREATE TABLE `discount_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`percent_bps` integer,
	`amount` integer,
	`fixed_price` integer,
	`currency` text,
	`min_count` integer,
	`course_ids` text,
	`student_ids` text,
	`family_ids` text,
	`cutoff_date` text,
	`term_id` text,
	`starts_on` text,
	`ends_on` text,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discount_rules_org_id_uq` ON `discount_rules` (`org_id`,`id`);--> statement-breakpoint
ALTER TABLE `invoice_lines` ADD `discount_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_lines` ADD `discounts` text;