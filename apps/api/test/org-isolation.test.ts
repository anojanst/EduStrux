import { memberships } from '@edustrux/db';
import { addDays, localNow, newId, weekday } from '@edustrux/shared';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// Org isolation (TUI-82): a sweep of every org route in the OpenAPI document, so a route added
// later is covered without anyone remembering to. Two rules:
// 1. Someone who isn't a member of an org gets 404 from every one of its routes.
// 2. In your own org, another org's ids are never found: never a 2xx, never a 500, and a read
//    or a delete is 404.
// And from the source: only repositories (and the few platform files listed) query D1.

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;
const nextMonday = () => addDays(today(), 8 - weekday(today()));

type Spec = { paths: Record<string, Record<string, unknown>> };
type Row = { id: string };

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** An org with one of everything a route can name by id. Returns its ids by path param. */
async function orgWithEverything() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `/api/v1/orgs/${org.id}${path}`, { token: owner.token, body });
  const make = async (path: string, body: unknown = {}) => {
    const res = await api('POST', path, body);
    if (res.status !== 201 && res.status !== 202) {
      throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    }
    return res.body as Row & Record<string, any>;
  };
  const branchId = ((await api('GET', '/branches')).body.data[0] as Row).id;
  const room = await make(`/branches/${branchId}/rooms`, { name: 'Room 1' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const subject = await make('/subjects', { name: 'Mathematics' });
  const course = await make('/courses', {
    subjectId: subject.id,
    gradeLevelId: grade.id,
    defaultPrice: { amount: 45000, currency: 'NZD' },
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
  const holiday = await make('/holidays', {
    name: 'Break',
    startDate: addDays(start, 100),
    endDate: addDays(start, 101),
  });
  const klass = await make('/classes', {
    courseId: course.id,
    termId: term.id,
    branchId,
    name: 'Maths',
  });
  await api('PUT', `/classes/${klass.id}/schedule`, {
    slots: [{ weekday: 1, startTime: '16:00', endTime: '17:00' }],
  });
  const session = (
    await api('GET', `/sessions?classId=${klass.id}&from=${start}&to=${addDays(start, 13)}`)
  ).body.data[0] as Row;
  const family = await make('/families', { name: 'Perera', branchId });
  const guardian = await make(`/families/${family.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
    email: 'mere@example.com',
  });
  const student = await make('/students', {
    familyId: family.id,
    firstName: 'Aroha',
    lastName: 'Perera',
  });
  const enrolment = await make('/enrolments', { studentId: student.id, classId: klass.id });
  const taxRate = await make('/tax-rates', { name: 'GST', rateBps: 1500, inclusive: false });
  const priceRule = await make('/price-rules', {
    courseId: course.id,
    basis: 'per_lesson',
    price: { amount: 4000, currency: 'NZD' },
  });
  const discountRule = await make('/discount-rules', {
    name: 'Sibling 10%',
    kind: 'sibling',
    percentBps: 1000,
  });
  const run = await make(`/terms/${term.id}/generate-invoices`);
  let invoice: Row | undefined;
  for (let i = 0; i < 400 && !invoice; i++) {
    invoice = (await api('GET', `/invoices?familyId=${family.id}`)).body.data[0];
    if (!invoice) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await api('POST', `/invoices/${invoice!.id}/issue`);
  const payment = await make('/payments', {
    familyId: family.id,
    method: 'cash',
    amount: { amount: 1000, currency: 'NZD' },
    allocations: [{ invoiceId: invoice!.id, amount: { amount: 1000, currency: 'NZD' } }],
  });
  const staffUser = await newUser('staff');
  const membershipId = newId('membership');
  await db().insert(memberships).values({
    id: membershipId,
    orgId: org.id,
    userId: staffUser.userId,
    role: 'front_desk',
    branchIds: null,
  });
  const template = await make('/message-templates', {
    name: 'Hello',
    subject: 'Hello',
    body: 'Hi there',
  });
  const message = await make('/messages', {
    subject: 'Hello',
    body: 'Hi',
    audience: { type: 'all' },
    channels: ['portal'],
  });
  const pub = (path: string, body: unknown) =>
    call('POST', `/api/v1/public/${org.slug}${path}`, {
      body,
      headers: { 'CF-Connecting-IP': '203.0.113.9' },
    });
  const enquiry = (
    await pub('/enquiries', { name: 'Ana', email: 'ana@example.com', message: 'Saturday maths?' })
  ).body as Row;
  const request = (
    await pub('/enrolment-requests', {
      guardian: { firstName: 'Ana', lastName: 'Ngata', email: 'ana@example.com' },
      students: [{ firstName: 'Ari', lastName: 'Ngata', classIds: [klass.id] }],
    })
  ).body as Row;
  const csv = 'First,Last\nAri,Ngata\n';
  const upload = await make('/files/upload-url', {
    filename: 'students.csv',
    contentType: 'text/csv',
    size: csv.length,
  });
  await exports.default.fetch(new Request(upload.uploadUrl, { method: 'PUT', body: csv }));
  const importRow = await make('/imports', { fileId: upload.file.id });
  const exported = await make('/exports');

  return {
    org,
    owner,
    ids: {
      branchId,
      roomId: room.id,
      gradeLevelId: grade.id,
      subjectId: subject.id,
      courseId: course.id,
      academicYearId: year.id,
      termId: term.id,
      holidayId: holiday.id,
      classId: klass.id,
      sessionId: session.id,
      familyId: family.id,
      guardianId: guardian.id,
      studentId: student.id,
      enrolmentId: enrolment.id,
      taxRateId: taxRate.id,
      priceRuleId: priceRule.id,
      discountRuleId: discountRule.id,
      jobId: run.jobId,
      invoiceId: invoice!.id,
      paymentId: payment.id,
      membershipId,
      templateId: template.id,
      messageId: message.id,
      enquiryId: enquiry.id,
      requestId: request.id,
      fileId: upload.file.id,
      importId: importRow.id,
      exportId: exported.id,
      // Not worth making: any id the org doesn't have must be 404 all the same.
      bookingId: 'mkb_none',
      type: 'photos',
    } as Record<string, string>,
  };
}

/** Every org route in the API's own OpenAPI document, with each method it has. */
async function orgRoutes() {
  const spec = (await call('GET', '/api/openapi.json')).body as Spec;
  return Object.entries(spec.paths)
    .filter(([path]) => path.startsWith('/api/v1/orgs/{orgId}'))
    .flatMap(([path, ops]) =>
      METHODS.filter((m) => m in ops).map((method) => ({ method: method.toUpperCase(), path })),
    );
}

const fill = (path: string, orgId: string, ids: Record<string, string>) =>
  path.replace(/\{(\w+)\}/g, (_, name: string) =>
    name === 'orgId' ? orgId : (ids[name] ?? 'x_none'),
  );

/**
 * A body that passes the schema, so a write gets as far as looking its ids up: a 400 would say
 * nothing about isolation. Most writes need nothing more than this.
 */
function bodyFor(method: string, path: string, ids: Record<string, string>) {
  if (method === 'GET' || method === 'DELETE') return undefined;
  const updatedAt = new Date().toISOString();
  const bodies: Record<string, unknown> = {
    'PATCH /imports/{importId}': {
      updatedAt,
      mapping: { First: 'studentFirstName', Last: 'studentLastName' },
    },
    'POST /branches/{branchId}/rooms': { name: 'Room 2' },
    'PUT /classes/{classId}/schedule': { slots: [] },
    'POST /families/{familyId}/guardians': { firstName: 'Ana', lastName: 'Ngata' },
    'PATCH /enquiries/{enquiryId}': { updatedAt, status: 'handled' },
    'PUT /sessions/{sessionId}/attendance': {
      records: [{ studentId: ids.studentId, status: 'present' }],
    },
    'PUT /sessions/{sessionId}/notes': { notes: [{ studentId: ids.studentId, note: 'Good' }] },
    'PUT /students/{studentId}/consents/{type}': { granted: true },
    'PUT /portal/students/{studentId}/consents/{type}': { granted: true },
  };
  const key = `${method} ${path.replace('/api/v1/orgs/{orgId}', '')}`;
  return bodies[key] ?? (method === 'PATCH' ? { updatedAt } : {});
}

describe('org isolation (TUI-82)', () => {
  it('gives someone outside the org 404 on every one of its routes', async () => {
    const a = await orgWithEverything();
    const outsider = await newUser('owner_b');
    await newOrg(outsider.token, 'Harmony Music School');
    const routes = await orgRoutes();
    expect(routes.length).toBeGreaterThan(100);
    const wrong: string[] = [];
    for (const { method, path } of routes) {
      const res = await call(method, fill(path, a.org.id, a.ids), {
        token: outsider.token,
        body: bodyFor(method, path, a.ids),
      });
      if (res.status !== 404) wrong.push(`${method} ${path} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });

  it('never finds another org’s ids in your own org', async () => {
    const a = await orgWithEverything();
    const b = await orgWithEverything();
    const routes = (await orgRoutes()).filter(({ path }) =>
      /\{(?!orgId\})\w+\}/.test(path.replace('{type}', '')),
    );
    expect(routes.length).toBeGreaterThan(60);
    const wrong: string[] = [];
    for (const { method, path } of routes) {
      const res = await call(method, fill(path, b.org.id, a.ids), {
        token: b.owner.token,
        body: bodyFor(method, path, a.ids),
      });
      // A route only parents use is 403 for an owner before any id is looked at.
      const expected = path.includes('/portal/') ? 403 : 404;
      if (res.status !== expected) wrong.push(`${method} ${path} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });

  it('keeps D1 queries in repositories', () => {
    const sources = import.meta.glob('../src/**/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    // Platform plumbing that owns its own table, and each module's `for-*.ts` query files for
    // other modules (D-104), are repositories in all but name.
    const allowed = [
      /\/repository\.ts$/,
      /\/for-[\w-]+\.ts$/,
      /\/src\/db\//,
      /\/src\/middleware\/(db|idempotency)\.ts$/,
      /\/src\/background\/jobs\.ts$/,
    ];
    const query =
      /\b(?:db|ctx\.db|c\.var\.db)\s*\.\s*(?:select|selectDistinct|insert|update|delete|batch|all|run|get)\s*\(/;
    const offenders = Object.entries(sources)
      .filter(([file]) => !allowed.some((pattern) => pattern.test(file)))
      .filter(([, text]) => query.test(text.replace(/\n\s*\./g, '.')))
      .map(([file]) => file);
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
