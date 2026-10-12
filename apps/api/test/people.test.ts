import { guardians, memberships } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const today = () => localNow(TZ).date;

type Row = { id: string; updatedAt: string };
type Guardian = Row & {
  familyId: string;
  firstName: string;
  lastName: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  preferredChannel: string;
  language: string | null;
  emergencyContact: boolean;
  membershipId: string | null;
};
type Student = Row & {
  familyId: string;
  branchId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  notes: string | null;
  gradeLevelId: string | null;
  grades: { academicYearId: string; gradeLevelId: string }[];
};
type Family = Row & {
  name: string;
  branchId: string;
  address: string | null;
  billingGuardianId: string | null;
  guardians: Guardian[];
  students: Student[];
};

/** An owner with a fresh org (one branch, "Main"), and helpers bound to that org. */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async <T>(path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };
  const main = (await api('GET', '/branches')).body.data[0] as Row;

  const addFamily = (name = 'Perera', body: Record<string, unknown> = {}) =>
    make<Family>('/families', { name, branchId: main.id, ...body });
  const addGuardian = (familyId: string, body: Record<string, unknown> = {}) =>
    make<Guardian>(`/families/${familyId}/guardians`, {
      firstName: 'Mere',
      lastName: 'Perera',
      ...body,
    });
  const addStudent = (familyId: string, body: Record<string, unknown> = {}) =>
    make<Student>('/students', { familyId, firstName: 'Aroha', lastName: 'Perera', ...body });
  const addGrade = (name: string) => make<Row>('/grade-levels', { name });
  /** An academic year from `from` to `to` days after today. */
  const addYear = (name: string, from: number, to: number) =>
    make<Row>('/academic-years', {
      name,
      startDate: addDays(today(), from),
      endDate: addDays(today(), to),
    });
  const getFamily = async (id: string) => (await api('GET', `/families/${id}`)).body as Family;
  /** A member of the org with the given role, optionally limited to some branches. */
  const member = async (role: Role, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds });
    const as = (method: string, path: string, body?: unknown) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, userId: user.userId, as };
  };
  const lastAudit = async (limit = 1) =>
    (await api('GET', `/audit-log?limit=${limit}`)).body.data as {
      action: string;
      entityId: string;
      actorUserId: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }[];

  return {
    owner,
    org,
    base,
    api,
    make,
    main,
    addFamily,
    addGuardian,
    addStudent,
    addGrade,
    addYear,
    getFamily,
    member,
    lastAudit,
  };
}

describe('families', () => {
  it('adds a family, reads, lists, updates and deletes it, with audit rows', async () => {
    const { api, main, lastAudit } = await setup();

    const created = await api('POST', '/families', {
      name: '  Perera ',
      branchId: main.id,
      address: '4 Kowhai Street',
    });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.stringMatching(/^fam_/),
      name: 'Perera',
      branchId: main.id,
      address: '4 Kowhai Street',
      billingGuardianId: null,
      guardians: [],
      students: [],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const id = created.body.id as string;

    expect((await api('GET', `/families/${id}`)).body).toEqual(created.body);
    expect((await api('GET', '/families')).body).toEqual({
      data: [created.body],
      nextCursor: null,
    });

    const updated = await api('PATCH', `/families/${id}`, {
      updatedAt: created.body.updatedAt,
      name: 'Perera-Smith',
      address: null,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Perera-Smith', address: null });

    expect((await api('DELETE', `/families/${id}`)).status).toBe(204);
    expect((await api('GET', `/families/${id}`)).status).toBe(404);
    expect((await api('GET', '/families')).body.data).toEqual([]);

    const audit = await lastAudit(3);
    expect(audit.map((e) => e.action)).toEqual([
      'family.deleted',
      'family.updated',
      'family.created',
    ]);
    expect(audit[1]).toMatchObject({
      entityId: id,
      before: { name: 'Perera', address: '4 Kowhai Street' },
      after: { name: 'Perera-Smith', nameNorm: 'perera-smith', address: null },
    });
  });

  it('returns a family with its guardians and students', async () => {
    const { api, addFamily, addGuardian, addStudent, main } = await setup();
    const family = await addFamily();
    const mere = await addGuardian(family.id);
    const tane = await addGuardian(family.id, { firstName: 'Tane' });
    const aroha = await addStudent(family.id);
    const other = await addFamily('Other');

    const expected = {
      id: family.id,
      billingGuardianId: mere.id,
      guardians: [mere, tane],
      students: [{ ...aroha, branchId: main.id }],
    };
    expect((await api('GET', `/families/${family.id}`)).body).toMatchObject(expected);
    const list = (await api('GET', '/families')).body.data as Family[];
    expect(list.map((f) => f.name)).toEqual(['Other', 'Perera']);
    expect(list[1]).toMatchObject(expected);
    expect(list[0]).toMatchObject({ id: other.id, guardians: [], students: [] });
  });

  it('lists in name order, ignoring case and accents, and pages with a cursor', async () => {
    const { api, addFamily } = await setup();
    // The two Browns keep the order they were added in. Names in other scripts sort after Latin.
    const added = [];
    for (const name of ['Zhang', 'Álvarez', 'Brown', 'தமிழ்', 'brown', 'සිංහල']) {
      added.push(await addFamily(name));
    }
    const expected = ['Álvarez', 'Brown', 'brown', 'Zhang', 'தமிழ்', 'සිංහල'];

    const all = await api('GET', '/families');
    expect(all.body.data.map((f: Family) => f.name)).toEqual(expected);
    expect(all.body.data[1].id).toBe(added[2]!.id);

    // One at a time, so every name takes a turn as the cursor.
    const names: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await api('GET', `/families?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      names.push(...res.body.data.map((f: Family) => f.name));
      cursor = res.body.nextCursor as string | null;
      pages++;
    } while (cursor && pages < 10);
    expect(names).toEqual(expected);
    expect(pages).toBe(6);
  });

  it.each<[Record<string, unknown>, string[]]>([
    [{}, ['name', 'branchId']],
    [{ name: '  ', branchId: 'brn_x' }, ['name']],
    [{ name: 'x'.repeat(121), branchId: 'brn_x' }, ['name']],
    [{ name: 'Perera', branchId: 'brn_x', address: 'x'.repeat(501) }, ['address']],
  ])('rejects an invalid family %j with 400', async (body, fields) => {
    const { api } = await setup();
    const res = await api('POST', '/families', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.fields)).toEqual(fields);
  });

  it('filters by home branch, and returns 404 for a branch the org does not have', async () => {
    const { api, make, addFamily, main } = await setup();
    const other = await setup();
    const albany = await make<Row>('/branches', { name: 'Albany' });
    await addFamily('Main family');
    await addFamily('Albany family', { branchId: albany.id });
    const names = async (query: string) =>
      (await api('GET', `/families${query}`)).body.data.map((f: Family) => f.name) as string[];

    expect(await names(`?branchId=${albany.id}`)).toEqual(['Albany family']);
    expect(await names(`?branchId=${main.id}`)).toEqual(['Main family']);

    const results = await Promise.all([
      api('GET', '/families?branchId=brn_nope'),
      api('GET', `/families?branchId=${other.main.id}`),
      api('POST', '/families', { name: 'Nowhere', branchId: 'brn_nope' }),
      api('POST', '/families', { name: 'Elsewhere', branchId: other.main.id }),
      api('GET', '/families/fam_nope'),
      api('GET', '/families?limit=0'),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 400]);
  });

  it('moves a family to another home branch, taking its students with it', async () => {
    const { api, make, addFamily, addStudent } = await setup();
    const albany = await make<Row>('/branches', { name: 'Albany' });
    const family = await addFamily();
    const student = await addStudent(family.id);

    const moved = await api('PATCH', `/families/${family.id}`, {
      updatedAt: family.updatedAt,
      branchId: albany.id,
    });
    expect(moved.status).toBe(200);
    expect(moved.body.branchId).toBe(albany.id);
    expect((await api('GET', `/students/${student.id}`)).body.branchId).toBe(albany.id);

    const nowhere = await api('PATCH', `/families/${family.id}`, {
      updatedAt: moved.body.updatedAt,
      branchId: 'brn_nope',
    });
    expect(nowhere.status).toBe(404);
  });

  it('returns 409 for a stale updatedAt, 400 without one, and the family when nothing changes', async () => {
    const { api, addFamily } = await setup();
    const family = await addFamily();

    const same = await api('PATCH', `/families/${family.id}`, { updatedAt: family.updatedAt });
    expect(same.status).toBe(200);
    expect(same.body).toEqual(family);

    const missing = await api('PATCH', `/families/${family.id}`, { name: 'Silva' });
    expect(missing.status).toBe(400);
    expect(Object.keys(missing.body.error.fields)).toEqual(['updatedAt']);

    await api('PATCH', `/families/${family.id}`, { updatedAt: family.updatedAt, name: 'Silva' });
    const stale = await api('PATCH', `/families/${family.id}`, {
      updatedAt: family.updatedAt,
      name: 'Fernando',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });

  it('refuses to delete a family that has students, and deletes its guardians with it', async () => {
    const { api, addFamily, addGuardian, addStudent, getFamily } = await setup();
    const family = await addFamily();
    const guardian = await addGuardian(family.id);
    const first = await addStudent(family.id);
    const second = await addStudent(family.id, { firstName: 'Kai' });

    const refused = await api('DELETE', `/families/${family.id}`);
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({
      code: 'unprocessable',
      message: "Delete this family's 2 student(s) first.",
    });
    expect((await getFamily(family.id)).students).toHaveLength(2);

    await api('DELETE', `/students/${first.id}`);
    await api('DELETE', `/students/${second.id}`);
    expect((await api('DELETE', `/families/${family.id}`)).status).toBe(204);
    const gone = await api('PATCH', `/guardians/${guardian.id}`, {
      updatedAt: guardian.updatedAt,
      phone: '021 555 0100',
    });
    expect(gone.status).toBe(404);
  });
});

describe('guardians', () => {
  it('adds guardians: the first becomes the billing contact', async () => {
    const { api, addFamily, getFamily, lastAudit } = await setup();
    const family = await addFamily();

    const first = await api('POST', `/families/${family.id}/guardians`, {
      firstName: ' Mere ',
      lastName: 'Perera',
      relationship: 'Mother',
      email: '  Mere.Perera@Example.COM ',
      phone: '+64 21 555 0100',
      preferredChannel: 'whatsapp',
      language: 'mi',
      emergencyContact: false,
    });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      id: expect.stringMatching(/^gdn_/),
      familyId: family.id,
      firstName: 'Mere',
      lastName: 'Perera',
      relationship: 'Mother',
      email: 'mere.perera@example.com',
      phone: '+64 21 555 0100',
      preferredChannel: 'whatsapp',
      language: 'mi',
      emergencyContact: false,
      membershipId: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect((await lastAudit())[0]).toMatchObject({
      action: 'guardian.created',
      entityId: first.body.id,
      after: { firstNameNorm: 'mere', billingContact: true },
    });

    // The least a guardian needs is a name; the rest has defaults.
    const second = await api('POST', `/families/${family.id}/guardians`, {
      firstName: 'Tane',
      lastName: 'Perera',
    });
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({
      relationship: null,
      email: null,
      phone: null,
      preferredChannel: 'email',
      language: null,
      emergencyContact: true,
    });
    expect((await lastAudit())[0]!.after).toMatchObject({ billingContact: false });

    const after = await getFamily(family.id);
    expect(after.billingGuardianId).toBe(first.body.id);
    expect(after.guardians).toEqual([first.body, second.body]);
  });

  const named = { firstName: 'Mere', lastName: 'Perera' };
  it.each<[Record<string, unknown>, string[]]>([
    [{}, ['firstName', 'lastName']],
    [{ ...named, firstName: ' ' }, ['firstName']],
    [{ ...named, lastName: 'x'.repeat(81) }, ['lastName']],
    [{ ...named, email: 'not-an-email' }, ['email']],
    [{ ...named, phone: 'call me' }, ['phone']],
    [{ ...named, preferredChannel: 'pigeon' }, ['preferredChannel']],
    [{ ...named, language: 'English' }, ['language']],
    [{ ...named, emergencyContact: 'yes' }, ['emergencyContact']],
  ])('rejects an invalid guardian %j with 400', async (body, fields) => {
    const { api, addFamily } = await setup();
    const family = await addFamily();
    const res = await api('POST', `/families/${family.id}/guardians`, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.fields)).toEqual(fields);
  });

  it('updates a guardian, clears fields with null, and keeps them in their family', async () => {
    const { api, addFamily, addGuardian, lastAudit } = await setup();
    const family = await addFamily();
    const other = await addFamily('Other');
    const guardian = await addGuardian(family.id, {
      relationship: 'Mother',
      email: 'mere@example.com',
      phone: '021 555 0100',
      language: 'en',
    });

    const updated = await api('PATCH', `/guardians/${guardian.id}`, {
      updatedAt: guardian.updatedAt,
      familyId: other.id,
      firstName: 'Mereana',
      relationship: null,
      email: null,
      phone: null,
      language: null,
      preferredChannel: 'sms',
      emergencyContact: false,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      familyId: family.id,
      firstName: 'Mereana',
      lastName: 'Perera',
      relationship: null,
      email: null,
      phone: null,
      language: null,
      preferredChannel: 'sms',
      emergencyContact: false,
    });
    expect((await lastAudit())[0]).toMatchObject({
      action: 'guardian.updated',
      before: { firstName: 'Mere', email: 'mere@example.com' },
      after: { firstName: 'Mereana', firstNameNorm: 'mereana', email: null },
    });

    const same = await api('PATCH', `/guardians/${guardian.id}`, {
      updatedAt: updated.body.updatedAt,
    });
    expect(same.status).toBe(200);
    expect(same.body).toEqual(updated.body);

    const stale = await api('PATCH', `/guardians/${guardian.id}`, {
      updatedAt: guardian.updatedAt,
      firstName: 'Late',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
    const invalid = await api('PATCH', `/guardians/${guardian.id}`, {
      updatedAt: updated.body.updatedAt,
      email: 'nope',
    });
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body.error.fields)).toEqual(['email']);
  });

  it('keeps a billing contact: it changes hands before that guardian can be deleted', async () => {
    const { api, addFamily, addGuardian, getFamily, lastAudit } = await setup();
    const family = await addFamily();
    const other = await addFamily('Other');
    const mere = await addGuardian(family.id);
    const tane = await addGuardian(family.id, { firstName: 'Tane' });
    const stranger = await addGuardian(other.id, { firstName: 'Sam' });

    const refused = await api('DELETE', `/guardians/${mere.id}`);
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toBe(
      "This guardian is the family's billing contact. Make another guardian the billing contact first.",
    );

    // Only one of the family's own guardians can take over.
    const current = await getFamily(family.id);
    const patch = (billingGuardianId: string) =>
      api('PATCH', `/families/${family.id}`, { updatedAt: current.updatedAt, billingGuardianId });
    for (const id of [stranger.id, 'gdn_nope']) {
      const wrong = await patch(id);
      expect(wrong.status).toBe(422);
      expect(wrong.body.error.fields).toEqual({
        billingGuardianId: ['Not a guardian of this family'],
      });
    }
    const switched = await patch(tane.id);
    expect(switched.status).toBe(200);
    expect(switched.body.billingGuardianId).toBe(tane.id);

    expect((await api('DELETE', `/guardians/${mere.id}`)).status).toBe(204);
    expect((await lastAudit())[0]).toMatchObject({
      action: 'guardian.deleted',
      entityId: mere.id,
    });
    expect((await getFamily(family.id)).guardians.map((g) => g.id)).toEqual([tane.id]);
    // The last guardian is the billing contact, so they stay until the family goes.
    expect((await api('DELETE', `/guardians/${tane.id}`)).status).toBe(422);
  });

  it('returns 404 for a family or guardian the org does not have', async () => {
    const { api, addFamily, addGuardian } = await setup();
    const family = await addFamily();
    const gone = await addGuardian(family.id);
    const kept = await addGuardian(family.id, { firstName: 'Tane' });
    await api('PATCH', `/families/${family.id}`, {
      updatedAt: (await api('GET', `/families/${family.id}`)).body.updatedAt,
      billingGuardianId: kept.id,
    });
    await api('DELETE', `/guardians/${gone.id}`);

    const results = await Promise.all([
      api('POST', '/families/fam_nope/guardians', { firstName: 'A', lastName: 'B' }),
      api('PATCH', '/guardians/gdn_nope', { updatedAt: kept.updatedAt, firstName: 'A' }),
      api('DELETE', '/guardians/gdn_nope'),
      api('PATCH', `/guardians/${gone.id}`, { updatedAt: gone.updatedAt, firstName: 'A' }),
      api('DELETE', `/guardians/${gone.id}`),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
  });
});

describe('students', () => {
  it('adds a student with a grade level, reads, lists, updates and deletes them', async () => {
    const { api, addFamily, addGrade, addYear, main, lastAudit } = await setup();
    const family = await addFamily();
    const year = await addYear('This year', -100, 200);
    const year10 = await addGrade('Year 10');

    const created = await api('POST', '/students', {
      familyId: family.id,
      firstName: ' Aroha',
      lastName: 'Perera ',
      dateOfBirth: '2012-05-17',
      notes: 'Allergic to peanuts',
      gradeLevelId: year10.id,
    });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.stringMatching(/^stu_/),
      familyId: family.id,
      branchId: main.id,
      firstName: 'Aroha',
      lastName: 'Perera',
      dateOfBirth: '2012-05-17',
      notes: 'Allergic to peanuts',
      gradeLevelId: year10.id,
      grades: [{ academicYearId: year.id, gradeLevelId: year10.id }],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const id = created.body.id as string;
    expect((await lastAudit())[0]).toMatchObject({
      action: 'student.created',
      entityId: id,
      after: {
        firstNameNorm: 'aroha',
        grade: { academicYearId: year.id, gradeLevelId: year10.id },
      },
    });

    expect((await api('GET', `/students/${id}`)).body).toEqual(created.body);
    expect((await api('GET', '/students')).body).toEqual({
      data: [created.body],
      nextCursor: null,
    });

    const updated = await api('PATCH', `/students/${id}`, {
      updatedAt: created.body.updatedAt,
      firstName: 'Aroha-Rose',
      dateOfBirth: null,
      notes: null,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      firstName: 'Aroha-Rose',
      lastName: 'Perera',
      dateOfBirth: null,
      notes: null,
      gradeLevelId: year10.id,
    });

    expect((await api('DELETE', `/students/${id}`)).status).toBe(204);
    expect((await api('GET', `/students/${id}`)).status).toBe(404);
    expect((await api('GET', '/students')).body.data).toEqual([]);
    expect((await api('GET', `/families/${family.id}`)).body.students).toEqual([]);
    expect((await lastAudit(2)).map((e) => e.action)).toEqual([
      'student.deleted',
      'student.updated',
    ]);
  });

  it('adds a student with no grade level', async () => {
    const { addFamily, addStudent } = await setup();
    const family = await addFamily();
    const student = await addStudent(family.id);
    expect(student).toMatchObject({
      dateOfBirth: null,
      notes: null,
      gradeLevelId: null,
      grades: [],
    });
  });

  const names = { familyId: 'fam_x', firstName: 'Aroha', lastName: 'Perera' };
  it.each<[Record<string, unknown>, string[]]>([
    [{}, ['familyId', 'firstName', 'lastName']],
    [{ ...names, firstName: '' }, ['firstName']],
    [{ ...names, lastName: 'x'.repeat(81) }, ['lastName']],
    [{ ...names, dateOfBirth: '2012-02-30' }, ['dateOfBirth']],
    [{ ...names, dateOfBirth: '17/05/2012' }, ['dateOfBirth']],
    [{ ...names, notes: 'x'.repeat(2001) }, ['notes']],
    [{ ...names, academicYearId: 'acy_x' }, ['academicYearId']],
  ])('rejects an invalid student %j with 400', async (body, fields) => {
    const { api } = await setup();
    const res = await api('POST', '/students', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.fields)).toEqual(fields);
  });

  it('rejects a date of birth in the future, on create and on update', async () => {
    const { api, addFamily, addStudent } = await setup();
    const family = await addFamily();
    const tomorrow = addDays(today(), 1);

    const created = await api('POST', '/students', {
      familyId: family.id,
      firstName: 'Not',
      lastName: 'Yet',
      dateOfBirth: tomorrow,
    });
    expect(created.status).toBe(400);
    expect(created.body.error.fields).toEqual({ dateOfBirth: ['In the future'] });

    const student = await addStudent(family.id, { dateOfBirth: today() });
    const patched = await api('PATCH', `/students/${student.id}`, {
      updatedAt: student.updatedAt,
      dateOfBirth: tomorrow,
    });
    expect(patched.status).toBe(400);
    expect(patched.body.error.fields).toEqual({ dateOfBirth: ['In the future'] });
  });

  it('returns 404 for a family, grade level or academic year the org does not have', async () => {
    const { api, addFamily, addGrade, addYear } = await setup();
    const other = await setup();
    const family = await addFamily();
    const grade = await addGrade('Year 10');
    await addYear('This year', -100, 200);
    const othersFamily = await other.addFamily();
    const othersGrade = await other.addGrade('Year 10');
    const othersYear = await other.addYear('Their year', -100, 200);
    const body = { familyId: family.id, firstName: 'Aroha', lastName: 'Perera' };

    const results = await Promise.all([
      api('POST', '/students', { ...body, familyId: 'fam_nope' }),
      api('POST', '/students', { ...body, familyId: othersFamily.id }),
      api('POST', '/students', { ...body, gradeLevelId: 'grd_nope' }),
      api('POST', '/students', { ...body, gradeLevelId: othersGrade.id }),
      api('POST', '/students', { ...body, gradeLevelId: grade.id, academicYearId: 'acy_nope' }),
      api('POST', '/students', { ...body, gradeLevelId: grade.id, academicYearId: othersYear.id }),
      api('GET', '/students/stu_nope'),
      api('DELETE', '/students/stu_nope'),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404]);
    expect((await api('GET', '/students')).body.data).toEqual([]);
  });

  it('keeps one grade level per academic year, and shows the current year’s', async () => {
    const { api, addFamily, addStudent, addGrade, addYear, lastAudit } = await setup();
    const family = await addFamily();
    const [y9, y10, y11] = [
      await addGrade('Year 9'),
      await addGrade('Year 10'),
      await addGrade('Year 11'),
    ];
    // Added out of order: the history still comes back earliest year first.
    const next = await addYear('Next year', 201, 500);
    const thisYear = await addYear('This year', -100, 200);
    const last = await addYear('Last year', -500, -101);

    const student = await addStudent(family.id, { gradeLevelId: y11.id, academicYearId: next.id });
    expect(student).toMatchObject({
      gradeLevelId: null,
      grades: [{ academicYearId: next.id, gradeLevelId: y11.id }],
    });

    const patch = async (body: Record<string, unknown>) => {
      const before = (await api('GET', `/students/${student.id}`)).body as Student;
      const res = await api('PATCH', `/students/${student.id}`, {
        updatedAt: before.updatedAt,
        ...body,
      });
      return { before, res };
    };

    // No year named: the current one.
    const current = await patch({ gradeLevelId: y9.id });
    expect(current.res.status).toBe(200);
    expect(current.res.body.gradeLevelId).toBe(y9.id);
    // Only the grade changed, and updatedAt still moved.
    expect(current.res.body.updatedAt).not.toBe(current.before.updatedAt);
    expect((await lastAudit())[0]).toMatchObject({
      action: 'student.updated',
      before: { grade: { academicYearId: thisYear.id, gradeLevelId: null } },
      after: { grade: { academicYearId: thisYear.id, gradeLevelId: y9.id } },
    });

    await patch({ gradeLevelId: y9.id, academicYearId: last.id });
    // A second grade for the same year replaces the first.
    const changed = await patch({ gradeLevelId: y10.id });
    expect(changed.res.body).toMatchObject({
      gradeLevelId: y10.id,
      grades: [
        { academicYearId: last.id, gradeLevelId: y9.id },
        { academicYearId: thisYear.id, gradeLevelId: y10.id },
        { academicYearId: next.id, gradeLevelId: y11.id },
      ],
    });
    expect((await lastAudit())[0]).toMatchObject({
      before: { grade: { academicYearId: thisYear.id, gradeLevelId: y9.id } },
      after: { grade: { academicYearId: thisYear.id, gradeLevelId: y10.id } },
    });

    // Setting the same grade again changes nothing.
    const same = await patch({ gradeLevelId: y10.id });
    expect(same.res.body.updatedAt).toBe(same.before.updatedAt);

    // null removes a year's grade.
    const removed = await patch({ gradeLevelId: null, academicYearId: next.id });
    expect(removed.res.status).toBe(200);
    expect(
      removed.res.body.grades.map((g: { academicYearId: string }) => g.academicYearId),
    ).toEqual([last.id, thisYear.id]);
    const removedCurrent = await patch({ gradeLevelId: null });
    expect(removedCurrent.res.body.gradeLevelId).toBeNull();
    // Removing one that isn't there is fine.
    expect((await patch({ gradeLevelId: null })).res.status).toBe(200);

    const { before } = await patch({});
    const bad = await Promise.all([
      api('PATCH', `/students/${student.id}`, {
        updatedAt: before.updatedAt,
        academicYearId: next.id,
      }),
      api('PATCH', `/students/${student.id}`, {
        updatedAt: before.updatedAt,
        gradeLevelId: 'grd_nope',
      }),
      api('PATCH', `/students/${student.id}`, {
        updatedAt: before.updatedAt,
        gradeLevelId: y9.id,
        academicYearId: 'acy_nope',
      }),
    ]);
    expect(bad.map((r) => r.status)).toEqual([400, 404, 404]);
    expect(Object.keys(bad[0]!.body.error.fields)).toEqual(['academicYearId']);
  });

  it('takes the last year to end as current between years, and the first one before any starts', async () => {
    const between = await setup();
    const grade = await between.addGrade('Year 10');
    const ended = await between.addYear('Ended', -400, -10);
    await between.addYear('Not started', 10, 400);
    const family = await between.addFamily();
    const student = await between.addStudent(family.id, { gradeLevelId: grade.id });
    expect(student.grades).toEqual([{ academicYearId: ended.id, gradeLevelId: grade.id }]);
    expect(student.gradeLevelId).toBe(grade.id);

    const early = await setup();
    const earlyGrade = await early.addGrade('Year 10');
    await early.addYear('Later', 400, 700);
    const first = await early.addYear('First', 10, 399);
    const earlyFamily = await early.addFamily();
    const earlyStudent = await early.addStudent(earlyFamily.id, { gradeLevelId: earlyGrade.id });
    expect(earlyStudent.grades).toEqual([
      { academicYearId: first.id, gradeLevelId: earlyGrade.id },
    ]);
    expect(earlyStudent.gradeLevelId).toBe(earlyGrade.id);
  });

  it('needs an academic year before a student can have a grade level', async () => {
    const { api, addFamily, addStudent, addGrade } = await setup();
    const family = await addFamily();
    const grade = await addGrade('Year 10');

    const created = await api('POST', '/students', {
      familyId: family.id,
      firstName: 'Aroha',
      lastName: 'Perera',
      gradeLevelId: grade.id,
    });
    expect(created.status).toBe(422);
    expect(created.body.error).toMatchObject({
      code: 'unprocessable',
      fields: { gradeLevelId: ['No academic year yet'] },
    });

    const student = await addStudent(family.id);
    const patched = await api('PATCH', `/students/${student.id}`, {
      updatedAt: student.updatedAt,
      gradeLevelId: grade.id,
    });
    expect(patched.status).toBe(422);
    // Nothing to remove, and nobody to find.
    const cleared = await api('PATCH', `/students/${student.id}`, {
      updatedAt: student.updatedAt,
      gradeLevelId: null,
    });
    expect(cleared.status).toBe(200);
    expect((await api('GET', `/students?gradeLevelId=${grade.id}`)).body).toEqual({
      data: [],
      nextCursor: null,
    });
  });

  it('returns 409 for a stale updatedAt, the student when nothing changes, and keeps their family', async () => {
    const { api, addFamily, addStudent } = await setup();
    const family = await addFamily();
    const other = await addFamily('Other');
    const student = await addStudent(family.id);

    const same = await api('PATCH', `/students/${student.id}`, {
      updatedAt: student.updatedAt,
      familyId: other.id,
    });
    expect(same.status).toBe(200);
    expect(same.body).toEqual(student);

    const missing = await api('PATCH', `/students/${student.id}`, { firstName: 'Kai' });
    expect(missing.status).toBe(400);
    expect(Object.keys(missing.body.error.fields)).toEqual(['updatedAt']);

    await api('PATCH', `/students/${student.id}`, {
      updatedAt: student.updatedAt,
      firstName: 'Kai',
    });
    const stale = await api('PATCH', `/students/${student.id}`, {
      updatedAt: student.updatedAt,
      firstName: 'Late',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });

  it('lists in last name, first name order, pages, and filters', async () => {
    const { api, make, addFamily, addStudent, addGrade, addYear } = await setup();
    const albany = await make<Row>('/branches', { name: 'Albany' });
    const [y9, y10] = [await addGrade('Year 9'), await addGrade('Year 10')];
    const last = await addYear('Last year', -500, -101);
    await addYear('This year', -100, 200);
    const perera = await addFamily('Perera');
    const silva = await addFamily('Silva', { branchId: albany.id });
    const add = (familyId: string, firstName: string, lastName: string, gradeLevelId?: string) =>
      addStudent(familyId, { firstName, lastName, gradeLevelId });
    await add(silva.id, 'Zoë', 'Silva', y10.id);
    await add(perera.id, 'kai', 'Perera', y9.id);
    const aroha = await add(perera.id, 'Aroha', 'Perera', y10.id);
    await add(perera.id, 'Aroha', 'Perera');
    await add(silva.id, 'Ana', 'de Silva');
    const names = async (query = '') =>
      (await api('GET', `/students${query}`)).body.data.map(
        (s: Student) => `${s.firstName} ${s.lastName}`,
      ) as string[];
    const expected = ['Ana de Silva', 'Aroha Perera', 'Aroha Perera', 'kai Perera', 'Zoë Silva'];

    const all = await api('GET', '/students');
    expect(all.body.data.map((s: Student) => `${s.firstName} ${s.lastName}`)).toEqual(expected);
    // The two with the same name keep the order they were added in.
    expect(all.body.data[1].id).toBe(aroha.id);

    expect(await names(`?familyId=${perera.id}`)).toEqual(expected.slice(1, 4));
    expect(await names(`?branchId=${albany.id}`)).toEqual(['Ana de Silva', 'Zoë Silva']);
    expect(await names(`?gradeLevelId=${y10.id}`)).toEqual(['Aroha Perera', 'Zoë Silva']);
    expect(await names(`?gradeLevelId=${y10.id}&branchId=${albany.id}`)).toEqual(['Zoë Silva']);
    expect(await names(`?gradeLevelId=${y9.id}&familyId=${perera.id}`)).toEqual(['kai Perera']);
    // Nobody had a grade last year, until one student is given one.
    expect(await names(`?gradeLevelId=${y9.id}&academicYearId=${last.id}`)).toEqual([]);
    await api('PATCH', `/students/${aroha.id}`, {
      updatedAt: aroha.updatedAt,
      gradeLevelId: y9.id,
      academicYearId: last.id,
    });
    expect(await names(`?gradeLevelId=${y9.id}&academicYearId=${last.id}`)).toEqual([
      'Aroha Perera',
    ]);

    const paged: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await api('GET', `/students?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      paged.push(...res.body.data.map((s: Student) => s.id));
      cursor = res.body.nextCursor as string | null;
      pages++;
    } while (cursor && pages < 10);
    expect(paged).toEqual(all.body.data.map((s: Student) => s.id));
    expect(pages).toBe(3);

    const bad = await Promise.all([
      api('GET', '/students?familyId=fam_nope'),
      api('GET', '/students?branchId=brn_nope'),
      api('GET', '/students?gradeLevelId=grd_nope'),
      api('GET', `/students?gradeLevelId=${y9.id}&academicYearId=acy_nope`),
      api('GET', `/students?academicYearId=${last.id}`),
      api('GET', '/students?limit=201'),
    ]);
    expect(bad.map((r) => r.status)).toEqual([404, 404, 404, 404, 400, 400]);
  });
});

describe('records a family or student uses', () => {
  it('refuses to delete a grade level a student has been in, or a family’s home branch', async () => {
    const { api, make, addFamily, addStudent, addGrade, addYear } = await setup();
    const albany = await make<Row>('/branches', { name: 'Albany' });
    const grade = await addGrade('Year 10');
    await addYear('This year', -100, 200);
    const family = await addFamily('Perera', { branchId: albany.id });
    const student = await addStudent(family.id, { gradeLevelId: grade.id });

    const gradeRefused = await api('DELETE', `/grade-levels/${grade.id}`);
    expect(gradeRefused.status).toBe(422);
    expect(gradeRefused.body.error.message).toBe(
      '1 student grade record(s) use this grade level. Change them first.',
    );
    const branchRefused = await api('DELETE', `/branches/${albany.id}`);
    expect(branchRefused.status).toBe(422);
    expect(branchRefused.body.error.message).toBe(
      '1 family(ies) have this as their home branch. Move them to another branch first.',
    );

    // Taking the grade off the student, or deleting the student, frees the grade level.
    await api('PATCH', `/students/${student.id}`, {
      updatedAt: student.updatedAt,
      gradeLevelId: null,
    });
    expect((await api('DELETE', `/grade-levels/${grade.id}`)).status).toBe(204);
    const y11 = await addGrade('Year 11');
    const second = await addStudent(family.id, { firstName: 'Kai', gradeLevelId: y11.id });
    expect((await api('DELETE', `/grade-levels/${y11.id}`)).status).toBe(422);
    await api('DELETE', `/students/${second.id}`);
    expect((await api('DELETE', `/grade-levels/${y11.id}`)).status).toBe(204);

    // Deleting the family (once its students are gone) frees the branch.
    await api('DELETE', `/students/${student.id}`);
    await api('DELETE', `/families/${family.id}`);
    expect((await api('DELETE', `/branches/${albany.id}`)).status).toBe(204);
  });
});

describe('org isolation', () => {
  it("can't read or change another org's families, guardians and students through any route", async () => {
    const alice = await setup();
    const family = await alice.addFamily();
    const guardian = await alice.addGuardian(family.id);
    const student = await alice.addStudent(family.id);
    const bob = await setup();
    const asBobOnAlice = (method: string, path: string, body?: unknown) =>
      call(method, `${alice.base}${path}`, { token: bob.owner.token, body });

    const results = await Promise.all([
      bob.api('GET', `/families/${family.id}`),
      bob.api('PATCH', `/families/${family.id}`, { updatedAt: family.updatedAt, name: 'X' }),
      bob.api('DELETE', `/families/${family.id}`),
      bob.api('POST', `/families/${family.id}/guardians`, { firstName: 'A', lastName: 'B' }),
      bob.api('PATCH', `/guardians/${guardian.id}`, { updatedAt: guardian.updatedAt, phone: null }),
      bob.api('DELETE', `/guardians/${guardian.id}`),
      bob.api('GET', `/students/${student.id}`),
      bob.api('PATCH', `/students/${student.id}`, { updatedAt: student.updatedAt, notes: 'X' }),
      bob.api('DELETE', `/students/${student.id}`),
      bob.api('POST', '/students', { familyId: family.id, firstName: 'A', lastName: 'B' }),
      bob.api('GET', `/students?familyId=${family.id}`),
      asBobOnAlice('GET', '/families'),
      asBobOnAlice('GET', '/students'),
      asBobOnAlice('POST', '/families', { name: 'X', branchId: alice.main.id }),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(14).fill(404));

    expect((await bob.api('GET', '/families')).body.data).toEqual([]);
    expect((await bob.api('GET', '/students')).body.data).toEqual([]);
    const untouched = await alice.getFamily(family.id);
    expect(untouched.name).toBe('Perera');
    expect(untouched.guardians).toHaveLength(1);
    expect(untouched.students).toHaveLength(1);
  });
});

describe('permissions', () => {
  /** A family with a guardian and a student in each of two branches. */
  async function twoBranches() {
    const org = await setup();
    const albany = await org.make<Row>('/branches', { name: 'Albany' });
    const mainFamily = await org.addFamily('Main family');
    const mainGuardian = await org.addGuardian(mainFamily.id);
    const mainStudent = await org.addStudent(mainFamily.id, { firstName: 'Mia' });
    const albanyFamily = await org.addFamily('Albany family', { branchId: albany.id });
    const albanyGuardian = await org.addGuardian(albanyFamily.id, { firstName: 'Ana' });
    const albanyStudent = await org.addStudent(albanyFamily.id, { firstName: 'Ari' });
    return {
      ...org,
      albany,
      mainFamily: await org.getFamily(mainFamily.id),
      mainGuardian,
      mainStudent,
      albanyFamily: await org.getFamily(albanyFamily.id),
      albanyGuardian,
      albanyStudent,
    };
  }
  type T = Awaited<ReturnType<typeof twoBranches>>;
  type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;
  const familyNames = async (as: As) =>
    (await as('GET', '/families')).body.data.map((f: Family) => f.name) as string[];
  const studentNames = async (as: As) =>
    (await as('GET', '/students')).body.data.map((s: Student) => s.firstName) as string[];
  /** Every write route, aimed at the Main branch's records. */
  const writesOnMain = (as: As, t: T) =>
    Promise.all([
      as('POST', '/families', { name: 'New', branchId: t.main.id }),
      as('PATCH', `/families/${t.mainFamily.id}`, { updatedAt: t.mainFamily.updatedAt, name: 'X' }),
      as('DELETE', `/families/${t.mainFamily.id}`),
      as('POST', `/families/${t.mainFamily.id}/guardians`, { firstName: 'A', lastName: 'B' }),
      as('PATCH', `/guardians/${t.mainGuardian.id}`, {
        updatedAt: t.mainGuardian.updatedAt,
        phone: null,
      }),
      as('DELETE', `/guardians/${t.mainGuardian.id}`),
      as('POST', '/students', { familyId: t.mainFamily.id, firstName: 'A', lastName: 'B' }),
      as('PATCH', `/students/${t.mainStudent.id}`, {
        updatedAt: t.mainStudent.updatedAt,
        notes: 'X',
      }),
      as('DELETE', `/students/${t.mainStudent.id}`),
    ]);

  it('refuses an accountant on every route', async () => {
    const t = await twoBranches();
    const { as } = await t.member('accountant');
    const reads = await Promise.all([
      as('GET', '/families'),
      as('GET', `/families/${t.mainFamily.id}`),
      as('GET', '/students'),
      as('GET', `/students/${t.mainStudent.id}`),
    ]);
    expect(reads.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect((await writesOnMain(as, t)).map((r) => r.status)).toEqual(Array(9).fill(403));
  });

  it('shows a teacher with no enrolled students no families or students, and lets them change nothing', async () => {
    const t = await twoBranches();
    const { as } = await t.member('teacher');
    expect(await familyNames(as)).toEqual([]);
    expect(await studentNames(as)).toEqual([]);
    expect((await as('GET', `/families/${t.mainFamily.id}`)).status).toBe(404);
    expect((await as('GET', `/students/${t.mainStudent.id}`)).status).toBe(404);
    expect((await writesOnMain(as, t)).map((r) => r.status)).toEqual(Array(9).fill(403));
  });

  it('lets a parent read only the family they are a signed-in guardian of', async () => {
    const t = await twoBranches();
    const parent = await t.member('parent');
    const stranger = await t.member('parent');
    // What accepting an invite will do: tie the guardian to the parent's membership.
    await db()
      .update(guardians)
      .set({ membershipId: parent.id })
      .where(eq(guardians.id, t.mainGuardian.id));
    const { as } = parent;

    expect(await familyNames(as)).toEqual(['Main family']);
    expect(await studentNames(as)).toEqual(['Mia']);
    const own = await as('GET', `/families/${t.mainFamily.id}`);
    expect(own.status).toBe(200);
    expect(own.body.guardians[0]).toMatchObject({ id: t.mainGuardian.id, membershipId: parent.id });
    expect((await as('GET', `/students/${t.mainStudent.id}`)).status).toBe(200);
    expect((await as('GET', `/families/${t.albanyFamily.id}`)).status).toBe(404);
    expect((await as('GET', `/students/${t.albanyStudent.id}`)).status).toBe(404);
    expect((await as('GET', `/students?familyId=${t.albanyFamily.id}`)).status).toBe(404);
    expect((await writesOnMain(as, t)).map((r) => r.status)).toEqual(Array(9).fill(403));

    // A parent who isn't tied to a guardian sees nothing.
    expect(await familyNames(stranger.as)).toEqual([]);
    expect(await studentNames(stranger.as)).toEqual([]);
    expect((await stranger.as('GET', `/families/${t.mainFamily.id}`)).status).toBe(404);
  });

  it.each(['branch_manager', 'front_desk'] as Role[])(
    'keeps a %s limited to one branch inside that branch',
    async (role) => {
      const t = await twoBranches();
      const staff = await t.member(role, [t.albany.id]);
      const { as } = staff;

      expect(await familyNames(as)).toEqual(['Albany family']);
      expect(await studentNames(as)).toEqual(['Ari']);
      expect((await as('GET', `/families?branchId=${t.main.id}`)).body.data).toEqual([]);
      const outside = await Promise.all([
        as('GET', `/families/${t.mainFamily.id}`),
        as('GET', `/students/${t.mainStudent.id}`),
        as('GET', `/students?familyId=${t.mainFamily.id}`),
      ]);
      expect(outside.map((r) => r.status)).toEqual([404, 404, 404]);
      // Adding a family to a branch they can see but don't work in is refused, not hidden;
      // everything else on the Main branch's records looks like it isn't there.
      expect((await writesOnMain(as, t)).map((r) => r.status)).toEqual([
        403, 404, 404, 404, 404, 404, 404, 404, 404,
      ]);
      const moveOut = await as('PATCH', `/families/${t.albanyFamily.id}`, {
        updatedAt: t.albanyFamily.updatedAt,
        branchId: t.main.id,
      });
      expect(moveOut.status).toBe(403);
      const untouched = await t.getFamily(t.mainFamily.id);
      expect(untouched).toMatchObject({ name: 'Main family', branchId: t.main.id });
      expect(untouched.students).toHaveLength(1);

      // Inside their branch they do everything, and the audit rows name them.
      const family = await as('POST', '/families', { name: 'New family', branchId: t.albany.id });
      expect(family.status).toBe(201);
      const guardian = await as('POST', `/families/${family.body.id}/guardians`, {
        firstName: 'Sam',
        lastName: 'New',
      });
      expect(guardian.status).toBe(201);
      const student = await as('POST', '/students', {
        familyId: family.body.id,
        firstName: 'Kiri',
        lastName: 'New',
      });
      expect(student.status).toBe(201);
      const renamed = await as('PATCH', `/students/${student.body.id}`, {
        updatedAt: student.body.updatedAt,
        firstName: 'Kiri-Jane',
      });
      expect(renamed.status).toBe(200);
      expect((await as('DELETE', `/students/${student.body.id}`)).status).toBe(204);
      expect((await as('DELETE', `/families/${family.body.id}`)).status).toBe(204);
      expect((await t.lastAudit(6)).map((e) => [e.action, e.actorUserId])).toEqual([
        ['family.deleted', staff.userId],
        ['student.deleted', staff.userId],
        ['student.updated', staff.userId],
        ['student.created', staff.userId],
        ['guardian.created', staff.userId],
        ['family.created', staff.userId],
      ]);
    },
  );

  it('lets branch staff with no branch limit work in every branch', async () => {
    const t = await twoBranches();
    const { as } = await t.member('front_desk');
    expect(await familyNames(as)).toEqual(['Albany family', 'Main family']);
    expect(await studentNames(as)).toEqual(['Ari', 'Mia']);
    const moved = await as('PATCH', `/families/${t.albanyFamily.id}`, {
      updatedAt: t.albanyFamily.updatedAt,
      branchId: t.main.id,
    });
    expect(moved.status).toBe(200);
  });
});
