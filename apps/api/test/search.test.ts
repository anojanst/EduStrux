import { guardians, memberships } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// Search and duplicate warnings (TUI-43): the start of a name, or an exact email, phone or bank
// reference, within the caller's reach (D-026).

const TZ = 'Pacific/Auckland';
const firstDay = () => addDays(localNow(TZ).date, -30);

type Row = { id: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

/**
 * An org with two branches.
 * - Main: the Perera family, with Mere (mere.perera@example.com, +64 21 555 0100) and the
 *   children Aroha and Sam. Aroha is in the Main class, which `teacher` teaches.
 * - Albany: the Ngata family, with Ana and the child Ari.
 */
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
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, as };
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const albany = await make('/branches', { name: 'Albany' });
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', { subjectId: subject.id, gradeLevelId: grade.id });
  const teacher = await member('teacher');
  const mainClass = await make('/classes', {
    courseId: course.id,
    branchId: main.id,
    name: 'Main group',
    startDate: firstDay(),
    teacherId: teacher.id,
  });

  const perera = await make<Row & { bankReference: string }>('/families', {
    name: 'Perera',
    branchId: main.id,
  });
  const mere = await make(`/families/${perera.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
    email: 'mere.perera@example.com',
    phone: '+64 21 555 0100',
  });
  const aroha = await make('/students', {
    familyId: perera.id,
    firstName: 'Aroha',
    lastName: 'Perera',
    dateOfBirth: '2012-05-17',
  });
  const sam = await make('/students', {
    familyId: perera.id,
    firstName: 'Sam',
    lastName: 'Perera',
  });
  const ngata = await make('/families', { name: 'Ngata', branchId: albany.id });
  await make(`/families/${ngata.id}/guardians`, { firstName: 'Ana', lastName: 'Ngata' });
  const ari = await make('/students', { familyId: ngata.id, firstName: 'Ari', lastName: 'Ngata' });
  await make('/enrolments', { studentId: aroha.id, classId: mainClass.id, startDate: firstDay() });

  return { org, base, api, member, main, albany, teacher, perera, mere, aroha, sam, ngata, ari };
}

const ids = (rows: Row[]) => rows.map((row) => row.id);
const q = (text: string) => `/search?q=${encodeURIComponent(text)}`;

describe('GET /search', () => {
  it('finds people by the start of a name, either way round, ignoring case and accents', async () => {
    const { api, perera, mere, aroha, sam, ngata, ari, main } = await setup();

    const res = await api('GET', q('per'));
    expect(res.status).toBe(200);
    expect(res.body.families).toEqual([
      { id: perera.id, name: 'Perera', branchId: main.id, bankReference: expect.any(String) },
    ]);
    // By last name, then first name.
    expect(ids(res.body.students)).toEqual([aroha.id, sam.id]);
    expect(res.body.students[0]).toEqual({
      id: aroha.id,
      familyId: perera.id,
      familyName: 'Perera',
      branchId: main.id,
      firstName: 'Aroha',
      lastName: 'Perera',
      dateOfBirth: '2012-05-17',
    });
    expect(res.body.guardians).toEqual([
      {
        id: mere.id,
        familyId: perera.id,
        familyName: 'Perera',
        branchId: main.id,
        firstName: 'Mere',
        lastName: 'Perera',
        relationship: null,
        email: 'mere.perera@example.com',
        phone: '+64 21 555 0100',
      },
    ]);

    expect(ids((await api('GET', q('ARÓHA  per'))).body.students)).toEqual([aroha.id]);
    expect(ids((await api('GET', q('perera aro'))).body.students)).toEqual([aroha.id]);
    expect(ids((await api('GET', q('a'))).body.students)).toEqual([ari.id, aroha.id]);
    expect((await api('GET', q('ngata'))).body.families).toEqual([
      expect.objectContaining({ id: ngata.id }),
    ]);
    expect(await api('GET', q('zz'))).toMatchObject({
      status: 200,
      body: { families: [], students: [], guardians: [] },
    });
  });

  it('finds a guardian by exact email or phone, and a family by bank reference', async () => {
    const { api, mere, perera } = await setup();

    expect(ids((await api('GET', q('Mere.Perera@example.com'))).body.guardians)).toEqual([mere.id]);
    expect(ids((await api('GET', q('mere.perera@example'))).body.guardians)).toEqual([]);
    expect(ids((await api('GET', q('64215550100'))).body.guardians)).toEqual([mere.id]);
    expect(ids((await api('GET', q('+64 (21) 555-0100'))).body.guardians)).toEqual([mere.id]);
    expect(ids((await api('GET', q('6421555'))).body.guardians)).toEqual([]);
    const byReference = await api('GET', q(perera.bankReference.toLowerCase()));
    expect(ids(byReference.body.families)).toEqual([perera.id]);
  });

  it('keeps each list to the limit', async () => {
    const { api } = await setup();
    const res = await api('GET', `${q('p')}&limit=1`);
    expect(res.body.students).toHaveLength(1);
    expect(res.body.families).toHaveLength(1);
  });

  it('reads in one stage after sign-in', async () => {
    const { api, member, main } = await setup();
    expect((await api('GET', q('per'))).db.stages).toBeLessThanOrEqual(2);
    const desk = await member('front_desk', [main.id]);
    expect((await desk.as('GET', q('per'))).db.stages).toBeLessThanOrEqual(2);
  });

  it('refuses an empty or too long query', async () => {
    const { api } = await setup();
    const empty = await api('GET', q('  '));
    expect(empty.status).toBe(400);
    expect(empty.body.error.fields).toHaveProperty('q');
    expect((await api('GET', '/search')).status).toBe(400);
    expect((await api('GET', q('x'.repeat(101)))).status).toBe(400);
    expect((await api('GET', `${q('a')}&limit=51`)).status).toBe(400);
  });

  it('keeps branch staff to their branches', async () => {
    const { member, main, albany, aroha, sam, ari } = await setup();
    const mainDesk = await member('front_desk', [main.id]);
    const res = await mainDesk.as('GET', q('a'));
    expect(ids(res.body.students)).toEqual([aroha.id]);
    expect(ids((await mainDesk.as('GET', q('per'))).body.students)).toEqual([aroha.id, sam.id]);
    expect((await mainDesk.as('GET', q('ngata'))).body).toEqual({
      families: [],
      students: [],
      guardians: [],
    });
    const albanyManager = await member('branch_manager', [albany.id]);
    expect(ids((await albanyManager.as('GET', q('a'))).body.students)).toEqual([ari.id]);
  });

  it('keeps a teacher to their students, with those students’ families and guardians', async () => {
    const { teacher, aroha, perera, mere } = await setup();
    const res = await teacher.as('GET', q('per'));
    expect(res.status).toBe(200);
    // Sam, Aroha's brother, isn't in the teacher's class.
    expect(ids(res.body.students)).toEqual([aroha.id]);
    expect(ids(res.body.families)).toEqual([perera.id]);
    expect(ids(res.body.guardians)).toEqual([mere.id]);
    expect((await teacher.as('GET', q('ngata'))).body.families).toEqual([]);
  });

  it('keeps a parent to their own families', async () => {
    const { member, mere, perera, aroha, sam } = await setup();
    const parent = await member('parent');
    await db().update(guardians).set({ membershipId: parent.id }).where(eq(guardians.id, mere.id));
    const res = await parent.as('GET', q('a'));
    expect(ids(res.body.students)).toEqual([aroha.id]);
    expect(ids((await parent.as('GET', q('per'))).body.students)).toEqual([aroha.id, sam.id]);
    expect(ids((await parent.as('GET', q('per'))).body.families)).toEqual([perera.id]);
    expect((await parent.as('GET', q('ngata'))).body.families).toEqual([]);
  });

  it('is 403 for an accountant and 404 for another org', async () => {
    const { member, base } = await setup();
    const accountant = await member('accountant');
    expect((await accountant.as('GET', q('per'))).status).toBe(403);

    const stranger = await newUser('owner_b');
    await newOrg(stranger.token, 'Harmony Music School');
    expect((await call('GET', `${base}${q('per')}`, { token: stranger.token })).status).toBe(404);
  });
});

describe('GET /search/duplicates', () => {
  const dup = (params: Record<string, string>) =>
    `/search/duplicates?${new URLSearchParams(params).toString()}`;

  it('warns of a family with the same name', async () => {
    const { api, perera } = await setup();
    const res = await api('GET', dup({ kind: 'family', name: '  PERÉRA ' }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      families: [expect.objectContaining({ id: perera.id, reasons: ['same_name'] })],
      students: [],
      guardians: [],
    });
    // The start of a name isn't a duplicate.
    expect((await api('GET', dup({ kind: 'family', name: 'Per' }))).body.families).toEqual([]);
  });

  it('warns of a student with the same name, and says when the birth date matches too', async () => {
    const { api, aroha } = await setup();
    const sameName = await api(
      'GET',
      dup({ kind: 'student', firstName: 'aroha', lastName: 'PERERA' }),
    );
    expect(sameName.body.students).toEqual([
      expect.objectContaining({ id: aroha.id, reasons: ['same_name'] }),
    ]);
    const sameBirth = await api(
      'GET',
      dup({ kind: 'student', firstName: 'Aroha', lastName: 'Perera', dateOfBirth: '2012-05-17' }),
    );
    expect(sameBirth.body.students[0].reasons).toEqual(['same_name_and_birth_date']);
    const otherBirth = await api(
      'GET',
      dup({ kind: 'student', firstName: 'Aroha', lastName: 'Perera', dateOfBirth: '2013-01-01' }),
    );
    expect(otherBirth.body.students[0].reasons).toEqual(['same_name']);
  });

  it('warns of a guardian with the same name, email or phone, naming each reason', async () => {
    const { api, mere } = await setup();
    const all = await api(
      'GET',
      dup({
        kind: 'guardian',
        firstName: 'Mere',
        lastName: 'Perera',
        email: 'MERE.PERERA@example.com',
        phone: '64 21 5550100',
      }),
    );
    expect(all.body.guardians).toEqual([
      expect.objectContaining({ id: mere.id, reasons: ['same_name', 'same_email', 'same_phone'] }),
    ]);
    expect(all.body.guardians[0]).not.toHaveProperty('phoneNorm');
    const byPhone = await api('GET', dup({ kind: 'guardian', phone: '+64215550100' }));
    expect(byPhone.body.guardians[0].reasons).toEqual(['same_phone']);
    const none = await api('GET', dup({ kind: 'guardian', email: 'someone@example.com' }));
    expect(none.body.guardians).toEqual([]);
  });

  it('needs what the kind is matched on', async () => {
    const { api } = await setup();
    const family = await api('GET', dup({ kind: 'family' }));
    expect(family.status).toBe(400);
    expect(family.body.error.fields).toHaveProperty('name');
    const student = await api('GET', dup({ kind: 'student', firstName: 'Aroha' }));
    expect(student.body.error.fields).toHaveProperty('lastName');
    const guardian = await api('GET', dup({ kind: 'guardian', firstName: 'Mere' }));
    expect(guardian.status).toBe(400);
    expect((await api('GET', dup({ kind: 'teacher', name: 'x' }))).status).toBe(400);
  });

  it('checks only the families the caller reaches', async () => {
    const { member, albany } = await setup();
    const albanyDesk = await member('front_desk', [albany.id]);
    const res = await albanyDesk.as('GET', dup({ kind: 'family', name: 'Perera' }));
    expect(res.status).toBe(200);
    expect(res.body.families).toEqual([]);
  });

  it('is for those who add people: 403 for a teacher, parent or accountant', async () => {
    const { member } = await setup();
    for (const role of ['teacher', 'parent', 'accountant'] as const) {
      const someone = await member(role);
      expect((await someone.as('GET', dup({ kind: 'family', name: 'Perera' }))).status).toBe(403);
    }
  });

  it('is 404 for another org', async () => {
    const { base } = await setup();
    const stranger = await newUser('owner_b');
    await newOrg(stranger.token, 'Harmony Music School');
    const res = await call('GET', `${base}${dup({ kind: 'family', name: 'Perera' })}`, {
      token: stranger.token,
    });
    expect(res.status).toBe(404);
  });
});

describe('guardian phones', () => {
  it('keep their digits for search when added or changed', async () => {
    const { api, mere } = await setup();
    const before = await db().query.guardians.findFirst({
      where: (g, { eq }) => eq(g.id, mere.id),
    });
    expect(before!.phoneNorm).toBe('64215550100');
    const changed = await api('PATCH', `/guardians/${mere.id}`, {
      updatedAt: before!.updatedAt,
      phone: '021 999 000',
    });
    expect(changed.status).toBe(200);
    expect(changed.body).not.toHaveProperty('phoneNorm');
    expect(ids((await api('GET', q('021999000'))).body.guardians)).toEqual([mere.id]);
  });
});
