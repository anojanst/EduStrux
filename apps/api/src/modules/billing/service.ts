import {
  MAX_REPORT_DAYS,
  addDays,
  basisFitsClass,
  diffDays,
  discountRuleIssues,
  localToUtc,
  utcToLocal,
  type MoneyReport,
  formatDate,
  formatMoney,
  localNow,
  newId,
  type CreatePayment,
  type CreateDiscountRule,
  type CreatePriceRule,
  type DiscountRule,
  type CreateTaxRate,
  type Invoice,
  type InvoiceAdjustment,
  type InvoiceLine,
  type InvoiceStatus,
  type Payment,
  type PriceRule,
  type TaxRate,
  type UpdateDiscountRule,
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
import { familyLabelWithinReach, familyWithinReach } from '../people/for-billing';
import * as people from '../people/service';
import { priceResolver } from './pricing';
import type { EmailMessage } from '../../background/messages';
import { t } from '../../email/catalog';
import * as comms from '../comms/service';
import type { DiscountRuleData } from './discounts';
import { chargeAgain } from './invoicing';
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

export async function createTaxRate(ctx: OrgCtx, input: CreateTaxRate): Promise<TaxRate> {
  if (await repo.taxRateNameTaken(ctx, input.name)) throw nameTaken();

  const row = await repo.insertTaxRate(ctx, {
    id: newId('taxRate'),
    orgId: ctx.orgId,
    name: input.name,
    rateBps: input.rateBps,
    inclusive: input.inclusive,
    isDefault: input.isDefault,
  });
  return toTaxRate(row);
}

export async function updateTaxRate(
  ctx: OrgCtx,
  id: string,
  input: UpdateTaxRate,
): Promise<TaxRate> {
  const { updatedAt, ...changes } = input;
  // The name check needs nothing from the rate's row, so both reads go to D1 together.
  const [before, taken] = await Promise.all([
    repo.findTaxRate(ctx, id),
    changes.name !== undefined ? repo.taxRateNameTaken(ctx, changes.name, id) : false,
  ]);
  if (!before) throw notFound('Tax rate');
  if (before.updatedAt !== updatedAt) throw staleData();
  if (Object.keys(changes).length === 0) return toTaxRate(before);
  if (taken) throw nameTaken();

  const updated = await repo.updateTaxRate(ctx, before, changes);
  if (!updated) throw notFound('Tax rate');
  return toTaxRate(updated);
}

/** Refused while a price rule names this rate. Deleting the default leaves the org with none. */
export async function deleteTaxRate(ctx: OrgCtx, id: string): Promise<void> {
  const [before, ruleCount] = await Promise.all([
    repo.findTaxRate(ctx, id),
    repo.countPriceRules(ctx, { taxRateId: id }),
  ]);
  if (!before) throw notFound('Tax rate');
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

/**
 * Org-wide and course rules price classes in every branch, so only the owner writes them
 * (D-111). Branch staff write the rules of their own branches' classes, which the class check
 * holds them to, even with no branch list.
 */
function checkRuleWriter(access: Access, rule: { classId: string | null }) {
  if (access.scope !== 'all' && rule.classId === null) {
    throw forbidden('Only the owner sets org-wide and course price rules.');
  }
}

/** One stage: the course and the class a filter names are checked beside the page. */
export async function listPriceRules(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  filter: Pick<repo.PriceRuleFilter, 'classId' | 'courseId'>,
) {
  const reach = reachOf(access);
  const [course, klass, rows] = await Promise.all([
    filter.courseId ? held(curriculum.getCourse(ctx, filter.courseId)) : undefined,
    filter.classId ? held(classes.getClass(ctx, access, filter.classId)) : undefined,
    repo.listPriceRules(ctx, limit, decodeCursor(cursor), filter, reach),
  ]);
  if (course) orThrow(course);
  if (klass) orThrow(klass);
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toPriceRule), nextCursor };
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
  reachOf(access); // A parent reaches no price rule: 403 before anything is read.
  // What the rule would price is known from the request. So whether the caller may write a rule
  // for it is checked before anything is read, and whether that target already has a rule is
  // read beside the class, the course and the tax rate it names.
  const target = { classId: input.classId ?? null, courseId: input.courseId ?? null };
  checkRuleWriter(access, target);
  const [found, course, taxRate, taken] = await Promise.all([
    input.classId != null ? held(classes.getClass(ctx, access, input.classId)) : undefined,
    input.courseId != null ? held(curriculum.getCourse(ctx, input.courseId)) : undefined,
    input.taxRateId != null ? repo.findTaxRate(ctx, input.taxRateId) : undefined,
    repo.priceRuleTaken(ctx, target, input.basis),
  ]);
  const klass = found ? orThrow(found) : null;
  if (course) orThrow(course);
  if (input.taxRateId != null && !taxRate) throw notFound('Tax rate');
  const price = await priceColumns(ctx, input.price);

  if (klass && !basisFitsClass(input.basis, klass.termId !== null)) {
    throw unprocessable(
      klass.termId !== null
        ? 'A class in a term is billed per term, so it has no monthly price.'
        : 'A class with no term is billed monthly, so it has no price per term.',
      { basis: [klass.termId !== null ? 'The class is in a term' : 'The class has no term'] },
    );
  }
  if (taken) throw conflict('A price rule already covers these classes.', { _: ['Taken'] });

  // The caller reaches the rule they add: a class's rule is in that class's branch, which the
  // class check above held them to, and every other rule has no branch.
  const row = await repo.insertPriceRule(ctx, {
    id: newId('priceRule'),
    orgId: ctx.orgId,
    ...target,
    branchId: klass?.branchId ?? null,
    basis: input.basis,
    ...price,
    packLessons: input.packLessons ?? null,
    freeTrialLessons: input.freeTrialLessons,
    taxRateId: input.taxRateId ?? null,
  });
  return toPriceRule(row);
}

/** A rule keeps what it prices and its basis; the price, pack size, trial and tax can change. */
export async function updatePriceRule(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdatePriceRule,
): Promise<PriceRule> {
  const reach = reachOf(access);
  const { updatedAt, price, ...rest } = input;
  const [before, taxRate] = await Promise.all([
    repo.findPriceRule(ctx, id, reach),
    rest.taxRateId != null ? repo.findTaxRate(ctx, rest.taxRateId) : undefined,
  ]);
  if (!before) throw notFound('Price rule');
  checkRuleWriter(access, before);
  if (before.updatedAt !== updatedAt) throw staleData();

  if (rest.packLessons !== undefined && before.basis !== 'pack') {
    throw validationFailed({ packLessons: ['Only a pack has lessons'] });
  }
  if (rest.taxRateId != null && !taxRate) throw notFound('Tax rate');
  const changes: repo.PriceRuleChanges = { ...rest };
  if (price !== undefined) Object.assign(changes, await priceColumns(ctx, price));
  if (Object.keys(changes).length === 0) return toPriceRule(before);

  const updated = await repo.updatePriceRule(ctx, before, changes);
  if (!updated) throw notFound('Price rule');
  return toPriceRule(updated);
}

export async function deletePriceRule(ctx: OrgCtx, access: Access, id: string): Promise<void> {
  const before = await repo.findPriceRule(ctx, id, reachOf(access));
  if (!before) throw notFound('Price rule');
  checkRuleWriter(access, before);
  await repo.softDeletePriceRule(ctx, before);
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
    discount: money(row.discountAmount),
    discounts: (row.discounts ?? []).map((d) => ({
      ruleId: d.ruleId,
      name: d.name,
      amount: money(d.amount),
    })),
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
    paid: money(row.paidAmount),
    balance: money(row.status === 'void' ? 0 : row.totalAmount - row.paidAmount),
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

/**
 * A draft becomes issued: from then on its family's parents can see it, and, when the org's
 * notification settings say so, its guardians are sent it (TUI-70).
 */
export async function issueInvoice(
  ctx: OrgCtx,
  access: Access,
  id: string,
  queue?: Queue<EmailMessage>,
): Promise<Invoice> {
  const { row: before, as } = await readInvoice(ctx, access, id);
  if (before.status !== 'draft') {
    throw unprocessable('Only a draft invoice can be issued.', { status: ['Not a draft'] });
  }
  const issued = await repo.issueInvoice(ctx, before);
  // No row came back: another request issued it between the read and the write. The answer is
  // still the invoice as it now is, which takes a read.
  if (!issued) return getInvoice(ctx, access, id);
  const invoice = as(issued);
  if (queue) await tellFamily(ctx, queue, invoice);
  return invoice;
}

/** Queues the automatic message for an issued invoice. It costs the request no database call. */
async function tellFamily(ctx: OrgCtx, queue: Queue<EmailMessage>, invoice: Invoice) {
  const org = await orgs.getOrg(ctx);
  const total = formatMoney(invoice.total, org.locale);
  await comms.queueNotice(ctx, queue, {
    event: 'invoice_issued',
    subject: t('invoice.issued.subject', { orgName: org.name, total }),
    body: t('invoice.issued.body', {
      familyName: invoice.familyName,
      total,
      due: invoice.dueDate
        ? t('invoice.issued.due', { dueDate: formatDate(invoice.dueDate, org.dateFormat) })
        : '',
      bankReference: invoice.bankReference ?? '',
    }),
    familyIds: [invoice.familyId],
    audience: { type: 'custom', ids: [invoice.familyId] },
  });
}

/**
 * A draft or an issued invoice can be voided. Its enrolments can then be invoiced for the period
 * again. One with payments on it can't: the payments have to come off first.
 */
export async function voidInvoice(ctx: OrgCtx, access: Access, id: string): Promise<Invoice> {
  const { row: before, as } = await readInvoice(ctx, access, id);
  const refused = cannotVoid(before);
  if (refused) throw refused;
  const voided = await repo.voidInvoice(ctx, before);
  if (voided) return as(voided);
  // It changed between the read and the write, and the write left it alone: a payment came in,
  // or another request voided it. The answer is why, which takes a read.
  const { row: now } = await readInvoice(ctx, access, id);
  throw cannotVoid(now) ?? notFound('Invoice');
}

function cannotVoid(invoice: repo.InvoiceRow) {
  if (invoice.status === 'void') {
    return unprocessable('This invoice is already void.', { status: ['Already void'] });
  }
  if (invoice.status !== 'draft' && invoice.status !== 'issued') {
    return unprocessable("An invoice with payments on it can't be voided.", {
      status: ['Has payments'],
    });
  }
  return undefined;
}

// ── Payments ────────────────────────────────────────────────────────────────

export function toPayment(
  row: repo.PaymentRow,
  family: FamilyLabel,
  allocations: repo.AllocationRow[],
): Payment {
  const money = (amount: number) => ({ amount, currency: row.currency });
  return {
    id: row.id,
    familyId: row.familyId,
    familyName: family.name,
    branchId: family.branchId,
    method: row.method,
    amount: money(row.amount),
    receivedOn: row.receivedOn,
    reference: row.reference,
    notes: row.notes,
    // Oldest invoice first, as they are read: ids made in the same moment don't sort by it.
    allocations: allocations
      .toSorted((a, b) => (a.invoiceId < b.invoiceId ? -1 : 1))
      .map((a) => ({ invoiceId: a.invoiceId, amount: money(a.amount) })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * A payment goes with its family, as an invoice does (D-096): branch staff reach the payments of
 * the families whose home branch is theirs, and a parent their own family's. No trip (D-104).
 */
function paymentReach(ctx: OrgCtx, access: Access): repo.PaymentReach {
  const { familyIds } = invoiceReach(ctx, access);
  return familyIds ? { familyIds } : {};
}

/**
 * One stage: the page, its allocations and its families' names are read together, with the
 * checks on the filters. A family or an invoice outside the caller's reach is 404.
 */
export async function listPayments(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  filter: repo.PaymentFilter,
) {
  const reach = paymentReach(ctx, access);
  const page = [limit, decodeCursor(cursor), filter, reach] as const;

  const [family, invoice, { rows, allocations }, beside] = await Promise.all([
    filter.familyId ? familyWithinReach(ctx, access, filter.familyId) : true,
    filter.invoiceId ? repo.findInvoice(ctx, filter.invoiceId, invoiceReach(ctx, access)) : true,
    repo.listPaymentsWithAllocations(ctx, ...page),
    people.familyLabels(ctx, repo.familiesOfPaymentPage(ctx, ...page)),
  ]);
  if (!family) throw notFound('Family');
  if (!invoice) throw notFound('Invoice');

  const { data, nextCursor } = toPage(rows, limit);
  // The names are read for a query of the page, beside the page. A payment recorded in that
  // moment moves what the query finds, so if a name is missing they are read by the ids.
  const families = data.every((row) => beside.has(row.familyId))
    ? beside
    : await people.familyLabels(ctx, [...new Set(data.map((row) => row.familyId))]);
  return {
    data: data.map((row) =>
      toPayment(
        row,
        families.get(row.familyId)!,
        allocations.filter((a) => a.paymentId === row.id),
      ),
    ),
    nextCursor,
  };
}

/**
 * Records money a family paid, towards one or more of its issued or part-paid invoices. Each
 * invoice moves to `part_paid` or `paid` in the same write. One read stage, one write.
 */
export async function createPayment(
  ctx: OrgCtx,
  access: Access,
  input: CreatePayment,
): Promise<Payment> {
  const [family, found] = await Promise.all([
    familyLabelWithinReach(ctx, access, input.familyId),
    repo.findInvoices(
      ctx,
      input.allocations.map((a) => a.invoiceId),
      invoiceReach(ctx, access),
    ),
  ]);
  if (!family) throw notFound('Family');
  const invoices = new Map(found.map((row) => [row.id, row]));
  if (input.allocations.some((a) => !invoices.has(a.invoiceId))) throw notFound('Invoice');

  const org = await orgs.getOrg(ctx);
  if (input.amount.currency !== org.currency) {
    throw validationFailed({
      'amount.currency': [`Must be the organisation's currency, ${org.currency}`],
    });
  }
  const today = localNow(org.timezone).date;
  const receivedOn = input.receivedOn ?? today;
  if (receivedOn > today) throw validationFailed({ receivedOn: ['Can’t be after today'] });

  // Every reason an invoice can't take its part, for every invoice at once.
  const refused: Record<string, string[]> = {};
  input.allocations.forEach((allocation, i) => {
    const invoice = invoices.get(allocation.invoiceId)!;
    const at = `allocations.${i}`;
    if (invoice.familyId !== input.familyId) {
      refused[`${at}.invoiceId`] = ['Another family’s invoice'];
    } else if (invoice.status === 'draft') {
      refused[`${at}.invoiceId`] = ['Not issued'];
    } else if (invoice.status === 'void') {
      refused[`${at}.invoiceId`] = ['Void'];
    } else if (invoice.status === 'paid') {
      refused[`${at}.invoiceId`] = ['Already paid'];
    } else if (invoice.currency !== allocation.amount.currency) {
      refused[`${at}.amount.currency`] = [`Must be the invoice's currency, ${invoice.currency}`];
    } else if (allocation.amount.amount > invoice.totalAmount - invoice.paidAmount) {
      refused[`${at}.amount`] = ['More than is owed'];
    }
  });
  if (Object.keys(refused).length > 0) {
    throw unprocessable('Some invoices can’t take this payment.', refused);
  }

  const paymentId = newId('payment');
  try {
    const { payment, allocations } = await repo.insertPayment(
      ctx,
      {
        id: paymentId,
        orgId: ctx.orgId,
        familyId: input.familyId,
        method: input.method,
        amount: input.amount.amount,
        currency: input.amount.currency,
        receivedOn,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
      },
      input.allocations.map((a) => ({
        id: newId('paymentAllocation'),
        orgId: ctx.orgId,
        paymentId,
        invoiceId: a.invoiceId,
        amount: a.amount.amount,
      })),
    );
    return toPayment(payment, family, allocations);
  } catch (error) {
    // An invoice was paid, or stopped taking payments, between the read and the write.
    if (repo.allocationRejected(error)) throw staleData();
    throw error;
  }
}

/** Takes a payment off: its invoices go back to what the other payments leave them at. */
export async function deletePayment(ctx: OrgCtx, access: Access, id: string): Promise<void> {
  const reach = paymentReach(ctx, access);
  const [before, allocations] = await Promise.all([
    repo.findPayment(ctx, id, reach),
    repo.listAllocations(ctx, repo.paymentWithin(ctx, id, reach)),
  ]);
  if (!before) throw notFound('Payment');
  await repo.softDeletePayment(ctx, before, allocations);
}

// ── An enrolment's new dates (TUI-46) ───────────────────────────────────────

/** An enrolment's lines on invoices that aren't void, each with its invoice. */
export function linesOfEnrolment(ctx: OrgCtx, enrolmentId: string) {
  return repo.linesOfEnrolment(ctx, enrolmentId);
}
export type EnrolmentLine = Awaited<ReturnType<typeof linesOfEnrolment>>[number];

/**
 * What an enrolment's new dates do to its invoices, pro rata by lessons (D-086), at the price
 * each line was charged at (D-093). A draft's line is charged again, or taken off when no lesson
 * is left, with statements for the caller's batch; a draft left with no lines is voided. An
 * issued invoice's lines are fixed (D-095), so they are only reported, with what they would
 * charge now. Pack lines are left alone: packs are bought up front. `lessonDates` are the class's
 * lessons in every period the lines cover.
 */
export function adjustForDates(
  ctx: OrgCtx,
  lines: EnrolmentLine[],
  enrolment: { startDate: string; endDate: string | null },
  lessonDates: string[],
) {
  const statements: ReturnType<typeof repo.rechargeDraftLine> = [];
  const adjustments: InvoiceAdjustment[] = [];
  const left = new Map(lines.map(({ invoice }) => [invoice.id, invoice.lines]));
  for (const { line, invoice } of lines) {
    if (line.basis === 'pack') continue;
    const charge = chargeAgain(line, enrolment, lessonDates);
    const lessonsAfter = charge?.lessons ?? 0;
    const totalAfter = charge?.total ?? 0;
    if (lessonsAfter === line.lessons && totalAfter === line.totalAmount) continue;
    const draft = invoice.status === 'draft';
    let status = invoice.status;
    if (draft) {
      const remaining = (left.get(invoice.id) ?? 1) - (charge ? 0 : 1);
      left.set(invoice.id, remaining);
      if (remaining === 0) status = 'void';
      statements.push(...repo.rechargeDraftLine(ctx, line, charge, remaining === 0));
    }
    adjustments.push({
      invoiceId: invoice.id,
      invoiceLineId: line.id,
      invoiceStatus: status,
      adjusted: draft,
      lessonsBefore: line.lessons,
      lessonsAfter,
      before: { amount: line.totalAmount, currency: invoice.currency },
      after: { amount: totalAfter, currency: invoice.currency },
    });
  }
  return { statements, adjustments };
}

// ── Discount rules (TUI-58) ─────────────────────────────────────────────────
// Every staff role that reads billing reads them. Only the owner adds, changes and deletes them:
// like an org-wide price rule, a discount changes prices for the whole org (D-111).

export function toDiscountRule(row: repo.DiscountRuleRow): DiscountRule {
  const money = (amount: number | null) =>
    amount === null || row.currency === null ? null : { amount, currency: row.currency };
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    percentBps: row.percentBps,
    amount: money(row.amount),
    fixedPrice: money(row.fixedPrice),
    minCount: row.minCount,
    courseIds: row.courseIds ?? null,
    studentIds: row.studentIds ?? null,
    familyIds: row.familyIds ?? null,
    cutoffDate: row.cutoffDate,
    termId: row.termId,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A rule as an invoice run reads it. */
export function toDiscountData(row: repo.DiscountRuleRow): DiscountRuleData {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    percentBps: row.percentBps,
    amount: row.amount,
    fixedPrice: row.fixedPrice,
    minCount: row.minCount,
    courseIds: row.courseIds ?? null,
    studentIds: row.studentIds ?? null,
    familyIds: row.familyIds ?? null,
    cutoffDate: row.cutoffDate,
    termId: row.termId,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    active: row.active,
  };
}

function discountReader(access: Access) {
  if (access.role === 'teacher' || access.role === 'parent') throw forbidden();
}

function discountWriter(access: Access) {
  if (access.role !== 'owner') throw forbidden();
}

export async function listDiscountRules(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  kind?: string,
) {
  discountReader(access);
  const rows = await repo.listDiscountRules(ctx, limit, decodeCursor(cursor), kind);
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toDiscountRule), nextCursor };
}

/** The columns of a rule as given, with money in the org's currency (400 otherwise). */
function discountColumns(input: Partial<CreateDiscountRule>, currency: string) {
  const fields: Record<string, string[]> = {};
  for (const field of ['amount', 'fixedPrice'] as const) {
    const money = input[field];
    if (money && money.currency !== currency) {
      fields[`${field}.currency`] = [`Must be the organisation's currency, ${currency}`];
    }
  }
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  const columns: Partial<repo.NewDiscountRuleRow> = {};
  for (const field of [
    'name',
    'percentBps',
    'minCount',
    'courseIds',
    'studentIds',
    'familyIds',
    'cutoffDate',
    'termId',
    'startsOn',
    'endsOn',
    'active',
  ] as const) {
    if (input[field] !== undefined) Object.assign(columns, { [field]: input[field] });
  }
  if (input.amount !== undefined) columns.amount = input.amount?.amount ?? null;
  if (input.fixedPrice !== undefined) columns.fixedPrice = input.fixedPrice?.amount ?? null;
  return columns;
}

export async function createDiscountRule(
  ctx: OrgCtx,
  access: Access,
  input: CreateDiscountRule,
): Promise<DiscountRule> {
  discountWriter(access);
  // A term the org doesn't have is 404.
  const [org] = await Promise.all([
    orgs.getOrg(ctx),
    input.termId ? calendar.getTerm(ctx, input.termId) : null,
  ]);
  const row = await repo.insertDiscountRule(ctx, {
    id: newId('discountRule'),
    orgId: ctx.orgId,
    kind: input.kind,
    currency: org.currency,
    name: input.name,
    ...discountColumns(input, org.currency),
  });
  return toDiscountRule(row);
}

export async function updateDiscountRule(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdateDiscountRule,
): Promise<DiscountRule> {
  const { updatedAt, ...changes } = input;
  const [before, org] = await Promise.all([repo.findDiscountRule(ctx, id), orgs.getOrg(ctx)]);
  if (!before) throw notFound('Discount rule');
  discountWriter(access);
  if (before.updatedAt !== updatedAt) throw staleData();
  if (Object.keys(changes).length === 0) return toDiscountRule(before);
  const after = { ...toDiscountRule(before), ...changes, kind: before.kind };
  const issues = discountRuleIssues(after);
  if (issues) {
    const fields: Record<string, string[]> = {};
    for (const issue of issues) (fields[issue.path.join('.') || '_'] ??= []).push(issue.message);
    throw validationFailed(fields);
  }
  if (changes.termId) await calendar.getTerm(ctx, changes.termId);
  const updated = await repo.updateDiscountRule(
    ctx,
    before,
    discountColumns(changes, org.currency),
  );
  if (!updated) throw notFound('Discount rule');
  return toDiscountRule(updated);
}

export async function deleteDiscountRule(ctx: OrgCtx, access: Access, id: string) {
  const before = await repo.findDiscountRule(ctx, id);
  if (!before) throw notFound('Discount rule');
  discountWriter(access);
  await repo.softDeleteDiscountRule(ctx, before);
}

// ── Money reports (TUI-63) and the dashboard (TUI-62) ───────────────────────

/** The days between two local dates. */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** What is owed today, by how long past its due date. */
function agedDebt(rows: Awaited<ReturnType<typeof repo.owing>>, today: string, currency: string) {
  const money = (amount: number) => ({ amount, currency });
  const buckets = { notDue: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 };
  let invoices = 0;
  for (const row of rows) {
    const owed = row.total - row.paid;
    if (owed <= 0) continue;
    invoices++;
    const late = row.dueDate && row.dueDate < today ? daysBetween(row.dueDate, today) : 0;
    if (late === 0) buckets.notDue += owed;
    else if (late <= 30) buckets.days1to30 += owed;
    else if (late <= 60) buckets.days31to60 += owed;
    else if (late <= 90) buckets.days61to90 += owed;
    else buckets.over90 += owed;
  }
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  return {
    asOf: today,
    invoices,
    total: money(total),
    notDue: money(buckets.notDue),
    days1to30: money(buckets.days1to30),
    days31to60: money(buckets.days31to60),
    days61to90: money(buckets.days61to90),
    over90: money(buckets.over90),
  };
}

/**
 * Invoiced against received, by month; what is owed by age; and tax by rate, for the families the
 * caller reaches: branch staff their branches' families, an accountant and the owner every one.
 * One stage: the four reads go together.
 */
export async function moneyReport(
  ctx: OrgCtx,
  access: Access,
  range: { from: string; to: string },
): Promise<MoneyReport> {
  if (range.to > addDays(range.from, MAX_REPORT_DAYS - 1)) {
    throw validationFailed({ to: [`At most ${MAX_REPORT_DAYS} days from \`from\``] });
  }
  const org = await orgs.getOrg(ctx);
  const reach = invoiceReach(ctx, access);
  const from = localToUtc(range.from, '00:00', org.timezone);
  const to = localToUtc(addDays(range.to, 1), '00:00', org.timezone);
  const [issued, received, owed, tax] = await Promise.all([
    repo.issuedBetween(ctx, from, to, reach),
    repo.receivedBetween(
      ctx,
      { startDate: range.from, endDate: range.to },
      paymentReach(ctx, access),
    ),
    repo.owing(ctx, reach),
    repo.taxBetween(ctx, from, to, reach),
  ]);
  const money = (amount: number) => ({ amount, currency: org.currency });
  const months = new Map<string, { invoiced: number; received: number }>();
  const month = (key: string) => {
    const entry = months.get(key) ?? { invoiced: 0, received: 0 };
    months.set(key, entry);
    return entry;
  };
  // Every month in the dates, so a month with nothing shows as 0.
  const last = range.to.slice(0, 7);
  for (let m = range.from.slice(0, 7); m <= last; m = addDays(`${m}-01`, 31).slice(0, 7)) month(m);
  let invoiced = 0;
  for (const row of issued) {
    if (row.status === 'void' || !row.issuedAt) continue;
    invoiced += row.total;
    month(utcToLocal(row.issuedAt, org.timezone).date.slice(0, 7)).invoiced += row.total;
  }
  const byMethod = new Map<string, number>();
  let receivedTotal = 0;
  for (const row of received) {
    receivedTotal += row.amount;
    month(row.receivedOn.slice(0, 7)).received += row.amount;
    byMethod.set(row.method, (byMethod.get(row.method) ?? 0) + row.amount);
  }
  return {
    from: range.from,
    to: range.to,
    invoiced: money(invoiced),
    received: money(receivedTotal),
    byMonth: [...months]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, m]) => ({
        month: key,
        invoiced: money(m.invoiced),
        received: money(m.received),
      })),
    receivedByMethod: [...byMethod].map(([method, amount]) => ({
      method: method as MoneyReport['receivedByMethod'][number]['method'],
      amount: money(amount),
    })),
    agedDebt: agedDebt(owed, localNow(org.timezone).date, org.currency),
    tax: tax.map((row) => ({
      taxRateId: row.taxRateId,
      name: row.taxName,
      rateBps: row.taxRateBps,
      inclusive: row.taxInclusive,
      taxable: money(row.subtotal),
      tax: money(row.tax),
    })),
    taxTotal: money(tax.reduce((sum, row) => sum + row.tax, 0)),
  };
}

/** The money on the dashboard: what is owed, what is overdue, and this month's payments. */
export async function moneySummary(ctx: OrgCtx, access: Access) {
  const org = await orgs.getOrg(ctx);
  const today = localNow(org.timezone).date;
  const reach = invoiceReach(ctx, access);
  const [owed, received, drafts] = await Promise.all([
    repo.owing(ctx, reach),
    repo.receivedBetween(
      ctx,
      { startDate: `${today.slice(0, 7)}-01`, endDate: today },
      paymentReach(ctx, access),
    ),
    repo.countDrafts(ctx, reach),
  ]);
  const money = (amount: number) => ({ amount, currency: org.currency });
  let owing = 0;
  let overdue = 0;
  let overdueInvoices = 0;
  for (const row of owed) {
    const left = row.total - row.paid;
    owing += left;
    if (row.dueDate && row.dueDate < today && left > 0) {
      overdue += left;
      overdueInvoices++;
    }
  }
  return {
    owing: money(owing),
    overdue: money(overdue),
    overdueInvoices,
    receivedThisMonth: money(received.reduce((sum, row) => sum + row.amount, 0)),
    draftInvoices: drafts,
  };
}

// ── Overdue reminders (TUI-67) ──────────────────────────────────────────────

/** A reminder day passed longer ago than this isn't sent late, only marked as done. */
export const REMINDER_CATCH_UP_DAYS = 3;

/**
 * Reminds families of their overdue invoices, for the hourly cron at the org's reminder hour.
 * An invoice is reminded once for each of `reminderDays` (days past its due date) it reaches,
 * one reminder per run at most. The days are marked before the reminders are queued, so a
 * failure sends one too few, never one twice. A day reached more than REMINDER_CATCH_UP_DAYS
 * ago (the cron missed it, or the setting was changed) is marked without sending.
 */
export async function remindOverdue(
  ctx: OrgCtx,
  queue: Queue<EmailMessage>,
  reminderDays: number[],
  today: string,
) {
  const rows = await repo.overdue(ctx, today);
  const marks: { id: string; remindedDays: number[] }[] = [];
  const toSend: (typeof rows)[number][] = [];
  for (const row of rows) {
    if (!row.dueDate || row.total - row.paid <= 0) continue;
    const late = diffDays(row.dueDate, today);
    const reached = reminderDays.filter((day) => day <= late && !row.remindedDays.includes(day));
    if (reached.length === 0) continue;
    marks.push({
      id: row.id,
      remindedDays: [...row.remindedDays, ...reached].sort((a, b) => a - b),
    });
    if (late - Math.max(...reached) < REMINDER_CATCH_UP_DAYS) toSend.push(row);
  }
  if (marks.length === 0) return { reminded: 0 };
  await repo.markReminded(
    ctx,
    marks,
    toSend.map((row) => row.id),
  );
  if (toSend.length === 0) return { reminded: 0 };

  const [org, families] = await Promise.all([
    orgs.getOrg(ctx),
    people.familyLabels(
      ctx,
      toSend.map((row) => row.familyId),
    ),
  ]);
  let reminded = 0;
  for (const row of toSend) {
    const family = families.get(row.familyId);
    if (!family) continue;
    const balance = formatMoney(
      { amount: row.total - row.paid, currency: row.currency },
      org.locale,
    );
    const queued = await comms.queueNotice(ctx, queue, {
      event: 'invoice_overdue',
      subject: t('invoice.overdue.subject', { balance }),
      body: t('invoice.overdue.body', {
        familyName: family.name,
        dueDate: formatDate(row.dueDate!, org.dateFormat),
        balance,
        bankReference: row.bankReference ?? '',
      }),
      familyIds: [row.familyId],
      audience: { type: 'custom', ids: [row.familyId] },
    });
    if (queued) reminded++;
  }
  return { reminded };
}

// ── PDFs (TUI-59) ───────────────────────────────────────────────────────────

/** One payment within reach, as the list shows it. One stage. */
export async function getPayment(ctx: OrgCtx, access: Access, id: string): Promise<Payment> {
  const reach = paymentReach(ctx, access);
  const [row, allocations, families] = await Promise.all([
    repo.findPayment(ctx, id, reach),
    repo.listAllocations(ctx, repo.paymentWithin(ctx, id, reach)),
    people.familyLabels(ctx, repo.familyOfPayment(ctx, id, reach)),
  ]);
  if (!row) throw notFound('Payment');
  const family = families.get(row.familyId);
  if (!family) throw notFound('Payment');
  return toPayment(row, family, allocations);
}
