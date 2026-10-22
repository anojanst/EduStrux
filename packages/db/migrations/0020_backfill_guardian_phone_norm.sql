-- Custom SQL migration file, put your code below! --
-- Fills `guardians.phone_norm` for the guardians added before it existed (TUI-43). A phone holds
-- only digits, spaces and + ( ) . - (the API's rule), so taking those out leaves the digits, as
-- `normalisePhone()` does.
UPDATE `guardians`
SET `phone_norm` = nullif(
  replace(replace(replace(replace(replace(replace(`phone`, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', ''),
  ''
)
WHERE `phone` IS NOT NULL;
