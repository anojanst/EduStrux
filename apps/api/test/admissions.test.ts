import { memberships } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// Public enquiry and enrolment forms, and staff approving requests (TUI-47).

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;

type Row = { id: string; updatedAt: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

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
  const member = async (role: Role, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    await db()
      .insert(memberships)
      .values({ id: newId('membership'), orgId: org.id, userId: user.userId, role, branchIds });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { as };
  };
  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const albany = await make('/branches', { name: 'Albany' });
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', { subjectId: subject.id, gradeLevelId: grade.id });
  const addClass = async (name: string, branchId: string, body: Record<string, unknown> = {}) => {
    const klass = await make('/classes', {
      courseId: course.id,
      branchId,
      name,
      startDate: addDays(today(), -7),
      ...body,
    });
    await api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [{ weekday: 2, startTime: '16:00', endTime: '17:00' }],
    });
    return klass;
  };
  const maths = await addClass('Maths', main.id);
  const full = await addClass('Full maths', albany.id, { capacity: 0 + 1 });
  const ended = await addClass('Old maths', main.id, { endDate: addDays(today(), -1) });
  const pub = (method: string, path: string, body?: unknown, ip = '203.0.113.7') =>
    call(method, `/api/v1/public/${org.slug}${path}`, {
      body,
      headers: { 'CF-Connecting-IP': ip },
    });
  const request = (body: Record<string, unknown> = {}, ip?: string) =>
    pub(
      'POST',
      '/enrolment-requests',
      {
        guardian: { firstName: 'Mere', lastName: 'Perera', email: 'mere@example.com' },
        students: [{ firstName: 'Aroha', lastName: 'Perera', classIds: [maths.id] }],
        ...body,
      },
      ip,
    );
  return { org, base, api, make, member, main, albany, maths, full, ended, course, pub, request };
}

describe('the public form', () => {
  it('shows the org’s branches and running classes, with no sign-in', async () => {
    const { pub, maths, ended, main } = await setup();
    const res = await pub('GET', '/form');
    expect(res.status).toBe(200);
    expect(res.body.orgName).toBe('Bright Minds Tuition');
    expect(res.body.branches.map((b: Row) => b.id)).toContain(main.id);
    const ids = res.body.classes.map((c: Row) => c.id);
    expect(ids).toContain(maths.id);
    expect(ids).not.toContain(ended.id);
    expect(res.body.classes.find((c: Row) => c.id === maths.id).schedule).toEqual([
      { weekday: 2, startTime: '16:00', endTime: '17:00' },
    ]);
    expect(res.body.subjects).toEqual([{ id: expect.any(String), name: 'Mathematics' }]);
    expect((await call('GET', '/api/v1/public/no-such-org/form')).status).toBe(404);
  });
});

describe('enquiries', () => {
  it('are received from the public and listed for staff, who mark them handled', async () => {
    const { pub, api, member, albany } = await setup();
    const sent = await pub('POST', '/enquiries', {
      name: 'Mere Perera',
      email: 'Mere@Example.com',
      message: 'Do you teach Year 10 maths on Saturdays?',
      branchId: albany.id,
    });
    expect(sent.status).toBe(201);
    expect(sent.body).toEqual({ received: true, id: expect.stringMatching(/^enq_/) });
    const list = await api('GET', '/enquiries');
    expect(list.body.data).toEqual([
      {
        id: sent.body.id,
        branchId: albany.id,
        name: 'Mere Perera',
        email: 'mere@example.com',
        phone: null,
        studentName: null,
        message: 'Do you teach Year 10 maths on Saturdays?',
        status: 'new',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);
    const handled = await api('PATCH', `/enquiries/${sent.body.id}`, {
      updatedAt: list.body.data[0].updatedAt,
      status: 'handled',
    });
    expect(handled.body.status).toBe('handled');
    expect((await api('GET', '/enquiries?status=new')).body.data).toEqual([]);
    const desk = await member('front_desk', [albany.id]);
    expect((await desk.as('GET', '/enquiries')).body.data).toHaveLength(1);
    expect((await (await member('teacher')).as('GET', '/enquiries')).status).toBe(403);
  });

  it('drops what a bot sends, refuses bad input, and slows a flood', async () => {
    const { pub, api } = await setup();
    const bot = await pub('POST', '/enquiries', {
      name: 'x',
      email: 'x@example.com',
      message: 'spam',
      website: 'http://spam.example',
    });
    expect(bot.status).toBe(201);
    expect(bot.body).toEqual({ received: true, id: null });
    expect((await api('GET', '/enquiries')).body.data).toEqual([]);
    expect(
      (await pub('POST', '/enquiries', { name: 'x', email: 'nope', message: 'm' })).status,
    ).toBe(400);
    expect(
      (
        await pub('POST', '/enquiries', {
          name: 'x',
          email: 'a@b.co',
          message: 'm',
          branchId: 'brn_x',
        })
      ).status,
    ).toBe(400);
    const send = (ip: string) =>
      pub('POST', '/enquiries', { name: 'x', email: 'x@example.com', message: 'hello' }, ip);
    for (let i = 0; i < 10; i++) expect((await send('198.51.100.1')).status).toBe(201);
    const flood = await send('198.51.100.1');
    expect(flood.status).toBe(429);
    expect(flood.body.error.code).toBe('rate_limited');
    expect((await send('198.51.100.2')).status).toBe(201);
  });
});

describe('enrolment requests', () => {
  it('are approved into a family, guardian, children and enrolments', async () => {
    const { request, api, maths, full, main } = await setup();
    const sent = await request({
      students: [
        { firstName: 'Aroha', lastName: 'Perera', classIds: [maths.id] },
        {
          firstName: 'Sam',
          lastName: 'Perera',
          dateOfBirth: '2014-02-03',
          classIds: [maths.id, full.id],
        },
      ],
      notes: 'Sam is shy.',
    });
    expect(sent.status).toBe(201);
    const [pending] = (await api('GET', '/enrolment-requests?status=pending')).body.data;
    expect(pending).toMatchObject({
      id: sent.body.id,
      status: 'pending',
      guardian: { firstName: 'Mere', email: 'mere@example.com', phone: null },
      students: [
        { firstName: 'Aroha', dateOfBirth: null, classIds: [maths.id] },
        { firstName: 'Sam', dateOfBirth: '2014-02-03', classIds: [maths.id, full.id] },
      ],
      notes: 'Sam is shy.',
      result: null,
    });

    // Fill the one place in the full class first.
    const other = await api('POST', '/families', { name: 'Ngata', branchId: main.id });
    const ari = await api('POST', '/students', {
      familyId: other.body.id,
      firstName: 'Ari',
      lastName: 'Ngata',
    });
    await api('POST', '/enrolments', { studentId: ari.body.id, classId: full.id });

    const approved = await api('POST', `/enrolment-requests/${sent.body.id}/approve`, {});
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      status: 'approved',
      decidedAt: expect.any(String),
      result: {
        familyId: expect.stringMatching(/^fam_/),
        guardianId: expect.stringMatching(/^gdn_/),
        studentIds: [expect.any(String), expect.any(String)],
        enrolmentIds: [expect.any(String), expect.any(String)],
        skipped: [{ studentIndex: 1, classId: full.id, reason: expect.stringContaining('full') }],
      },
    });
    const family = (await api('GET', `/families/${approved.body.result.familyId}`)).body;
    expect(family).toMatchObject({
      name: 'Perera',
      branchId: main.id,
      guardians: [{ firstName: 'Mere', email: 'mere@example.com' }],
    });
    expect(family.students.map((s: { firstName: string }) => s.firstName).sort()).toEqual([
      'Aroha',
      'Sam',
    ]);
    const again = await api('POST', `/enrolment-requests/${sent.body.id}/approve`, {});
    expect(again.status).toBe(422);
    expect(again.body.error.fields).toEqual({ status: ['Approved'] });
  });

  it('can join a family already on record, using its guardian with the same email', async () => {
    const { request, api, main } = await setup();
    const family = (await api('POST', '/families', { name: 'Perera', branchId: main.id })).body;
    const mere = (
      await api('POST', `/families/${family.id}/guardians`, {
        firstName: 'Mere',
        lastName: 'Perera',
        email: 'mere@example.com',
      })
    ).body;
    const sent = await request();
    const approved = await api('POST', `/enrolment-requests/${sent.body.id}/approve`, {
      familyId: family.id,
    });
    expect(approved.body.result).toMatchObject({ familyId: family.id, guardianId: mere.id });
    expect((await api('GET', `/families/${family.id}`)).body.guardians).toHaveLength(1);
  });

  it('are rejected with a reason, and refused for unknown classes', async () => {
    const { request, api } = await setup();
    const sent = await request();
    const rejected = await api('POST', `/enrolment-requests/${sent.body.id}/reject`, {
      reason: 'No places this term',
    });
    expect(rejected.body).toMatchObject({ status: 'rejected', reason: 'No places this term' });
    expect((await api('POST', `/enrolment-requests/${sent.body.id}/reject`, {})).status).toBe(422);
    const unknown = await request({
      students: [{ firstName: 'A', lastName: 'B', classIds: ['cls_missing'] }],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.fields).toEqual({ 'students.0.classIds.0': ['Unknown class'] });
    expect((await request({ students: [] })).status).toBe(400);
  });

  it('is for staff who write classes; another org’s request is 404', async () => {
    const { request, member, base } = await setup();
    const sent = await request();
    for (const role of ['teacher', 'parent', 'accountant'] as const) {
      expect((await (await member(role)).as('GET', '/enrolment-requests')).status).toBe(403);
    }
    const stranger = await newUser('owner_b');
    await newOrg(stranger.token, 'Harmony Music School');
    const res = await call('POST', `${base}/enrolment-requests/${sent.body.id}/approve`, {
      token: stranger.token,
      body: {},
    });
    expect(res.status).toBe(404);
  });
});
