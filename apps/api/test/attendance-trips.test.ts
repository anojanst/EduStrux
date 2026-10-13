import { guardians, memberships, sessions } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// The budget for an endpoint is about 3 database trips in sequence: sign-in, one read stage, one
// write (D-102). Reading a session's attendance has no write, so it gets 2. `stages` is what a
// request waited for one after another; `trips` is every call it made, pinned at what it makes
// today so a call added by mistake shows up.

const today = () => localNow('Pacific/Auckland').date; // sampleOrg's timezone

type Row = { id: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;
type Status = 'present' | 'absent' | 'late' | 'excused' | null;
type Seen = { studentFirstName: string; status: Status; markedAt: string | null };

/**
 * A class that met yesterday, with its teacher and three students: Aroha, Ben and Mia. Mia's
 * family has a guardian who signs in as the parent.
 */
async function classOfThree() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async (path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as Row;
  };
  const member = async (role: Role) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db().insert(memberships).values({ id, orgId: org.id, userId: user.userId, role });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, as };
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', {
    subjectId: subject.id,
    gradeLevelId: grade.id,
    durationMinutes: 60,
  });
  const teacher = await member('teacher');
  const parent = await member('parent');
  const klass = await make('/classes', {
    courseId: course.id,
    branchId: main.id,
    name: 'Group A',
    startDate: addDays(today(), -30),
    teacherId: teacher.id,
  });
  // Written straight to the database: the generator only makes sessions that haven't started.
  const sessionId = newId('session');
  await db()
    .insert(sessions)
    .values({
      id: sessionId,
      orgId: org.id,
      classId: klass.id,
      date: addDays(today(), -1),
      startTime: '16:00',
      endTime: '17:00',
    });

  const student = async (firstName: string, lastName: string) => {
    const family = await make('/families', { name: `${firstName}'s family`, branchId: main.id });
    const added = await make('/students', { familyId: family.id, firstName, lastName });
    await make('/enrolments', {
      studentId: added.id,
      classId: klass.id,
      startDate: addDays(today(), -30),
    });
    return { ...added, familyId: family.id };
  };
  const aroha = await student('Aroha', 'Perera');
  const ben = await student('Ben', 'Ngata');
  const mia = await student('Mia', 'Silva');
  const guardian = await make(`/families/${mia.familyId}/guardians`, {
    firstName: 'Mere',
    lastName: 'Silva',
  });
  // What accepting an invite will do: tie the guardian to the parent's membership.
  await db()
    .update(guardians)
    .set({ membershipId: parent.id })
    .where(eq(guardians.id, guardian.id));

  return {
    api,
    member,
    teacher,
    parent,
    path: `/sessions/${sessionId}/attendance`,
    aroha,
    ben,
    mia,
  };
}

/** A roster as "Ben: present", "Aroha: -" for not marked, in the order it came back. */
const seen = (body: { records: Seen[] }) =>
  body.records.map((r) => `${r.studentFirstName}: ${r.status ?? '-'}`);

describe('GET /sessions/{id}/attendance waits for 2 database trips: sign-in, then one read stage', () => {
  it('as the owner and as the class’s teacher, who see the whole class', async () => {
    const c = await classOfThree();
    for (const as of [c.api, c.teacher.as]) {
      const res = await as('GET', c.path);
      expect(res.status).toBe(200);
      expect(seen(res.body)).toEqual(['Ben: -', 'Aroha: -', 'Mia: -']);
      expect(res.db.stages).toBeLessThanOrEqual(2);
      expect(res.db.trips).toBeLessThanOrEqual(6);
    }
  });

  it('as a parent, who sees their own child', async () => {
    const c = await classOfThree();
    const res = await c.parent.as('GET', c.path);
    expect(res.status).toBe(200);
    expect(seen(res.body)).toEqual(['Mia: -']);
    expect(res.db.stages).toBeLessThanOrEqual(2);
    expect(res.db.trips).toBeLessThanOrEqual(5);
  });
});

describe('PUT /sessions/{id}/attendance waits for 3: sign-in, one read stage, one write', () => {
  it('for one student, as the owner and as the class’s teacher', async () => {
    const c = await classOfThree();

    const owner = await c.api('PUT', c.path, {
      records: [{ studentId: c.ben.id, status: 'present' }],
    });
    expect(owner.status).toBe(200);
    expect(seen(owner.body)).toEqual(['Ben: present', 'Aroha: -', 'Mia: -']);
    expect(owner.db.stages).toBeLessThanOrEqual(3);
    expect(owner.db.trips).toBeLessThanOrEqual(7);

    const teacher = await c.teacher.as('PUT', c.path, {
      records: [{ studentId: c.aroha.id, status: 'late' }],
    });
    expect(teacher.status).toBe(200);
    expect(seen(teacher.body)).toEqual(['Ben: present', 'Aroha: late', 'Mia: -']);
    expect(teacher.db.stages).toBeLessThanOrEqual(3);
    expect(teacher.db.trips).toBeLessThanOrEqual(7);
  });

  it('for the whole class with one mark cleared, as the owner and as the class’s teacher', async () => {
    const c = await classOfThree();
    const everyone = (benStatus: Status, others: Status) => ({
      records: [
        { studentId: c.aroha.id, status: others },
        { studentId: c.ben.id, status: benStatus },
        { studentId: c.mia.id, status: others },
      ],
    });
    await c.api('PUT', c.path, { records: [{ studentId: c.ben.id, status: 'absent' }] });

    const owner = await c.api('PUT', c.path, everyone(null, 'present'));
    expect(owner.status).toBe(200);
    expect(seen(owner.body)).toEqual(['Ben: -', 'Aroha: present', 'Mia: present']);
    expect(owner.db.stages).toBeLessThanOrEqual(3);
    expect(owner.db.trips).toBeLessThanOrEqual(7);

    await c.api('PUT', c.path, { records: [{ studentId: c.ben.id, status: 'absent' }] });
    const teacher = await c.teacher.as('PUT', c.path, everyone(null, 'late'));
    expect(teacher.status).toBe(200);
    expect(seen(teacher.body)).toEqual(['Ben: -', 'Aroha: late', 'Mia: late']);
    expect(teacher.db.stages).toBeLessThanOrEqual(3);
    expect(teacher.db.trips).toBeLessThanOrEqual(7);
  });

  it('refuses a parent after the sign-in trip, before anything is read', async () => {
    const c = await classOfThree();
    const res = await c.parent.as('PUT', c.path, {
      records: [{ studentId: c.mia.id, status: 'present' }],
    });
    expect(res.status).toBe(403);
    expect(res.db).toEqual({ trips: 1, stages: 1 });
  });
});

describe('a session outside the caller’s reach', () => {
  it('answers as one that doesn’t exist does, in the same trips, whatever its roster holds', async () => {
    const c = await classOfThree();
    await c.api('PUT', c.path, { records: [{ studentId: c.ben.id, status: 'present' }] });
    // A teacher of the same centre who doesn't teach this class.
    const { as } = await c.member('teacher');
    const requests: [string, unknown][] = [
      ['GET', undefined],
      ['PUT', { records: [{ studentId: c.ben.id, status: 'absent' }] }],
      // Not on the roster: still 404, with nothing said about the student.
      ['PUT', { records: [{ studentId: 'stu_nope', status: 'absent' }] }],
    ];

    for (const [method, body] of requests) {
      const outside = await as(method, c.path, body);
      const missing = await as(method, '/sessions/ses_nope/attendance', body);
      expect(outside.status).toBe(404);
      expect(outside.body).toEqual({ error: { code: 'not_found', message: 'Session not found' } });
      expect(missing.body).toEqual(outside.body);
      expect(outside.db).toEqual(missing.db);
      expect(outside.db.stages).toBeLessThanOrEqual(2);
    }
    // Nothing was written.
    expect(seen((await c.api('GET', c.path)).body)).toEqual(['Ben: present', 'Aroha: -', 'Mia: -']);
  });
});
