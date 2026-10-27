ALTER TABLE `invoices` ADD `number` integer;--> statement-breakpoint
-- Invoices issued before numbers existed are numbered in the order they were issued (D-173).
UPDATE `invoices` SET `number` = (
  SELECT `n` FROM (
    SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `org_id` ORDER BY `issued_at`, `id`) AS `n`
    FROM `invoices` WHERE `issued_at` IS NOT NULL
  ) AS `numbered` WHERE `numbered`.`id` = `invoices`.`id`
) WHERE `issued_at` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_org_number_uq` ON `invoices` (`org_id`,`number`);
