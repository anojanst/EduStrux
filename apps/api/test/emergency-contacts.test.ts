import { guardians, memberships } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// A class's emergency contacts (D-112): every child with an active enrolment in the class, with
// the guardians of their family marked as emergency contacts. Name, relationship and phone only.

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const firstDay = () => addDays(localNow(TZ).date, -30);

type Row = { id: string };
type Contact = {
  firstName: string;
  lastName: string;
  relationship: string | null;
  phone: string | null;
};
type OfStudent = {
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  contacts: Contact[];
};
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

/**
 * An owner with a fresh org and two branches, Main and Albany, each with a class that began a
 * month ago.
 * - Mia is of the Main branch and in both classes. Her family has Mere, her mother, who is an
 *   emergency contact, and Tom, who isn't.
 * - Ari is of Albany and in the Albany class. His family has Ana, who has no phone.
 * - Zoe is of Albany and in the Albany class, and her family has no guardians.
 * - Sam is Mia's brother and in no class.
 * - `teacher` teaches the Main class.
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
  /** A member of the org with the given role, optionally limited to some branches. */
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
  const addClass = (name: string, branchId: string, body: Record<string, unknown> = {}) =>
    make('/classes', { courseId: course.id, branchId, name, startDate: firstDay(), ...body });
  const mainClass = await addClass('Main group', main.id, { teacherId: teacher.id });
  const albanyClass = await addClass('Albany group', albany.id);

  const mainFamily = await make('/families', { name: 'Perera', branchId: main.id });
  const mere = await make(`/families/${mainFamily.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
    relationship: 'Mother',
    email: 'mere.perera@example.com',
    phone: '+64 21 555 0100',
  });
  await make(`/families/${mainFamily.id}/guardians`, {
    firstName: 'Tom',
    lastName: 'Perera',
    phone: '+64 21 555 0101',
    emergencyContact: false,
  });
  const ngata = await make('/families', { name: 'Ngata', branchId: albany.id });
  await make(`/families/${ngata.id}/guardians`, { firstName: 'Ana', lastName: 'Ngata' });
  const smith = await make('/families', { name: 'Smith', branchId: albany.id });

  const addStudent = (familyId: string, firstName: string, lastName: string) =>
    make('/students', { familyId, firstName, lastName });
  const mia = await addStudent(mainFamily.id, 'Mia', 'Perera');
  await addStudent(mainFamily.id, 'Sam', 'Perera');
  const ari = await addStudent(ngata.id, 'Ari', 'Ngata');
  const zoe = await addStudent(smith.id, 'Zoe', 'Smith');
  const enrol = (studentId: string, classId: string) =>
    make('/enrolments', { studentId, classId, startDate: firstDay() });
  await enrol(mia.id, mainClass.id);
  await enrol(mia.id, albanyClass.id);
  await enrol(ari.id, albanyClass.id);
  await enrol(zoe.id, albanyClass.id);

  return {
    owner,
    base,
    api,
    member,
    main,
    albany,
    teacher,
    mainClass,
    albanyClass,
    mainFamily,
    mere,
    mia,
    ari,
    zoe,
  };
}

const path = (classId: string) => `/classes/${classId}/emergency-contacts`;
const MERE = {
  firstName: 'Mere',
  lastName: 'Perera',
  relationship: 'Mother',
  phone: '+64 21 555 0100',
};
const ANA = { firstName: 'Ana', lastName: 'Ngata', relationship: null, phone: null };
/** Who a caller sees on a class's sheet, as "Mia: Mere", "Zoe: -" for nobody to call. */
const sheet = async (as: As, classId: string) =>
  ((await as('GET', path(classId))).body.students as OfStudent[]).map(
    (s) => `${s.studentFirstName}: ${s.contacts.map((c) => c.firstName).join(', ') || '-'}`,
  );

describe('emergency contacts', () => {
  it('lists every child on the class’s roster with the guardians to call, and nothing else', async () => {
    const t = await setup();

    const res = await t.api('GET', path(t.albanyClass.id));
    expect(res.status).toBe(200);
    // By last name; Tom isn't an emergency contact, Zoe's family has nobody, and Mere's email
    // and every guardian's id are left out.
    expect(res.body).toEqual({
      classId: t.albanyClass.id,
      students: [
        { studentId: t.ari.id, studentFirstName: 'Ari', studentLastName: 'Ngata', contacts: [ANA] },
        {
          studentId: t.mia.id,
          studentFirstName: 'Mia',
          studentLastName: 'Perera',
          contacts: [MERE],
        },
        { studentId: t.zoe.id, studentFirstName: 'Zoe', studentLastName: 'Smith', contacts: [] },
      ],
    });
    // Sam is Mia's brother but in no class.
    expect(await sheet(t.api, t.mainClass.id)).toEqual(['Mia: Mere']);
  });

  it('follows the emergency-contact flag as staff change it', async () => {
    const t = await setup();
    const [mere] = (await t.api('GET', `/families/${t.mainFamily.id}`)).body.guardians as (Row & {
      updatedAt: string;
    })[];
    const off = await t.api('PATCH', `/guardians/${mere!.id}`, {
      updatedAt: mere!.updatedAt,
      emergencyContact: false,
    });
    expect(off.status).toBe(200);
    expect(await sheet(t.api, t.mainClass.id)).toEqual(['Mia: -']);
  });

  it('lists nobody for a class with no one enrolled', async () => {
    const t = await setup();
    const empty = await t.api('POST', '/classes', {
      courseId: (await t.api('GET', '/courses')).body.data[0].id,
      branchId: t.main.id,
      name: 'Empty group',
      startDate: firstDay(),
    });
    const res = await t.api('GET', path(empty.body.id));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ classId: empty.body.id, students: [] });
  });

  it('returns 404 for a class the org does not have', async () => {
    const t = await setup();
    const res = await t.api('GET', path('cls_nope'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('org isolation', () => {
  it("can't read another org's class through its own org or the other one", async () => {
    const alice = await setup();
    const bob = await setup();
    const results = await Promise.all([
      bob.api('GET', path(alice.albanyClass.id)),
      call('GET', `${alice.base}${path(alice.albanyClass.id)}`, { token: bob.owner.token }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404]);
  });
});

describe('permissions', () => {
  it.each(['branch_manager', 'front_desk'] as Role[])(
    'gives a %s limited to the class’s branch the contacts of a child from another branch, and no more',
    async (role) => {
      const t = await setup();
      const { as } = await t.member(role, [t.albany.id]);

      const res = await as('GET', path(t.albanyClass.id));
      expect(res.status).toBe(200);
      expect(res.body.students.find((s: OfStudent) => s.studentId === t.mia.id).contacts).toEqual([
        MERE,
      ]);
      // Mia's record, her family and the Main branch's class stay out of reach.
      const outside = await Promise.all([
        as('GET', `/students/${t.mia.id}`),
        as('GET', `/families/${t.mainFamily.id}`),
        as('GET', path(t.mainClass.id)),
      ]);
      expect(outside.map((r) => r.status)).toEqual([404, 404, 404]);
    },
  );

  it('gives branch staff with no branch limit every class', async () => {
    const t = await setup();
    const { as } = await t.member('front_desk');
    expect(await sheet(as, t.mainClass.id)).toEqual(['Mia: Mere']);
    expect(await sheet(as, t.albanyClass.id)).toEqual(['Ari: Ana', 'Mia: Mere', 'Zoe: -']);
  });

  it('gives staff limited to no branches no class', async () => {
    const t = await setup();
    const { as } = await t.member('branch_manager', []);
    expect((await as('GET', path(t.albanyClass.id))).status).toBe(404);
  });

  it('gives a teacher the classes they teach, and no others', async () => {
    const t = await setup();
    expect(await sheet(t.teacher.as, t.mainClass.id)).toEqual(['Mia: Mere']);
    expect((await t.teacher.as('GET', path(t.albanyClass.id))).status).toBe(404);
  });

  // A parent reaches their own child's class, but the other children on it aren't theirs.
  it('refuses a parent, even for their own child’s class, and an accountant', async () => {
    const t = await setup();
    const parent = await t.member('parent');
    await db()
      .update(guardians)
      .set({ membershipId: parent.id })
      .where(eq(guardians.id, t.mere.id));
    const { as: accountant } = await t.member('accountant');

    const results = await Promise.all([
      parent.as('GET', path(t.albanyClass.id)),
      parent.as('GET', path(t.mainClass.id)),
      accountant('GET', path(t.albanyClass.id)),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403]);
    expect(results.map((r) => r.body.error.code)).toEqual(Array(3).fill('forbidden'));
    // The parent does reach the class itself.
    expect((await parent.as('GET', `/classes/${t.albanyClass.id}`)).status).toBe(200);
  });
});
