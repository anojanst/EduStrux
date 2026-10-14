CREATE TABLE `payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`payment_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_allocations_org_payment_invoice_uq` ON `payment_allocations` (`org_id`,`payment_id`,`invoice_id`) WHERE "payment_allocations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `payment_allocations_org_invoice_idx` ON `payment_allocations` (`org_id`,`invoice_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`family_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`received_on` text NOT NULL,
	`reference` text,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_org_id_uq` ON `payments` (`org_id`,`id`);--> statement-breakpoint
CREATE INDEX `payments_org_family_idx` ON `payments` (`org_id`,`family_id`,`id`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `paid_amount` integer DEFAULT 0 NOT NULL;