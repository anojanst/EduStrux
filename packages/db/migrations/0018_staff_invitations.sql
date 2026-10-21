ALTER TABLE `invitations` ADD `guardian_id` text;--> statement-breakpoint
CREATE INDEX `invitations_org_guardian_idx` ON `invitations` (`org_id`,`guardian_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_org_id_uq` ON `memberships` (`org_id`,`id`);