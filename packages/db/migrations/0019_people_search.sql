ALTER TABLE `guardians` ADD `phone_norm` text;--> statement-breakpoint
CREATE INDEX `guardians_org_name_idx` ON `guardians` (`org_id`,`last_name_norm`,`first_name_norm`,`id`);--> statement-breakpoint
CREATE INDEX `guardians_org_first_name_idx` ON `guardians` (`org_id`,`first_name_norm`);--> statement-breakpoint
CREATE INDEX `guardians_org_email_idx` ON `guardians` (`org_id`,`email`);--> statement-breakpoint
CREATE INDEX `guardians_org_phone_idx` ON `guardians` (`org_id`,`phone_norm`);--> statement-breakpoint
CREATE INDEX `students_org_first_name_idx` ON `students` (`org_id`,`first_name_norm`);