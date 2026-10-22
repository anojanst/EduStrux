CREATE TABLE `org_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`paddle_subscription_id` text NOT NULL,
	`paddle_customer_id` text NOT NULL,
	`plan` text NOT NULL,
	`interval` text,
	`status` text NOT NULL,
	`current_period_end` text,
	`cancel_at` text,
	`event_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_subscriptions_paddle_uq` ON `org_subscriptions` (`paddle_subscription_id`);--> statement-breakpoint
CREATE INDEX `org_subscriptions_org_idx` ON `org_subscriptions` (`org_id`,`id`);