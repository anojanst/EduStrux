import {
  basisFitsClass,
  newId,
  type CreatePriceRule,
  type CreateTaxRate,
  type PriceRule,
  type TaxRate,
  type UpdatePriceRule,
  type UpdateTaxRate,
} from '@edustrux/shared';
import type { Access, OrgCtx } from '../../db/scope';
import {
  conflict,
  forbidden,
  notFound,
  staleData,
  unprocessable,
  validationFailed,
} from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import * as classes from '../classes/service';
import * as curriculum from '../curriculum/service';
import * as orgs from '../orgs/service';
import { priceResolver } from './pricing';
import * as repo from './repository';

export function toTaxRate(row: repo.TaxRateRow): TaxRate {
  const { orgId: _org, deletedAt: _deleted, ...rate } = row;
  return rate;
}

const nameTaken = () => conflict('A tax rate with that name already exists', { name: ['Taken'] });

/** An org with no tax rates charges no tax: that's a valid setup. */
export async function listTaxRates(ctx: OrgCtx, limit: number, cursor?: string) {
  const rows = await repo.listTaxRates(ctx, limit, decodeCursor(cursor));
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toTaxRate), nextCursor };
}

async function findTaxRateOr404(ctx: OrgCtx, id: string) {
  const row = await repo.findTaxRate(ctx, id);
  if (!row) throw notFound('Tax rate');
  return row;
}

async function getTaxRate(ctx: OrgCtx, id: string): Promise<TaxRate> {
  return toTaxRate(await findTaxRateOr404(ctx, id));
}

export async function createTaxRate(ctx: OrgCtx, input: CreateTaxRate): Promise<TaxRate> {
  if (await repo.taxRateNameTaken(ctx, input.name)) throw nameTaken();

  const id = newId('taxRate');
  await repo.insertTaxRate(ctx, {
    id,
    orgId: ctx.orgId,
    name: input.name,
    rateBps: input.rateBps,
    inclusive: input.inclusive,
    isDefault: input.isDefault,
  });
  return getTaxRate(ctx, id);
}

export async function updateTaxRate(
  ctx: OrgCtx,
  id: string,
  input: UpdateTaxRate,
): Promise<TaxRate> {
  const before = await findTaxRateOr404(ctx, id);
  if (before.updatedAt !== input.updatedAt) throw staleData();
  const { updatedAt: _ignored, ...changes } = input;
  if (Object.keys(changes).length === 0) return toTaxRate(before);

  if (changes.name !== undefined && (await repo.taxRateNameTaken(ctx, changes.name, id))) {
    throw nameTaken();
  }

  await repo.updateTaxRate(ctx, before, changes);
  return getTaxRate(ctx, id);
}

/** Refused while a price rule names this rate. Deleting the default leaves the org with none. */
export async function deleteTaxRate(ctx: OrgCtx, id: string): Promise<void> {
  const before = await findTaxRateOr404(ctx, id);
  const ruleCount = await repo.countPriceRules(ctx, { taxRateId: id });
  if (ruleCount > 0) {
    throw unprocessable(`${ruleCount} price rule(s) use this tax rate. Change them first.`);
  }
  await repo.softDeleteTaxRate(ctx, before);
}

// ── Price rules ─────────────────────────────────────────────────────────────

export function toPriceRule(row: repo.PriceRuleRow): PriceRule {
  const {
    orgId: _org,
    deletedAt: _deleted,
    branchId: _branch,
    priceAmount: amount,
    priceCurrency: currency,
    ...rule
  } = row;
  return { ...rule, price: { amount, currency } };
}

/**
 * Price rules belong to no family, so a parent's `billing:read` (their own invoices) doesn't
 * cover them. Staff limited to some branches reach every rule but other branches' class rules.
 */
function reachOf(access: Access): repo.PriceRuleReach {
  if (access.scope === 'own') throw forbidden();
  return access.scope === 'branch' && access.branchIds ? { branchIds: access.branchIds } : {};
}

export async function listPriceRules(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  filter: Pick<repo.PriceRuleFilter, 'classId' | 'courseId'>,
) {
  const reach = reachOf(access);
  if (filter.courseId) await curriculum.getCourse(ctx, filter.courseId);
  if (filter.classId) await classes.getClass(ctx, access, filter.classId);
  const rows = await repo.listPriceRules(ctx, limit, decodeCursor(cursor), filter, reach);
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toPriceRule), nextCursor };
}

async function findPriceRuleOr404(ctx: OrgCtx, id: string, reach: repo.PriceRuleReach) {
  const row = await repo.findPriceRule(ctx, id, reach);
  if (!row) throw notFound('Price rule');
  return row;
}

/** The columns a price is stored in. It must be in the org's currency. */
async function priceColumns(ctx: OrgCtx, price: CreatePriceRule['price']) {
  const org = await orgs.getOrg(ctx);
  if (price.currency !== org.currency) {
    throw validationFailed({
      'price.currency': [`Must be the organisation's currency, ${org.currency}`],
    });
  }
  return { priceAmount: price.amount, priceCurrency: price.currency };
}

/**
 * A rule prices one class, one course's classes, or every class in the org. A class's rule must
 * be on a basis that class is billed on, and a target can't have two rules that would both
 * price the same class.
 */
export async function createPriceRule(
  ctx: OrgCtx,
  access: Access,
  input: CreatePriceRule,
): Promise<PriceRule> {
  const reach = reachOf(access);
  const klass = input.classId != null ? await classes.getClass(ctx, access, input.classId) : null;
  if (input.courseId != null) await curriculum.getCourse(ctx, input.courseId);
  if (input.taxRateId != null) await findTaxRateOr404(ctx, input.taxRateId);
  const price = await priceColumns(ctx, input.price);

  if (klass && !basisFitsClass(input.basis, klass.termId !== null)) {
    throw unprocessable(
      klass.termId !== null
        ? 'A class in a term is billed per term, so it has no monthly price.'
        : 'A class with no term is billed monthly, so it has no price per term.',
      { basis: [klass.termId !== null ? 'The class is in a term' : 'The class has no term'] },
    );
  }
  const target = { classId: klass?.id ?? null, courseId: input.courseId ?? null };
  if (await repo.priceRuleTaken(ctx, target, input.basis)) {
    throw conflict('A price rule already covers these classes.', { _: ['Taken'] });
  }

  const id = newId('priceRule');
  await repo.insertPriceRule(ctx, {
    id,
    orgId: ctx.orgId,
    ...target,
    branchId: klass?.branchId ?? null,
    basis: input.basis,
    ...price,
    packLessons: input.packLessons ?? null,
    freeTrialLessons: input.freeTrialLessons,
    taxRateId: input.taxRateId ?? null,
  });
  return toPriceRule(await findPriceRuleOr404(ctx, id, reach));
}

/** A rule keeps what it prices and its basis; the price, pack size, trial and tax can change. */
export async function updatePriceRule(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdatePriceRule,
): Promise<PriceRule> {
  const reach = reachOf(access);
  const before = await findPriceRuleOr404(ctx, id, reach);
  if (before.updatedAt !== input.updatedAt) throw staleData();

  const { updatedAt: _ignored, price, ...rest } = input;
  if (rest.packLessons !== undefined && before.basis !== 'pack') {
    throw validationFailed({ packLessons: ['Only a pack has lessons'] });
  }
  if (rest.taxRateId != null) await findTaxRateOr404(ctx, rest.taxRateId);
  const changes: repo.PriceRuleChanges = { ...rest };
  if (price !== undefined) Object.assign(changes, await priceColumns(ctx, price));
  if (Object.keys(changes).length === 0) return toPriceRule(before);

  await repo.updatePriceRule(ctx, before, changes);
  return toPriceRule(await findPriceRuleOr404(ctx, id, reach));
}

export async function deletePriceRule(ctx: OrgCtx, access: Access, id: string): Promise<void> {
  await repo.softDeletePriceRule(ctx, await findPriceRuleOr404(ctx, id, reachOf(access)));
}

// ── What other modules ask about prices ─────────────────────────────────────

/** How many price rules a class or a course has. Neither can be deleted while it has any. */
export function countPriceRules(
  ctx: OrgCtx,
  filter: Pick<repo.PriceRuleFilter, 'classId' | 'courseId'>,
) {
  return repo.countPriceRules(ctx, filter);
}

/**
 * Reads the org's price rules and default tax rate once, and returns a function that prices one
 * enrolment after another: what invoice generation needs for a whole term or month.
 */
export async function loadPricing(ctx: OrgCtx) {
  const [rules, defaultRate] = await Promise.all([
    repo.allPriceRules(ctx),
    repo.findDefaultTaxRate(ctx),
  ]);
  return priceResolver(rules, defaultRate?.id ?? null);
}
