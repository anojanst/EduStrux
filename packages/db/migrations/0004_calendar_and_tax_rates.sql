CREATE TABLE `academic_years` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `academic_years_org_start_idx` ON `academic_years` (`org_id`,`start_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `academic_years_org_name_uq` ON `academic_years` (`org_id`,lower("name")) WHERE "academic_years"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `holidays` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`branch_id` text
);
--> statement-breakpoint
CREATE INDEX `holidays_org_start_idx` ON `holidays` (`org_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `tax_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`rate_bps` integer NOT NULL,
	`inclusive` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_rates_org_name_uq` ON `tax_rates` (`org_id`,lower("name")) WHERE "tax_rates"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `terms` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`academic_year_id` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `terms_org_start_idx` ON `terms` (`org_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `terms_org_year_idx` ON `terms` (`org_id`,`academic_year_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `terms_org_year_name_uq` ON `terms` (`org_id`,`academic_year_id`,lower("name")) WHERE "terms"."deleted_at" is null;