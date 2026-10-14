-- Custom SQL migration file, put your code below! --
-- A payment allocation goes only to an invoice of the same org that is issued or part paid, and
-- an invoice's allocations never add up to more than its total (TUI-38). The service checks both
-- before it writes. This holds them when two payments for the same invoice are recorded at once:
-- the second batch fails as a whole, payment and audit row included.
CREATE TRIGGER `payment_allocations_guard`
BEFORE INSERT ON `payment_allocations`
WHEN NEW.`deleted_at` IS NULL AND NOT EXISTS (
  SELECT 1 FROM `invoices` AS i
  WHERE i.`org_id` = NEW.`org_id` AND i.`id` = NEW.`invoice_id` AND i.`deleted_at` IS NULL
    AND i.`status` IN ('issued', 'part_paid')
    AND NEW.`amount` > 0
    AND i.`total_amount` >= NEW.`amount` + (
      SELECT coalesce(sum(a.`amount`), 0) FROM `payment_allocations` AS a
      WHERE a.`org_id` = NEW.`org_id` AND a.`invoice_id` = NEW.`invoice_id`
        AND a.`deleted_at` IS NULL
    )
)
BEGIN
  SELECT RAISE(ABORT, 'payment_allocation_rejected');
END;
