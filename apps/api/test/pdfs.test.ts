import { guardians, memberships } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/errors';
import { renderPdf } from '../src/pdf/render';
import { call, db, newOrg, newUser } from './helpers';

// Invoice PDFs and payment receipts (TUI-59): the printable pages, and Browser Rendering.

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;
const nextMonday = () => addDays(today(), 8 - weekday(today()));
const nzd = (amount: number) => ({ amount, currency: 'NZD' });

type Row = { id: string; updatedAt: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

/** An org with a GST number, a $450 term class, and the Perera and Ngata families' invoices. */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async <T = Row>(path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };
  const member = async (role: Role) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds: null });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, as, token: user.token };
  };
  const current = (await api('GET', '')).body;
  await api('PATCH', '', { updatedAt: current.updatedAt, taxNumber: '123-456-789' });
  const main = (await api('GET', '/branches')).body.data[0] as Row;
  await make('/tax-rates', { name: 'GST', rateBps: 1500, inclusive: false, isDefault: true });
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', {
    subjectId: subject.id,
    gradeLevelId: grade.id,
    defaultPrice: nzd(45000),
  });
  const start = nextMonday();
  const year = await make('/academic-years', {
    name: 'Year',
    startDate: addDays(start, -30),
    endDate: addDays(start, 300),
  });
  const term = await make('/terms', {
    academicYearId: year.id,
    name: 'Term 1',
    startDate: start,
    endDate: addDays(start, 69),
  });
  const klass = await make('/classes', {
    courseId: course.id,
    termId: term.id,
    branchId: main.id,
    name: 'Maths <A>',
  });
  await api('PUT', `/classes/${klass.id}/schedule`, {
    slots: [{ weekday: 1, startTime: '16:00', endTime: '17:00' }],
  });
  const family = async (name: string) => {
    const f = await make<Row & { bankReference: string }>('/families', { name, branchId: main.id });
    const guardian = await make(`/families/${f.id}/guardians`, { firstName: 'G', lastName: name });
    const student = await make('/students', { familyId: f.id, firstName: 'Aroha', lastName: name });
    await make('/enrolments', { studentId: student.id, classId: klass.id });
    return { ...f, guardian };
  };
  const perera = await family('Perera');
  const ngata = await family('Ngata');
  const started = await api('POST', `/terms/${term.id}/generate-invoices`, {});
  for (let i = 0; i < 400; i++) {
    const job = (await api('GET', `/jobs/${started.body.jobId}`)).body;
    if (job.status === 'succeeded') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const invoiceOf = async (familyId: string) =>
    (await api('GET', `/invoices?familyId=${familyId}`)).body.data[0] as Row & {
      bankReference: string;
    };
  const pereraInvoice = await invoiceOf(perera.id);
  const ngataInvoice = await invoiceOf(ngata.id);
  await api('POST', `/invoices/${pereraInvoice.id}/issue`);
  const payment = await make('/payments', {
    familyId: perera.id,
    method: 'bank_transfer',
    amount: nzd(10000),
    reference: 'Term 1 part',
    allocations: [{ invoiceId: pereraInvoice.id, amount: nzd(10000) }],
  });
  return { org, base, api, member, perera, ngata, pereraInvoice, ngataInvoice, payment };
}

const html = (res: { headers: Headers; body: unknown }) => {
  expect(res.headers.get('Content-Type')).toContain('text/html');
  return res.body as string;
};

/** `call` parses JSON; documents aren't, so read them raw. */
async function raw(method: string, path: string, token: string) {
  const { exports } = await import('cloudflare:workers');
  const res = await exports.default.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  return { status: res.status, headers: res.headers, body: await res.text() };
}

describe('GET /invoices/{id}/pdf', () => {
  it('gives the printable page, escaped, with totals, tax, the tax number and bank reference', async () => {
    const { base, pereraInvoice, org } = await setup();
    const owner = await ownerToken(org.id);
    const res = await raw('GET', `${base}/invoices/${pereraInvoice.id}/pdf?format=html`, owner);
    expect(res.status).toBe(200);
    const page = html(res);
    expect(page).toContain('Bright Minds Tuition');
    expect(page).toContain('Tax number: 123-456-789');
    expect(page).toContain('Maths &lt;A&gt;');
    expect(page).not.toContain('Maths <A>');
    expect(page).toContain('Perera');
    expect(page).toContain('$450.00');
    expect(page).toContain('GST 15%');
    expect(page).toContain('$67.50');
    expect(page).toContain('$517.50');
    expect(page).toContain('$417.50');
    expect(page).toContain(pereraInvoice.bankReference);
    expect(page).not.toContain('Draft: not yet issued');
  });

  it('marks a draft as one, and is 503 for a PDF while Browser Rendering isn’t set up', async () => {
    const { base, ngataInvoice, org } = await setup();
    const owner = await ownerToken(org.id);
    const draft = await raw('GET', `${base}/invoices/${ngataInvoice.id}/pdf?format=html`, owner);
    expect(html(draft)).toContain('Draft: not yet issued');
    const pdf = await call('GET', `${base}/invoices/${ngataInvoice.id}/pdf`, { token: owner });
    expect(pdf.status).toBe(503);
    expect(pdf.body.error.code).toBe('unavailable');
    expect(
      (await call('GET', `${base}/invoices/${ngataInvoice.id}/pdf?format=doc`, { token: owner }))
        .status,
    ).toBe(400);
  });

  it('is 403 for a teacher and 404 for another org or a missing invoice', async () => {
    const { base, member, pereraInvoice } = await setup();
    const teacher = await member('teacher');
    expect((await teacher.as('GET', `/invoices/${pereraInvoice.id}/pdf?format=html`)).status).toBe(
      403,
    );
    const stranger = await newUser('owner_b');
    await newOrg(stranger.token, 'Harmony Music School');
    const res = await call('GET', `${base}/invoices/${pereraInvoice.id}/pdf?format=html`, {
      token: stranger.token,
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /payments/{id}/receipt', () => {
  it('gives the receipt page: who paid, how, and towards what', async () => {
    const { base, payment, org, pereraInvoice } = await setup();
    const owner = await ownerToken(org.id);
    const res = await raw('GET', `${base}/payments/${payment.id}/receipt?format=html`, owner);
    expect(res.status).toBe(200);
    const page = html(res);
    expect(page).toContain('Receipt');
    expect(page).toContain('Bank transfer');
    expect(page).toContain('$100.00');
    expect(page).toContain(`Invoice ${pereraInvoice.id.slice(-8).toUpperCase()}`);
    expect(page).toContain('Term 1 part');
    expect(
      (await call('GET', `${base}/payments/pay_missing/receipt`, { token: owner })).status,
    ).toBe(404);
  });
});

describe('GET /portal/invoices/{id}/pdf', () => {
  it('gives a parent their issued invoice, and 404 for a draft or another family’s', async () => {
    const { member, perera, pereraInvoice, ngataInvoice, api, base } = await setup();
    const parent = await member('parent');
    await db()
      .update(guardians)
      .set({ membershipId: parent.id })
      .where(eq(guardians.id, perera.guardian.id));
    const own = await raw(
      'GET',
      `${base}/portal/invoices/${pereraInvoice.id}/pdf?format=html`,
      parent.token,
    );
    expect(own.status).toBe(200);
    expect(html(own)).toContain('Perera');
    expect(
      (await parent.as('GET', `/portal/invoices/${ngataInvoice.id}/pdf?format=html`)).status,
    ).toBe(404);
    expect((await api('GET', `/portal/invoices/${pereraInvoice.id}/pdf?format=html`)).status).toBe(
      403,
    );
  });
});

describe('renderPdf', () => {
  it('posts the page to Browser Rendering and gives back the PDF', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 test');
    const fetchFn = vi.fn(
      async () => new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } }),
    );
    const configured = {
      ...env,
      BROWSER_RENDERING_ACCOUNT_ID: 'acc_1',
      BROWSER_RENDERING_TOKEN: 'tok',
    };
    const out = await renderPdf(configured, '<p>Hi</p>', fetchFn as unknown as typeof fetch);
    expect(new TextDecoder().decode(out)).toBe('%PDF-1.7 test');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acc_1/browser-rendering/pdf');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toMatchObject({ html: '<p>Hi</p>' });

    const failing = vi.fn(async () => new Response('busy', { status: 500 }));
    await expect(
      renderPdf(configured, '<p/>', failing as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

/** The org owner's own token, read back from the org's one owner membership. */
async function ownerToken(orgId: string) {
  const { tokenFor } = await import('./helpers');
  const membership = await db().query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.orgId, orgId), eq(m.role, 'owner')),
  });
  const user = await db().query.users.findFirst({
    where: (u, { eq }) => eq(u.id, membership!.userId),
  });
  return tokenFor(user!.clerkUserId);
}
