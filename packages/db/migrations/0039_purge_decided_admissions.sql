ALTER TABLE `enquiries` ADD `purged_at` text;--> statement-breakpoint
ALTER TABLE `enrolment_requests` ADD `purged_at` text;--> statement-breakpoint
ALTER TABLE `message_recipients` DROP COLUMN `email`;--> statement-breakpoint
-- Requests a family erase already cleared (TUI-79) count as purged.
UPDATE `enrolment_requests` SET `purged_at` = `updated_at` WHERE `guardian` = '{}';