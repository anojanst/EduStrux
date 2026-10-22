import type { DiscountKind } from '@edustrux/shared';
import { divRound, type DateRange } from './invoicing';

// What discounts an invoice run gives (TUI-58), as plain arithmetic: no database, no clock.

/** A discount rule as a run reads it. */
export type DiscountRuleData = {
  id: string;
  name: string;
  kind: DiscountKind;
  percentBps: number | null;
  amount: number | null;
  fixedPrice: number | null;
  minCount: number | null;
  courseIds: string[] | null;
  studentIds: string[] | null;
  familyIds: string[] | null;
  cutoffDate: string | null;
  termId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
};

/** One charge a run is about to put on an invoice, before tax. */
export type Billable = {
  enrolmentId: string;
  studentId: string;
  familyId: string;
  courseId: string;
  /** In minor units, before tax and before any discount. */
  charge: number;
  /** The local date the enrolment was made, for an early-bird discount. */
  enrolledOn: string;
};

export type Applied = { ruleId: string; name: string; amount: number };
export type LineDiscounts = { amount: number; applied: Applied[] };

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** What a percentage or an amount takes off one charge. */
function off(rule: DiscountRuleData, charge: number) {
  if (rule.percentBps !== null) return divRound(charge * rule.percentBps, 10_000);
  return Math.min(rule.amount ?? 0, charge);
}

/** Splits `total` across the charges in proportion, whole units, the remainder to the last. */
function spread(total: number, charges: number[]) {
  const sum = charges.reduce((a, b) => a + b, 0);
  if (sum === 0) return charges.map(() => 0);
  const parts = charges.map((charge) => Math.floor((total * charge) / sum));
  parts[parts.length - 1]! += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

/**
 * The discounts each charge gets, by enrolment id. Rules apply in id order, each on the charge
 * before discounts, and together they take off at most the whole charge. A bundle's lines don't
 * also get a multi-class discount (D-079), and a line is in one bundle at most.
 */
export function applyDiscounts(
  rules: DiscountRuleData[],
  lines: Billable[],
  run: { termId: string | null; period: DateRange },
): Map<string, LineDiscounts> {
  const result = new Map<string, LineDiscounts>();
  const give = (line: Billable, rule: DiscountRuleData, amount: number) => {
    const current = result.get(line.enrolmentId) ?? { amount: 0, applied: [] };
    const room = line.charge - current.amount;
    const taken = Math.min(amount, room);
    if (taken <= 0) return;
    current.amount += taken;
    current.applied.push({ ruleId: rule.id, name: rule.name, amount: taken });
    result.set(line.enrolmentId, current);
  };

  const live = rules
    .filter(
      (rule) =>
        rule.active &&
        (rule.startsOn === null || run.period.endDate >= rule.startsOn) &&
        (rule.endsOn === null || run.period.startDate <= rule.endsOn),
    )
    .sort(byId);
  const groupBy = <K>(key: (line: Billable) => K) => {
    const groups = new Map<K, Billable[]>();
    for (const line of lines) groups.set(key(line), [...(groups.get(key(line)) ?? []), line]);
    return groups;
  };
  const byStudent = groupBy((line) => line.studentId);
  const byFamily = groupBy((line) => line.familyId);
  /** The lines a bundle priced: they don't count towards a multi-class discount. */
  const bundled = new Set<string>();
  const dearestFirst = (a: Billable, b: Billable) =>
    b.charge - a.charge || (a.enrolmentId < b.enrolmentId ? -1 : 1);

  for (const rule of live.filter((r) => r.kind === 'bundle')) {
    const courses = new Set(rule.courseIds ?? []);
    for (const own of byStudent.values()) {
      const inBundle = own.filter((l) => courses.has(l.courseId) && !bundled.has(l.enrolmentId));
      if (new Set(inBundle.map((l) => l.courseId)).size < courses.size) continue;
      for (const line of inBundle) bundled.add(line.enrolmentId);
      if (rule.fixedPrice !== null) {
        const total = inBundle.reduce((sum, l) => sum + l.charge, 0);
        const parts = spread(
          Math.max(0, total - rule.fixedPrice),
          inBundle.map((l) => l.charge),
        );
        inBundle.forEach((line, i) => give(line, rule, parts[i]!));
      } else {
        for (const line of inBundle) give(line, rule, off(rule, line.charge));
      }
    }
  }

  for (const rule of live) {
    const min = rule.minCount ?? 2;
    switch (rule.kind) {
      case 'sibling':
        for (const family of byFamily.values()) {
          const totals = new Map<string, number>();
          for (const l of family)
            totals.set(l.studentId, (totals.get(l.studentId) ?? 0) + l.charge);
          if (totals.size < min) continue;
          const [first] = [...totals].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
          for (const line of family) {
            if (line.studentId !== first![0]) give(line, rule, off(rule, line.charge));
          }
        }
        break;
      case 'multi_class':
        for (const own of byStudent.values()) {
          const counted = own.filter((l) => !bundled.has(l.enrolmentId)).sort(dearestFirst);
          if (counted.length < min) continue;
          for (const line of counted.slice(1)) give(line, rule, off(rule, line.charge));
        }
        break;
      case 'early_bird':
        if (rule.termId !== null && rule.termId !== run.termId) break;
        for (const line of lines) {
          if (line.enrolledOn <= rule.cutoffDate!) give(line, rule, off(rule, line.charge));
        }
        break;
      case 'scholarship':
        for (const line of lines) {
          if (rule.studentIds?.includes(line.studentId)) give(line, rule, off(rule, line.charge));
        }
        break;
      case 'manual':
        for (const line of lines) {
          if (rule.familyIds?.includes(line.familyId)) give(line, rule, off(rule, line.charge));
        }
        break;
      case 'bundle':
        break;
    }
  }
  return result;
}
