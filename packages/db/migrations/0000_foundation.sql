CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before` text,
	`after` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_org_id_idx` ON `audit_log` (`org_id`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_org_entity_idx` ON `audit_log` (`org_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`status_code` integer,
	`response_body` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_keys_scope_key_uq` ON `idempotency_keys` (`scope`,`key`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`branch_ids` text,
	`token_hash` text NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text
);
--> statement-breakpoint
CREATE INDEX `invitations_org_email_idx` ON `invitations` (`org_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_uq` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`input` text,
	`result` text,
	`error` text,
	`created_by_user_id` text
);
--> statement-breakpoint
CREATE INDEX `jobs_org_status_idx` ON `jobs` (`org_id`,`status`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`branch_ids` text,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_org_user_uq` ON `memberships` (`org_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`country` text,
	`currency` text NOT NULL,
	`timezone` text NOT NULL,
	`locale` text NOT NULL,
	`date_format` text NOT NULL,
	`single_tutor_mode` integer DEFAULT false NOT NULL,
	`brand_color` text,
	`tax_number` text,
	`plan` text DEFAULT 'trial' NOT NULL,
	`status` text DEFAULT 'trialing' NOT NULL,
	`trial_ends_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orgs_slug_uq` ON `orgs` (`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`clerk_user_id` text NOT NULL,
	`email` text,
	`name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_clerk_user_id_uq` ON `users` (`clerk_user_id`);