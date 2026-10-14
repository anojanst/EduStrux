import {
  basisFitsClass,
  newId,
  type CreatePriceRule,
  type CreateTaxRate,
  type Invoice,
  type InvoiceLine,
  type InvoiceStatus,
  type PriceRule,
  type TaxRate,
  type UpdateInvoice,
  type UpdatePriceRule,
  type UpdateTaxRate,
} from '@edustrux/shared';
import type { Access, Ids, OrgCtx } from '../../db/scope';
import {
  conflict,
  forbidden,
  notFound,
  staleData,
  unprocessable,
  validationFailed,
} from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import * as branches from '../branches/service';
import * as calendar from '../calendar/service';
import * as classes from '../classes/service';
import * as curriculum from '../curriculum/service';
import * as orgs from '../orgs/service';
import { familyWithinReach } from '../people/for-billing';
import * as people from '../people/service';
import { priceResolver } from './pricing';
import * as repo from './repository';

// Every function here waits for D1 once to read and, if it writes, once more to write (D-102).
// Reads that don't need each other's answers are sent together with `Promise.all`. The checks on
// what they found then run in the order they always have, so the same error is reported when
// several apply. A write answers with what was read before it and the row the write returned,
// not with a second read.

/** What another module's check found, or the error it threw, kept until its turn comes. */
type Held<T> = { value: T } | { error: unknown };

/**
 * Sends another module's check now and keeps what it throws for later. `orThrow` then judges it
 * where the check used to run, after every check that came before it.
 */
const held = <T>(check: Promise<T>): Promise<Held<T>> =>
  check.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

function orThrow<T>(answer: Held<T>): T {
  if ('error' in answer) throw answer.error;
  return answer.value;
}

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

// ── Invoices ────────────────────────────────────────────────────────────────

type StudentName = { firstName: string; lastName: string };
type ClassLabel = { name: string; courseId: string };
type FamilyLabel = { name: string; branchId: string };

/** A line is read with the names of the student and the class it charges for. */
export function toInvoiceLine(
  row: repo.InvoiceLineRow,
  currency: string,
  student: StudentName,
  klass: ClassLabel,
): InvoiceLine {
  const money = (amount: number) => ({ amount, currency });
  return {
    id: row.id,
    enrolmentId: row.enrolmentId,
    studentId: row.studentId,
    studentFirstName: student.firstName,
    studentLastName: student.lastName,
    classId: row.classId,
    className: klass.name,
    courseId: klass.courseId,
    basis: row.basis,
    unitPrice: money(row.unitAmount),
    quantity: row.quantity,
    lessons: row.lessons,
    periodLessons: row.periodLessons,
    freeLessons: row.freeLessons,
    priceSource: row.priceSource,
    priceRuleId: row.priceRuleId,
    priceOverridden: row.priceOverridden,
    taxRateId: row.taxRateId,
    taxName: row.taxName,
    taxRateBps: row.taxRateBps,
    taxInclusive: row.taxInclusive,
    subtotal: money(row.subtotalAmount),
    tax: money(row.taxAmount),
    total: money(row.totalAmount),
  };
}

export function toInvoice(
  row: repo.InvoiceRow,
  family: FamilyLabel,
  lines: InvoiceLine[],
): Invoice {
  const money = (amount: number) => ({ amount, currency: row.currency });
  return {
    id: row.id,
    familyId: row.familyId,
    familyName: family.name,
    branchId: family.branchId,
    status: row.status,
    termId: row.termId,
    month: row.month,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    bankReference: row.bankReference,
    dueDate: row.dueDate,
    notes: row.notes,
    subtotal: money(row.subtotalAmount),
    tax: money(row.taxAmount),
    total: money(row.totalAmount),
    lines,
    issuedAt: row.issuedAt,
    voidedAt: row.voidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * A role's scope as a filter on invoices. An invoice goes with its family: branch staff reach
 * the invoices of the families whose home branch is one of theirs, whichever branch the classes
 * on them are in. A parent reaches their own family's invoices once they have been issued. It
 * costs no database trip: the families are a query, not ids read first (D-104).
 */
function invoiceReach(ctx: OrgCtx, access: Access): repo.InvoiceReach {
  switch (access.scope) {
    case 'all':
      return {};
    case 'branch':
      return access.branchIds
        ? { familyIds: people.familiesInBranches(ctx, access.branchIds) }
        : {};
    case 'own':
      return { familyIds: people.familiesOfGuardian(ctx, access.membershipId), issuedOnly: true };
  }
}

type Labels = {
  families: Map<string, FamilyLabel>;
  students: Map<string, StudentName>;
  classes: Map<string, ClassLabel>;
};

/**
 * What invoices show of other modules: each family's name and home branch, and the student and
 * the class named on each line. Each `ids` can be a query for what the caller's own read
 * returns, so a caller that sends that read in the same `Promise.all` waits for D1 once (D-104).
 */
async function labelsFor(
  ctx: OrgCtx,
  familyIds: Ids,
  studentIds: Ids,
  classIds: Ids,
): Promise<Labels> {
  const [families, students, labels] = await Promise.all([
    people.familyLabels(ctx, familyIds),
    people.studentNames(ctx, studentIds),
    classes.classLabels(ctx, classIds),
  ]);
  return { families, students, classes: labels };
}

/** Whether every invoice and every line found what it shows of other modules. */
const labelled = (rows: repo.InvoiceRow[], lines: repo.InvoiceLineRow[], labels: Labels) =>
  rows.every((row) => labels.families.has(row.familyId)) &&
  lines.every((l) => labels.students.has(l.studentId) && labels.classes.has(l.classId));

/** Invoices as the API returns them, each with its own lines out of `lines`. */
function withLines(
  rows: repo.InvoiceRow[],
  lines: repo.InvoiceLineRow[],
  labels: Labels,
): Invoice[] {
  // A family, a student or a class can't be deleted while it has enrolments, and an invoice
  // only ever bills enrolments, so all three are always found.
  return rows.map((row) =>
    toInvoice(
      row,
      labels.families.get(row.familyId)!,
      lines
        .filter((l) => l.invoiceId === row.id)
        .map((l) =>
          toInvoiceLine(
            l,
            row.currency,
            labels.students.get(l.studentId)!,
            labels.classes.get(l.classId)!,
          ),
        ),
    ),
  );
}

/**
 * One stage: the page, its lines and what they show of other modules are read together, with
 * the checks on the filters. A filter the org doesn't have is still reported in the order the
 * checks always ran in.
 */
export async function listInvoices(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  query: {
    familyId?: string;
    branchId?: string;
    termId?: string;
    month?: string;
    status?: InvoiceStatus;
  },
) {
  const reach = invoiceReach(ctx, access);
  const { branchId, ...rest } = query;
  // An invoice goes with its family's home branch, so a branch is a filter on families.
  const filter: repo.InvoiceFilter = {
    ...rest,
    familyIds: branchId ? people.familiesInBranches(ctx, [branchId]) : undefined,
  };
  const page = [limit, decodeCursor(cursor), filter, reach] as const;

  const [family, term, branch, { rows, lines }, beside] = await Promise.all([
    filter.familyId ? familyWithinReach(ctx, access, filter.familyId) : true,
    filter.termId ? held(calendar.getTerm(ctx, filter.termId)) : undefined,
    branchId ? held(branches.getBranch(ctx, branchId)) : undefined,
    repo.listInvoicesWithLines(ctx, ...page),
    labelsFor(
      ctx,
      repo.familiesOnPage(ctx, ...page),
      repo.studentsOnLines(ctx, repo.invoicesOnPage(ctx, ...page)),
      repo.classesOnLines(ctx, repo.invoicesOnPage(ctx, ...page)),
    ),
  ]);
  if (!family) throw notFound('Family');
  if (term) orThrow(term);
  if (branch) orThrow(branch);

  const { data, nextCursor } = toPage(rows, limit);
  // The labels are read for a query of the page, beside the page. An invoice added in that
  // moment moves what the query finds, so if any label is missing they are read by the ids.
  const labels = labelled(data, lines, beside)
    ? beside
    : await labelsFor(
        ctx,
        [...new Set(data.map((row) => row.familyId))],
        [...new Set(lines.map((l) => l.studentId))],
        [...new Set(lines.map((l) => l.classId))],
      );
  return { data: withLines(data, lines, labels), nextCursor };
}

/**
 * One invoice within reach, with its lines and what they show of other modules, read together:
 * one stage. Every read carries the caller's reach, so for an invoice outside it nothing is
 * found. `as` is the invoice as the API returns it, for the row read or the row a write
 * returned: a write changes nothing the lines or the labels show.
 */
async function readInvoice(ctx: OrgCtx, access: Access, id: string) {
  const reach = invoiceReach(ctx, access);
  const found = () => repo.invoiceWithin(ctx, id, reach);
  const [row, lines, labels] = await Promise.all([
    repo.findInvoice(ctx, id, reach),
    repo.listLines(ctx, found()),
    labelsFor(
      ctx,
      repo.familyOfInvoice(ctx, id, reach),
      repo.studentsOnLines(ctx, found()),
      repo.classesOnLines(ctx, found()),
    ),
  ]);
  if (!row) throw notFound('Invoice');
  return { row, as: (invoice: repo.InvoiceRow) => withLines([invoice], lines, labels)[0]! };
}

export async function getInvoice(ctx: OrgCtx, access: Access, id: string): Promise<Invoice> {
  const { row, as } = await readInvoice(ctx, access, id);
  return as(row);
}

/** Only the due date and the note change. The lines are fixed: void the invoice and run again. */
export async function updateInvoice(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdateInvoice,
): Promise<Invoice> {
  const { row: before, as } = await readInvoice(ctx, access, id);
  if (before.updatedAt !== input.updatedAt) throw staleData();
  const { updatedAt: _ignored, ...changes } = input;
  if (Object.keys(changes).length === 0) return as(before);
  if (before.status === 'void') {
    throw unprocessable("A void invoice can't be changed.", { status: ['Void'] });
  }

  const updated = await repo.updateInvoice(ctx, before, changes);
  if (!updated) throw notFound('Invoice');
  return as(updated);
}

/** A draft becomes issued: from then on its family's parents can see it. */
export async function issueInvoice(ctx: OrgCtx, access: Access, id: string): Promise<Invoice> {
  const { row: before, as } = await readInvoice(ctx, access, id);
  if (before.status !== 'draft') {
    throw unprocessable('Only a draft invoice can be issued.', { status: ['Not a draft'] });
  }
  const issued = await repo.issueInvoice(ctx, before);
  // No row came back: another request issued it between the read and the write. The answer is
  // still the invoice as it now is, which takes a read.
  return issued ? as(issued) : getInvoice(ctx, access, id);
}

/**
 * A draft or an issued invoice can be voided. Its enrolments can then be invoiced for the period
 * again. One with payments on it can't: the payments have to come off first.
 */
export async function voidInvoice(ctx: OrgCtx, access: Access, id: string): Promise<Invoice> {
  const { row: before, as } = await readInvoice(ctx, access, id);
  if (before.status === 'void') {
    throw unprocessable('This invoice is already void.', { status: ['Already void'] });
  }
  if (before.status !== 'draft' && before.status !== 'issued') {
    throw unprocessable("An invoice with payments on it can't be voided.", {
      status: ['Has payments'],
    });
  }
  const voided = await repo.voidInvoice(ctx, before);
  if (!voided) throw notFound('Invoice');
  return as(voided);
}
