CREATE TABLE `price_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`course_id` text,
	`class_id` text,
	`branch_id` text,
	`basis` text NOT NULL,
	`price_amount` integer NOT NULL,
	`price_currency` text NOT NULL,
	`pack_lessons` integer,
	`free_trial_lessons` integer DEFAULT 0 NOT NULL,
	`tax_rate_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_rules_org_target_term_uq` ON `price_rules` (`org_id`,(case when "class_id" is null then '' else "class_id" end),(case when "course_id" is null then '' else "course_id" end)) WHERE "price_rules"."deleted_at" is null and "price_rules"."basis" <> 'per_month';--> statement-breakpoint
CREATE UNIQUE INDEX `price_rules_org_target_no_term_uq` ON `price_rules` (`org_id`,(case when "class_id" is null then '' else "class_id" end),(case when "course_id" is null then '' else "course_id" end)) WHERE "price_rules"."deleted_at" is null and "price_rules"."basis" <> 'per_term';--> statement-breakpoint
ALTER TABLE `tax_rates` ADD `is_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `tax_rates_org_default_uq` ON `tax_rates` (`org_id`) WHERE "tax_rates"."deleted_at" is null and "tax_rates"."is_default" = 1;