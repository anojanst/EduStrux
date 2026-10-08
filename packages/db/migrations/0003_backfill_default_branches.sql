-- Every org has a branch from creation (TUI-27). Give orgs created before that a "Main" branch.
-- The branch id reuses the org's ULID, so it's unique and sorts by the org's creation time.
INSERT INTO `branches` (`id`, `org_id`, `name`, `address`, `created_at`, `updated_at`, `deleted_at`)
SELECT 'brn_' || substr(o.`id`, 5), o.`id`, 'Main', NULL, o.`created_at`, o.`created_at`, NULL
FROM `orgs` o
WHERE NOT EXISTS (
  SELECT 1 FROM `branches` b WHERE b.`org_id` = o.`id` AND b.`deleted_at` IS NULL
);
