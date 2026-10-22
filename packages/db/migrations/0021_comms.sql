CREATE TABLE `message_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`message_id` text NOT NULL,
	`family_id` text NOT NULL,
	`guardian_id` text NOT NULL,
	`email` text,
	`email_status` text,
	`provider_id` text,
	`error` text,
	`sent_at` text,
	`delivered_at` text
);
--> statement-breakpoint
CREATE INDEX `message_recipients_org_message_idx` ON `message_recipients` (`org_id`,`message_id`,`id`);--> statement-breakpoint
CREATE INDEX `message_recipients_org_family_idx` ON `message_recipients` (`org_id`,`family_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_templates_org_id_uq` ON `message_templates` (`org_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_templates_org_name_uq` ON `message_templates` (`org_id`,lower("name")) WHERE "message_templates"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`kind` text NOT NULL,
	`event` text,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`audience` text NOT NULL,
	`channels` text NOT NULL,
	`template_id` text,
	`sent_by_user_id` text,
	`sent_by_membership_id` text,
	`recipient_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_org_id_uq` ON `messages` (`org_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_org_sender_idx` ON `messages` (`org_id`,`sent_by_membership_id`,`id`);--> statement-breakpoint
CREATE TABLE `notification_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`session_changes` integer DEFAULT true NOT NULL,
	`invoice_issued` integer DEFAULT true NOT NULL,
	`overdue_reminders` integer DEFAULT true NOT NULL,
	`overdue_reminder_days` text NOT NULL,
	`reminder_hour` integer DEFAULT 9 NOT NULL,
	`reply_to_email` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_settings_org_uq` ON `notification_settings` (`org_id`) WHERE "notification_settings"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_source_event_uq` ON `webhook_events` (`source`,`event_id`);