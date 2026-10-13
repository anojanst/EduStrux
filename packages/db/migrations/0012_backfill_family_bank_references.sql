-- Every family has a bank reference from creation (TUI-37). Give the families added before that
-- theirs, worked out the same way: the last 8 characters of the family's id, in capitals.
UPDATE `families` SET `bank_reference` = upper(substr(`id`, -8)) WHERE `bank_reference` IS NULL;
