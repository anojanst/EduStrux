ALTER TABLE `org_subscriptions` RENAME COLUMN "paddle_subscription_id" TO "stripe_subscription_id";--> statement-breakpoint
ALTER TABLE `org_subscriptions` RENAME COLUMN "paddle_customer_id" TO "stripe_customer_id";--> statement-breakpoint
DROP INDEX `org_subscriptions_paddle_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `org_subscriptions_stripe_uq` ON `org_subscriptions` (`stripe_subscription_id`);