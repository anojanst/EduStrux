import { basisFitsClass, type MoneyValue, type PriceBasis } from '@edustrux/shared';
import type { PriceRuleRow } from './repository';

/** What pricing needs to know about one enrolment. */
export type PricedEnrolment = {
  classId: string;
  courseId: string;
  /** The class's term. null = no term, so the class is billed monthly. */
  termId: string | null;
  /** The course's default price. */
  defaultPrice: MoneyValue | null;
  /** The enrolment's price override. */
  priceOverride: MoneyValue | null;
};

export type ResolvedPrice = {
  /** What to charge for one `basis`. */
  price: MoneyValue;
  basis: PriceBasis;
  /** Lessons in one pack, when the basis is `pack`. */
  packLessons: number | null;
  /** The first lessons of the enrolment that aren't charged. */
  freeTrialLessons: number;
  /** The rule's tax rate, else the org's default. null = no tax. */
  taxRateId: string | null;
  /** Where the usual price came from. null = nothing prices the class: only the override does. */
  source: 'class_rule' | 'course_rule' | 'course_default' | 'org_rule' | null;
  priceRuleId: string | null;
  /** true = `price` is the enrolment's override, not the usual price. */
  overridden: boolean;
};

type UsualPrice = Omit<ResolvedPrice, 'overridden'>;

/**
 * Prices enrolments from an org's price rules. The most specific price wins: the class's own
 * rule, then its course's rule, then the course's default price, then the org-wide rule. A
 * course's default price is for one billing period of the class: a term, or a month for a class
 * with no term. An enrolment's override replaces the amount and keeps everything else, the basis
 * included. null = the enrolment has no price at all.
 */
export function priceResolver(rules: PriceRuleRow[], defaultTaxRateId: string | null) {
  const fromRule = (rule: PriceRuleRow, source: UsualPrice['source']): UsualPrice => ({
    price: { amount: rule.priceAmount, currency: rule.priceCurrency },
    basis: rule.basis,
    packLessons: rule.packLessons,
    freeTrialLessons: rule.freeTrialLessons,
    taxRateId: rule.taxRateId ?? defaultTaxRateId,
    source,
    priceRuleId: rule.id,
  });

  const usualPrice = (e: PricedEnrolment): UsualPrice | null => {
    const inTerm = e.termId !== null;
    const period: PriceBasis = inTerm ? 'per_term' : 'per_month';
    const fits = (rule: PriceRuleRow) => basisFitsClass(rule.basis, inTerm);

    const classRule = rules.find((r) => r.classId === e.classId && fits(r));
    if (classRule) return fromRule(classRule, 'class_rule');
    const courseRule = rules.find((r) => r.courseId === e.courseId && fits(r));
    if (courseRule) return fromRule(courseRule, 'course_rule');
    if (e.defaultPrice) {
      return {
        price: e.defaultPrice,
        basis: period,
        packLessons: null,
        freeTrialLessons: 0,
        taxRateId: defaultTaxRateId,
        source: 'course_default',
        priceRuleId: null,
      };
    }
    const orgRule = rules.find((r) => r.classId === null && r.courseId === null && fits(r));
    if (orgRule) return fromRule(orgRule, 'org_rule');
    return null;
  };

  return (e: PricedEnrolment): ResolvedPrice | null => {
    const usual = usualPrice(e);
    if (!e.priceOverride) return usual && { ...usual, overridden: false };
    return {
      ...(usual ?? {
        basis: e.termId !== null ? 'per_term' : 'per_month',
        packLessons: null,
        freeTrialLessons: 0,
        taxRateId: defaultTaxRateId,
        source: null,
        priceRuleId: null,
      }),
      price: e.priceOverride,
      overridden: true,
    };
  };
}
