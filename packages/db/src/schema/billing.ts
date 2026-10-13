import { PRICE_BASES } from '@edustrux/shared';
import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { orgColumns } from '../columns';

// How classes are priced. A rule prices one class, one course's classes, or (course_id and
// class_id both null) every class in the org. The most specific one that fits a class wins.
export const priceRules = sqliteTable(
  'price_rules',
  {
    ...orgColumns(),
    courseId: text('course_id'),
    classId: text('class_id'),
    // Copied from the class, which keeps its branch for life, so what branch staff reach is a
    // filter on this table. null for a course's rule and an org-wide one.
    branchId: text('branch_id'),
    // per_term only fits a class in a term and per_month a class with no term.
    basis: text('basis', { enum: PRICE_BASES }).notNull(),
    // Minor units plus currency, for one `basis`.
    priceAmount: integer('price_amount').notNull(),
    priceCurrency: text('price_currency').notNull(),
    // Lessons in one pack. Set only when basis = 'pack'.
    packLessons: integer('pack_lessons'),
    // The first lessons of an enrolment that aren't charged.
    freeTrialLessons: integer('free_trial_lessons').notNull().default(0),
    // null = the org's default tax rate.
    taxRateId: text('tax_rate_id'),
  },
  (t) => {
    // "No class" and "no course" are indexed as '' (NULLs are distinct in a unique index),
    // written with CASE because drizzle-kit splits an index expression at its commas.
    const target = [
      t.orgId,
      sql`(case when ${t.classId} is null then '' else ${t.classId} end)`,
      sql`(case when ${t.courseId} is null then '' else ${t.courseId} end)`,
    ] as const;
    return [
      // One target has at most one rule that fits a class in a term, and at most one that fits
      // a class with no term. A per_lesson or pack rule fits both, so it is in both indexes.
      uniqueIndex('price_rules_org_target_term_uq')
        .on(...target)
        .where(sql`${t.deletedAt} is null and ${t.basis} <> 'per_month'`),
      uniqueIndex('price_rules_org_target_no_term_uq')
        .on(...target)
        .where(sql`${t.deletedAt} is null and ${t.basis} <> 'per_term'`),
    ];
  },
);
