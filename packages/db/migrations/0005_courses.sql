CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`subject_id` text NOT NULL,
	`grade_level_id` text NOT NULL,
	`curriculum` text,
	`teaching_medium` text,
	`default_price_amount` integer,
	`default_price_currency` text,
	`duration_minutes` integer
);
--> statement-breakpoint
CREATE INDEX `courses_org_grade_idx` ON `courses` (`org_id`,`grade_level_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `courses_org_subject_grade_curriculum_medium_uq` ON `courses` (`org_id`,`subject_id`,`grade_level_id`,(case when "curriculum" is null then '' else lower("curriculum") end),(case when "teaching_medium" is null then '' else lower("teaching_medium") end)) WHERE "courses"."deleted_at" is null;