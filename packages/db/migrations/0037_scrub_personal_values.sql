-- D-171 (TUI-115, TUI-116). Hand-written data migration: drizzle-kit has nothing to generate.
-- 1. An absence notice's free-text reason becomes the fixed `other`.
UPDATE `absence_notices` SET `reason` = 'other' WHERE `reason` IS NOT NULL AND `reason` NOT IN ('sick', 'holiday', 'other');
--> statement-breakpoint
-- 2. The audit log keeps that a personal field changed, not its value: each value that isn't
-- null becomes "changed", as `PERSONAL_AUDIT_FIELDS` in apps/api/src/db/scope.ts now writes it,
-- plus the fields dropped in 0036. Each statement can run again harmlessly.
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.name', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'family' AND json_valid(`before`) AND json_type(`before`, '$.name') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.nameNorm', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'family' AND json_valid(`before`) AND json_type(`before`, '$.nameNorm') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.address', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'family' AND json_valid(`before`) AND json_type(`before`, '$.address') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.name', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'family' AND json_valid(`after`) AND json_type(`after`, '$.name') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.nameNorm', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'family' AND json_valid(`after`) AND json_type(`after`, '$.nameNorm') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.address', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'family' AND json_valid(`after`) AND json_type(`after`, '$.address') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.firstName', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`before`) AND json_type(`before`, '$.firstName') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.lastName', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`before`) AND json_type(`before`, '$.lastName') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.firstNameNorm', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`before`) AND json_type(`before`, '$.firstNameNorm') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.lastNameNorm', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`before`) AND json_type(`before`, '$.lastNameNorm') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.email', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`before`) AND json_type(`before`, '$.email') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.phone', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`before`) AND json_type(`before`, '$.phone') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.phoneNorm', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`before`) AND json_type(`before`, '$.phoneNorm') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.relationship', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`before`) AND json_type(`before`, '$.relationship') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.language', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`before`) AND json_type(`before`, '$.language') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.firstName', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`after`) AND json_type(`after`, '$.firstName') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.lastName', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`after`) AND json_type(`after`, '$.lastName') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.firstNameNorm', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`after`) AND json_type(`after`, '$.firstNameNorm') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.lastNameNorm', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`after`) AND json_type(`after`, '$.lastNameNorm') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.email', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`after`) AND json_type(`after`, '$.email') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.phone', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`after`) AND json_type(`after`, '$.phone') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.phoneNorm', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`after`) AND json_type(`after`, '$.phoneNorm') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.relationship', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`after`) AND json_type(`after`, '$.relationship') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.language', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'guardian' AND json_valid(`after`) AND json_type(`after`, '$.language') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.firstName', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'student' AND json_valid(`before`) AND json_type(`before`, '$.firstName') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.lastName', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'student' AND json_valid(`before`) AND json_type(`before`, '$.lastName') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.firstNameNorm', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'student' AND json_valid(`before`) AND json_type(`before`, '$.firstNameNorm') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.lastNameNorm', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'student' AND json_valid(`before`) AND json_type(`before`, '$.lastNameNorm') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.dateOfBirth', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'student' AND json_valid(`before`) AND json_type(`before`, '$.dateOfBirth') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.notes', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'student' AND json_valid(`before`) AND json_type(`before`, '$.notes') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.firstName', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'student' AND json_valid(`after`) AND json_type(`after`, '$.firstName') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.lastName', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'student' AND json_valid(`after`) AND json_type(`after`, '$.lastName') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.firstNameNorm', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'student' AND json_valid(`after`) AND json_type(`after`, '$.firstNameNorm') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.lastNameNorm', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'student' AND json_valid(`after`) AND json_type(`after`, '$.lastNameNorm') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.dateOfBirth', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'student' AND json_valid(`after`) AND json_type(`after`, '$.dateOfBirth') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.notes', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'student' AND json_valid(`after`) AND json_type(`after`, '$.notes') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.name', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enquiry' AND json_valid(`before`) AND json_type(`before`, '$.name') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.email', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enquiry' AND json_valid(`before`) AND json_type(`before`, '$.email') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.phone', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enquiry' AND json_valid(`before`) AND json_type(`before`, '$.phone') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.studentName', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enquiry' AND json_valid(`before`) AND json_type(`before`, '$.studentName') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.message', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enquiry' AND json_valid(`before`) AND json_type(`before`, '$.message') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.name', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enquiry' AND json_valid(`after`) AND json_type(`after`, '$.name') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.email', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enquiry' AND json_valid(`after`) AND json_type(`after`, '$.email') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.phone', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enquiry' AND json_valid(`after`) AND json_type(`after`, '$.phone') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.studentName', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enquiry' AND json_valid(`after`) AND json_type(`after`, '$.studentName') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.message', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enquiry' AND json_valid(`after`) AND json_type(`after`, '$.message') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.guardian', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enrolment_request' AND json_valid(`before`) AND json_type(`before`, '$.guardian') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.students', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enrolment_request' AND json_valid(`before`) AND json_type(`before`, '$.students') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `before` = json_replace(`before`, '$.notes', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enrolment_request' AND json_valid(`before`) AND json_type(`before`, '$.notes') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.guardian', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enrolment_request' AND json_valid(`after`) AND json_type(`after`, '$.guardian') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.students', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enrolment_request' AND json_valid(`after`) AND json_type(`after`, '$.students') NOT IN ('null');
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_replace(`after`, '$.notes', 'changed') WHERE substr(`action`, 1, instr(`action`, '.') - 1) = 'enrolment_request' AND json_valid(`after`) AND json_type(`after`, '$.notes') NOT IN ('null');
--> statement-breakpoint
-- A session's lesson notes are a list inside its row: `{ notes: [{ studentId, note }] }`.
UPDATE `audit_log` SET `before` = json_set(`before`, '$.notes', json((SELECT json_group_array(CASE WHEN json_type(`value`, '$.note') NOT IN ('null') THEN json_replace(`value`, '$.note', 'changed') ELSE json(`value`) END) FROM json_each(`audit_log`.`before`, '$.notes')))) WHERE `action` = 'lesson_notes.updated' AND json_valid(`before`) AND json_type(`before`, '$.notes') = 'array';
--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_set(`after`, '$.notes', json((SELECT json_group_array(CASE WHEN json_type(`value`, '$.note') NOT IN ('null') THEN json_replace(`value`, '$.note', 'changed') ELSE json(`value`) END) FROM json_each(`audit_log`.`after`, '$.notes')))) WHERE `action` = 'lesson_notes.updated' AND json_valid(`after`) AND json_type(`after`, '$.notes') = 'array';
