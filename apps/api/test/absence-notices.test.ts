import { guardians, memberships, sessions } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// Absence notices (D-129): a student is, or was, away from one date to another. The notice flags
// them on the roster of every lesson of theirs in those dates and marks nothing.

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const today = () => localNow(TZ).date;
const day = (n: number) => addDays(today(), n);

type Row = { id: string; updatedAt: string };
type Notice = Row & {
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  source: 'parent' | 'staff';
  createdAt: string;
};
type Flag = { id: string; reason: string | null; source: string } | null;
type RosterRecord = { studentFirstName: string; status: string | null; absenceNotice: Flag };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

/**
 * An owner with a fresh org and two branches, Main and Albany, each with a class that began a
 * month ago.
 * - Mia is of the Main branch and in both classes; Mere, her mother, signs in as `parent`.
 * - Ari is of Albany and in the Albany class.
 * - Sam is of the Main branch and in no class.
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
    return { id, userId: user.userId, as };
  };
  /** A session written straight to the database, at 4 pm on the given day. */
  const addSession = async (classId: string, date: string) => {
    const id = newId('session');
    await db()
      .insert(sessions)
      .values({ id, orgId: org.id, classId, date, startTime: '16:00', endTime: '17:00' });
    return id;
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const albany = await make('/branches', { name: 'Albany' });
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', { subjectId: subject.id, gradeLevelId: grade.id });
  const teacher = await member('teacher');
  const addClass = (name: string, branchId: string, body: Record<string, unknown> = {}) =>
    make('/classes', { courseId: course.id, branchId, name, startDate: day(-30), ...body });
  const mainClass = await addClass('Main group', main.id, { teacherId: teacher.id });
  const albanyClass = await addClass('Albany group', albany.id);

  const mainFamily = await make('/families', { name: 'Perera', branchId: main.id });
  const mere = await make(`/families/${mainFamily.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
  });
  const ngata = await make('/families', { name: 'Ngata', branchId: albany.id });
  const addStudent = (familyId: string, firstName: string, lastName: string) =>
    make('/students', { familyId, firstName, lastName });
  const mia = await addStudent(mainFamily.id, 'Mia', 'Perera');
  const ari = await addStudent(ngata.id, 'Ari', 'Ngata');
  const samFamily = await make('/families', { name: 'Silva', branchId: main.id });
  const sam = await addStudent(samFamily.id, 'Sam', 'Silva');
  const enrol = (studentId: string, classId: string) =>
    make('/enrolments', { studentId, classId, startDate: day(-30) });
  await enrol(mia.id, mainClass.id);
  await enrol(mia.id, albanyClass.id);
  await enrol(ari.id, albanyClass.id);

  const parent = await member('parent');
  // What accepting an invite will do: tie the guardian to the parent's membership.
  await db().update(guardians).set({ membershipId: parent.id }).where(eq(guardians.id, mere.id));

  const lastAudit = async () =>
    (
      (await api('GET', '/audit-log?limit=1')).body.data as {
        action: string;
        entityType: string;
        entityId: string;
        actorUserId: string;
        after: Record<string, unknown>;
      }[]
    )[0]!;
  const notices = async (as: As = api, query = '') =>
    (await as('GET', `/absence-notices${query}`)).body.data as Notice[];

  return {
    owner,
    base,
    api,
    make,
    member,
    addSession,
    main,
    albany,
    teacher,
    parent,
    mainClass,
    albanyClass,
    mia,
    ari,
    sam,
    lastAudit,
    notices,
  };
}

const roster = async (as: As, sessionId: string) =>
  (await as('GET', `/sessions/${sessionId}/attendance`)).body.records as RosterRecord[];
/** Who is flagged on a roster, as "Mia: Unwell (parent)", "Ari: -" for nobody. */
const flags = async (as: As, sessionId: string) =>
  (await roster(as, sessionId)).map(
    (r) =>
      `${r.studentFirstName}: ${r.absenceNotice ? `${r.absenceNotice.reason ?? '…'} (${r.absenceNotice.source})` : '-'}`,
  );

describe('absence notices', () => {
  it('records a notice, lists it, and writes an audit row', async () => {
    const { api, owner, mia, lastAudit, notices } = await setup();

    const res = await api('POST', '/absence-notices', {
      studentId: mia.id,
      startDate: day(1),
      endDate: day(3),
      reason: 'Family trip',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^abn_/),
      studentId: mia.id,
      studentFirstName: 'Mia',
      studentLastName: 'Perera',
      startDate: day(1),
      endDate: day(3),
      reason: 'Family trip',
      source: 'staff',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await notices()).toEqual([res.body]);

    const audit = await lastAudit();
    expect(audit).toMatchObject({
      action: 'absence_notice.created',
      entityType: 'absence_notice',
      entityId: res.body.id,
      actorUserId: owner.userId,
      after: { studentId: mia.id, startDate: day(1), endDate: day(3), source: 'staff' },
    });
  });

  it('is for one day when there is no end date, and has no reason unless one is given', async () => {
    const { api, mia } = await setup();
    const res = await api('POST', '/absence-notices', { studentId: mia.id, startDate: day(2) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startDate: day(2), endDate: day(2), reason: null });
  });

  it('can be for days already past: a parent may tell the centre afterwards', async () => {
    const { api, mia } = await setup();
    const res = await api('POST', '/absence-notices', { studentId: mia.id, startDate: day(-2) });
    expect(res.status).toBe(201);
  });

  // Fields sorted. The date order is only checked once the rest of the body is valid.
  const S = 'stu_any';
  it.each<[string, Record<string, unknown>, string[]]>([
    ['nothing', {}, ['startDate', 'studentId']],
    ['a date that isn’t one', { studentId: S, startDate: 'tomorrow' }, ['startDate']],
    [
      'an end before the start',
      { studentId: S, startDate: '2026-11-03', endDate: '2026-11-02' },
      ['endDate'],
    ],
    [
      'more than 366 days',
      { studentId: S, startDate: '2026-01-01', endDate: '2027-01-02' },
      ['endDate'],
    ],
    ['an empty reason', { studentId: S, startDate: '2026-01-01', reason: '' }, ['reason']],
    [
      'a reason over 500 characters',
      { studentId: S, startDate: '2026-01-01', reason: 'x'.repeat(501) },
      ['reason'],
    ],
  ])('rejects %s with 400', async (_what, body, fields) => {
    const { api } = await setup();
    const res = await api('POST', '/absence-notices', body);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(fields);
  });

  it('runs for at most 366 days, both ends included', async () => {
    const { api, mia } = await setup();
    const res = await api('POST', '/absence-notices', {
      studentId: mia.id,
      startDate: '2026-01-01',
      endDate: '2027-01-01',
    });
    expect(res.status).toBe(201);
  });

  it('returns 404 for a student the org does not have', async () => {
    const { api } = await setup();
    const res = await api('POST', '/absence-notices', { studentId: 'stu_nope', startDate: day(1) });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Student not found');
  });

  it('filters by student and by the dates a notice overlaps, and pages with a cursor', async () => {
    const { api, mia, ari, notices } = await setup();
    const add = async (studentId: string, startDate: string, endDate: string) =>
      (await api('POST', '/absence-notices', { studentId, startDate, endDate })).body as Notice;
    const early = await add(mia.id, day(1), day(2));
    const late = await add(mia.id, day(10), day(12));
    const aris = await add(ari.id, day(2), day(11));
    const ids = (list: Notice[]) => list.map((n) => n.id);

    expect(ids(await notices())).toEqual([early.id, late.id, aris.id]);
    expect(ids(await notices(api, `?studentId=${mia.id}`))).toEqual([early.id, late.id]);
    // Overlapping: ends on or after `from`, starts on or before `to`.
    expect(ids(await notices(api, `?from=${day(2)}&to=${day(2)}`))).toEqual([early.id, aris.id]);
    expect(ids(await notices(api, `?from=${day(3)}`))).toEqual([late.id, aris.id]);
    expect(ids(await notices(api, `?to=${day(1)}`))).toEqual([early.id]);

    const first = await api('GET', '/absence-notices?limit=2');
    expect(ids(first.body.data)).toEqual([early.id, late.id]);
    const second = await api('GET', `/absence-notices?limit=2&cursor=${first.body.nextCursor}`);
    expect(ids(second.body.data)).toEqual([aris.id]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('rejects `to` before `from` with 400, and an unknown student filter with 404', async () => {
    const { api } = await setup();
    const backwards = await api('GET', `/absence-notices?from=${day(3)}&to=${day(2)}`);
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.fields).toEqual({ to: ['Must be on or after from'] });
    expect((await api('GET', '/absence-notices?studentId=stu_nope')).status).toBe(404);
  });

  it('leaves out the notices of a student since deleted', async () => {
    const { api, sam, notices } = await setup();
    await api('POST', '/absence-notices', { studentId: sam.id, startDate: day(1) });
    expect((await api('DELETE', `/students/${sam.id}`)).status).toBe(204);
    expect(await notices()).toEqual([]);
  });
});

describe('on the roster', () => {
  it('flags the student on every lesson in its dates, and marks nothing', async () => {
    const t = await setup();
    const mainTomorrow = await t.addSession(t.mainClass.id, day(1));
    const albanyTomorrow = await t.addSession(t.albanyClass.id, day(1));
    const albanyLater = await t.addSession(t.albanyClass.id, day(5));
    const notice = await t.api('POST', '/absence-notices', {
      studentId: t.mia.id,
      startDate: day(1),
      endDate: day(2),
      reason: 'Unwell',
    });

    expect(await roster(t.api, mainTomorrow)).toEqual([
      expect.objectContaining({
        studentFirstName: 'Mia',
        status: null,
        absenceNotice: { id: notice.body.id, reason: 'Unwell', source: 'staff' },
      }),
    ]);
    expect(await flags(t.api, albanyTomorrow)).toEqual(['Ari: -', 'Mia: Unwell (staff)']);
    // Outside its dates.
    expect(await flags(t.api, albanyLater)).toEqual(['Ari: -', 'Mia: -']);
  });

  it('flags a lesson made after the notice, since it goes by date', async () => {
    const t = await setup();
    await t.api('POST', '/absence-notices', { studentId: t.ari.id, startDate: day(3) });
    const added = await t.addSession(t.albanyClass.id, day(3));
    expect(await flags(t.api, added)).toEqual(['Ari: … (staff)', 'Mia: -']);
  });

  it('shows the newest notice when two cover the day', async () => {
    const t = await setup();
    const session = await t.addSession(t.mainClass.id, day(1));
    await t.api('POST', '/absence-notices', {
      studentId: t.mia.id,
      startDate: day(0),
      endDate: day(7),
      reason: 'Away',
    });
    await t.parent.as('POST', '/portal/absence-notices', {
      studentId: t.mia.id,
      startDate: day(1),
      reason: 'Dentist',
    });
    expect(await flags(t.api, session)).toEqual(['Mia: Dentist (parent)']);
  });

  it('keeps the flag beside a mark, and in the roster a mark answers with', async () => {
    const t = await setup();
    const session = await t.addSession(t.mainClass.id, day(0));
    await t.api('POST', '/absence-notices', { studentId: t.mia.id, startDate: day(0) });
    const marked = await t.api('PUT', `/sessions/${session}/attendance`, {
      records: [{ studentId: t.mia.id, status: 'excused' }],
    });
    expect(marked.status).toBe(200);
    expect(marked.body.records).toEqual([
      expect.objectContaining({
        status: 'excused',
        absenceNotice: expect.objectContaining({ source: 'staff' }),
      }),
    ]);
    expect(await roster(t.api, session)).toEqual(marked.body.records);
  });
});

describe('the parent portal', () => {
  it('lets a parent report their own child’s absence, and read their notices', async () => {
    const t = await setup();
    const session = await t.addSession(t.albanyClass.id, day(1));

    const res = await t.parent.as('POST', '/portal/absence-notices', {
      studentId: t.mia.id,
      startDate: day(1),
      reason: 'Unwell',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ studentId: t.mia.id, source: 'parent', reason: 'Unwell' });
    expect((await t.lastAudit()).actorUserId).toBe(t.parent.userId);

    // Staff see it on the roster; the parent sees it on their own child's record only.
    expect(await flags(t.api, session)).toEqual(['Ari: -', 'Mia: Unwell (parent)']);
    expect(await flags(t.parent.as, session)).toEqual(['Mia: Unwell (parent)']);

    // Their children's notices only, through the staff list.
    await t.api('POST', '/absence-notices', { studentId: t.ari.id, startDate: day(1) });
    expect((await t.notices(t.parent.as)).map((n) => n.studentFirstName)).toEqual(['Mia']);
  });

  it('refuses another family’s child with 404, and the staff route with 403', async () => {
    const t = await setup();
    const results = await Promise.all([
      t.parent.as('POST', '/portal/absence-notices', { studentId: t.ari.id, startDate: day(1) }),
      t.parent.as('POST', '/absence-notices', { studentId: t.mia.id, startDate: day(1) }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 403]);
    expect(await t.notices()).toEqual([]);
  });

  it.each(['owner', 'branch_manager', 'front_desk', 'teacher', 'accountant'] as Role[])(
    'refuses a %s on the portal route',
    async (role) => {
      const t = await setup();
      const as = role === 'owner' ? t.api : (await t.member(role)).as;
      const res = await as('POST', '/portal/absence-notices', {
        studentId: t.mia.id,
        startDate: day(1),
      });
      expect(res.status).toBe(403);
    },
  );
});

describe('org isolation', () => {
  it("can't give or read a notice for another org's student", async () => {
    const alice = await setup();
    const bob = await setup();
    await alice.api('POST', '/absence-notices', { studentId: alice.mia.id, startDate: day(1) });

    const results = await Promise.all([
      bob.api('POST', '/absence-notices', { studentId: alice.mia.id, startDate: day(1) }),
      bob.api('GET', `/absence-notices?studentId=${alice.mia.id}`),
      call('GET', `${alice.base}/absence-notices`, { token: bob.owner.token }),
      call('POST', `${alice.base}/absence-notices`, {
        token: bob.owner.token,
        body: { studentId: alice.mia.id, startDate: day(1) },
      }),
      bob.parent.as('POST', '/portal/absence-notices', {
        studentId: alice.mia.id,
        startDate: day(1),
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect(await bob.notices()).toEqual([]);
    expect(await alice.notices()).toHaveLength(1);
  });
});

describe('permissions', () => {
  it('lets a teacher give and read notices for the students in their classes only', async () => {
    const t = await setup();
    const { as, userId } = t.teacher;

    const own = await as('POST', '/absence-notices', { studentId: t.mia.id, startDate: day(1) });
    expect(own.status).toBe(201);
    expect((await t.lastAudit()).actorUserId).toBe(userId);
    const outside = await Promise.all([
      as('POST', '/absence-notices', { studentId: t.ari.id, startDate: day(1) }),
      as('GET', `/absence-notices?studentId=${t.ari.id}`),
    ]);
    expect(outside.map((r) => r.status)).toEqual([404, 404]);

    await t.api('POST', '/absence-notices', { studentId: t.ari.id, startDate: day(1) });
    expect((await t.notices(as)).map((n) => n.studentFirstName)).toEqual(['Mia']);
  });

  it.each(['branch_manager', 'front_desk'] as Role[])(
    'lets a %s limited to a branch give notices for the children on its classes’ rosters',
    async (role) => {
      const t = await setup();
      const { as } = await t.member(role, [t.albany.id]);

      // Mia's family belongs to the Main branch, but she is in the Albany class.
      const cross = await as('POST', '/absence-notices', {
        studentId: t.mia.id,
        startDate: day(1),
      });
      expect(cross.status).toBe(201);
      expect(
        (await as('POST', '/absence-notices', { studentId: t.ari.id, startDate: day(1) })).status,
      ).toBe(201);
      // Sam is of the Main branch and in no class of theirs.
      expect(
        (await as('POST', '/absence-notices', { studentId: t.sam.id, startDate: day(1) })).status,
      ).toBe(404);

      await t.api('POST', '/absence-notices', { studentId: t.sam.id, startDate: day(1) });
      expect((await t.notices(as)).map((n) => n.studentFirstName)).toEqual(['Mia', 'Ari']);
    },
  );

  it('lets the Main branch’s staff give notices for their own students in another branch’s class', async () => {
    const t = await setup();
    const { as } = await t.member('front_desk', [t.main.id]);
    expect(
      (await as('POST', '/absence-notices', { studentId: t.mia.id, startDate: day(1) })).status,
    ).toBe(201);
    expect(
      (await as('POST', '/absence-notices', { studentId: t.ari.id, startDate: day(1) })).status,
    ).toBe(404);
  });

  it('refuses an accountant on both routes', async () => {
    const t = await setup();
    const { as } = await t.member('accountant');
    const results = await Promise.all([
      as('GET', '/absence-notices'),
      as('POST', '/absence-notices', { studentId: t.mia.id, startDate: day(1) }),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403]);
  });
});
