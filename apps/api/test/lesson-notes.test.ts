import { guardians, memberships, sessions } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// A lesson's notes (D-130): the homework for the whole class, and a note on any student. Reached
// through the session like its attendance.

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const day = (n: number) => addDays(localNow(TZ).date, n);

type Row = { id: string };
type Note = {
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  note: string | null;
  updatedAt: string | null;
};
type Notes = {
  sessionId: string;
  homework: string | null;
  homeworkUpdatedAt: string | null;
  notes: Note[];
};
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

/**
 * An owner with a fresh org and two branches, Main and Albany, each with a class that began a
 * month ago and a session yesterday.
 * - Mia (Perera) and Ben (Ngata) are in the Main class; Mere, Mia's mother, signs in as `parent`.
 * - Ari is in the Albany class.
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
  const addSession = async (
    classId: string,
    date: string,
    status: 'scheduled' | 'cancelled' = 'scheduled',
  ) => {
    const id = newId('session');
    await db()
      .insert(sessions)
      .values({ id, orgId: org.id, classId, date, startTime: '16:00', endTime: '17:00', status });
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

  const perera = await make('/families', { name: 'Perera', branchId: main.id });
  const mere = await make(`/families/${perera.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
  });
  const ngata = await make('/families', { name: 'Ngata', branchId: main.id });
  const albanyFamily = await make('/families', { name: 'Silva', branchId: albany.id });
  const mia = await make('/students', {
    familyId: perera.id,
    firstName: 'Mia',
    lastName: 'Perera',
  });
  const ben = await make('/students', { familyId: ngata.id, firstName: 'Ben', lastName: 'Ngata' });
  const ari = await make('/students', {
    familyId: albanyFamily.id,
    firstName: 'Ari',
    lastName: 'Silva',
  });
  const enrol = (studentId: string, classId: string) =>
    make('/enrolments', { studentId, classId, startDate: day(-30) });
  await enrol(mia.id, mainClass.id);
  await enrol(ben.id, mainClass.id);
  await enrol(ari.id, albanyClass.id);
  const mainSession = await addSession(mainClass.id, day(-1));
  const albanySession = await addSession(albanyClass.id, day(-1));

  const parent = await member('parent');
  // What accepting an invite will do: tie the guardian to the parent's membership.
  await db().update(guardians).set({ membershipId: parent.id }).where(eq(guardians.id, mere.id));

  const lastAudit = async (limit = 1) =>
    (await api('GET', `/audit-log?limit=${limit}`)).body.data as {
      action: string;
      entityType: string;
      entityId: string;
      actorUserId: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }[];

  return {
    owner,
    base,
    api,
    member,
    addSession,
    albany,
    teacher,
    parent,
    mainClass,
    mainSession,
    albanySession,
    mia,
    ben,
    ari,
    lastAudit,
  };
}

const path = (sessionId: string) => `/sessions/${sessionId}/notes`;
const read = async (as: As, sessionId: string) => (await as('GET', path(sessionId))).body as Notes;
/** The notes as a caller sees them: "Ben: -", "Mia: Great work". */
const seen = async (as: As, sessionId: string) =>
  (await read(as, sessionId)).notes.map((n) => `${n.studentFirstName}: ${n.note ?? '-'}`);

describe('lesson notes', () => {
  it('starts with no homework and a blank note for everyone expected', async () => {
    const { api, mainSession, mia, ben } = await setup();
    const res = await api('GET', path(mainSession));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sessionId: mainSession,
      homework: null,
      homeworkUpdatedAt: null,
      // By last name: Ngata before Perera.
      notes: [
        {
          studentId: ben.id,
          studentFirstName: 'Ben',
          studentLastName: 'Ngata',
          note: null,
          updatedAt: null,
        },
        {
          studentId: mia.id,
          studentFirstName: 'Mia',
          studentLastName: 'Perera',
          note: null,
          updatedAt: null,
        },
      ],
    });
  });

  it('writes the homework and one student’s note, leaves the rest, and writes one audit row', async () => {
    const { api, owner, mainSession, mia, lastAudit } = await setup();

    const res = await api('PUT', path(mainSession), {
      homework: 'Textbook p.42, questions 1–10',
      notes: [{ studentId: mia.id, note: 'Great work on fractions' }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      homework: 'Textbook p.42, questions 1–10',
      homeworkUpdatedAt: expect.any(String),
    });
    expect(await seen(api, mainSession)).toEqual(['Ben: -', 'Mia: Great work on fractions']);
    // The answer is what the next read gives.
    expect(await read(api, mainSession)).toEqual(res.body);

    const [audit] = await lastAudit();
    expect(audit).toEqual({
      ...audit,
      action: 'lesson_notes.updated',
      entityType: 'session',
      entityId: mainSession,
      actorUserId: owner.userId,
      // The homework is the class's; a note is about a student, so only that it changed is
      // kept (D-171).
      before: { homework: null, notes: [{ studentId: mia.id, note: null }] },
      after: {
        homework: 'Textbook p.42, questions 1–10',
        notes: [{ studentId: mia.id, note: 'changed' }],
      },
    });
  });

  it('changes and clears a note or the homework, one at a time', async () => {
    const { api, mainSession, mia, ben, lastAudit } = await setup();
    await api('PUT', path(mainSession), {
      homework: 'Read chapter 3',
      notes: [
        { studentId: mia.id, note: 'First' },
        { studentId: ben.id, note: 'Late' },
      ],
    });

    const changed = await api('PUT', path(mainSession), {
      notes: [{ studentId: mia.id, note: 'Second' }],
    });
    expect(changed.status).toBe(200);
    expect(changed.body.homework).toBe('Read chapter 3');
    expect(await seen(api, mainSession)).toEqual(['Ben: Late', 'Mia: Second']);
    // The audit row keeps only what changed.
    expect((await lastAudit())[0]).toMatchObject({
      before: { notes: [{ studentId: mia.id, note: 'changed' }] },
      after: { notes: [{ studentId: mia.id, note: 'changed' }] },
    });

    const cleared = await api('PUT', path(mainSession), {
      homework: null,
      notes: [{ studentId: ben.id, note: null }],
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ homework: null, homeworkUpdatedAt: null });
    expect(await seen(api, mainSession)).toEqual(['Ben: -', 'Mia: Second']);
    expect(await read(api, mainSession)).toEqual(cleared.body);

    // Set again after clearing.
    await api('PUT', path(mainSession), { homework: 'New homework' });
    expect((await read(api, mainSession)).homework).toBe('New homework');
  });

  it('writes nothing when what is sent is already there', async () => {
    const { api, mainSession, mia, lastAudit } = await setup();
    await api('PUT', path(mainSession), {
      homework: 'Read chapter 3',
      notes: [{ studentId: mia.id, note: 'Good' }],
    });
    const before = await lastAudit(5);

    const again = await api('PUT', path(mainSession), {
      homework: 'Read chapter 3',
      notes: [{ studentId: mia.id, note: 'Good' }],
    });
    expect(again.status).toBe(200);
    expect(await lastAudit(5)).toEqual(before);
  });

  it('can be written ahead of the lesson, but not for a cancelled one', async () => {
    const { api, addSession, mainClass } = await setup();
    const upcoming = await addSession(mainClass.id, day(7));
    expect((await api('PUT', path(upcoming), { homework: 'Bring a calculator' })).status).toBe(200);

    const cancelled = await addSession(mainClass.id, day(3), 'cancelled');
    const res = await api('PUT', path(cancelled), { homework: 'Nope' });
    expect(res.status).toBe(422);
    expect(await read(api, cancelled)).toMatchObject({ homework: null });
  });

  it('refuses a note for a student not enrolled for the session with 422, and writes nothing', async () => {
    const { api, mainSession, mia, ari } = await setup();
    const res = await api('PUT', path(mainSession), {
      homework: 'Nope',
      notes: [
        { studentId: mia.id, note: 'Fine' },
        { studentId: ari.id, note: 'Not here' },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toEqual({
      'notes.1.studentId': ['Not enrolled for this session'],
    });
    expect(await read(api, mainSession)).toMatchObject({ homework: null });
    expect(await seen(api, mainSession)).toEqual(['Ben: -', 'Mia: -']);
  });

  it.each<[string, Record<string, unknown>, string[]]>([
    ['nothing to write', {}, ['_']],
    ['an empty homework', { homework: '' }, ['homework']],
    ['homework over 2000 characters', { homework: 'x'.repeat(2001) }, ['homework']],
    ['no notes in the list', { notes: [] }, ['notes']],
    [
      'a student listed twice',
      {
        notes: [
          { studentId: 'stu_a', note: 'One' },
          { studentId: 'stu_a', note: 'Two' },
        ],
      },
      ['notes.1.studentId'],
    ],
    ['an empty note', { notes: [{ studentId: 'stu_a', note: '' }] }, ['notes.0.note']],
  ])('rejects %s with 400', async (_what, body, fields) => {
    const { api, mainSession } = await setup();
    const res = await api('PUT', path(mainSession), body);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(fields);
  });

  it('returns 404 for a session the org does not have', async () => {
    const { api } = await setup();
    const results = await Promise.all([
      api('GET', path('ses_nope')),
      api('PUT', path('ses_nope'), { homework: 'Nope' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404]);
  });
});

describe('org isolation', () => {
  it("can't read or write another org's lesson notes", async () => {
    const alice = await setup();
    const bob = await setup();
    const results = await Promise.all([
      bob.api('GET', path(alice.mainSession)),
      bob.api('PUT', path(alice.mainSession), { homework: 'Nope' }),
      call('GET', `${alice.base}${path(alice.mainSession)}`, { token: bob.owner.token }),
      call('PUT', `${alice.base}${path(alice.mainSession)}`, {
        token: bob.owner.token,
        body: { homework: 'Nope' },
      }),
      // Another org's student isn't on the roster either.
      bob.api('PUT', path(bob.mainSession), { notes: [{ studentId: alice.mia.id, note: 'X' }] }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 422]);
    expect(await read(alice.api, alice.mainSession)).toMatchObject({ homework: null });
  });
});

describe('permissions', () => {
  it('lets a teacher read and write the classes they teach, and no others', async () => {
    const t = await setup();
    const { as, userId } = t.teacher;
    const res = await as('PUT', path(t.mainSession), {
      homework: 'Practice sheet',
      notes: [{ studentId: t.ben.id, note: 'Needs help' }],
    });
    expect(res.status).toBe(200);
    expect((await t.lastAudit())[0]!.actorUserId).toBe(userId);
    expect(await seen(as, t.mainSession)).toEqual(['Ben: Needs help', 'Mia: -']);

    const outside = await Promise.all([
      as('GET', path(t.albanySession)),
      as('PUT', path(t.albanySession), { homework: 'Nope' }),
    ]);
    expect(outside.map((r) => r.status)).toEqual([404, 404]);
  });

  it('lets a parent read the homework and their own child’s note, and write nothing', async () => {
    const t = await setup();
    await t.api('PUT', path(t.mainSession), {
      homework: 'Read chapter 3',
      notes: [
        { studentId: t.mia.id, note: 'Great effort' },
        { studentId: t.ben.id, note: 'Needs help' },
      ],
    });
    const { as } = t.parent;

    const notes = await read(as, t.mainSession);
    expect(notes).toMatchObject({ homework: 'Read chapter 3' });
    expect(notes.notes.map((n) => `${n.studentFirstName}: ${n.note}`)).toEqual([
      'Mia: Great effort',
    ]);
    const refused = await as('PUT', path(t.mainSession), { homework: 'Nope' });
    expect(refused.status).toBe(403);
    // A session of a class none of their children is in.
    expect((await as('GET', path(t.albanySession))).status).toBe(404);
  });

  it.each(['branch_manager', 'front_desk'] as Role[])(
    'keeps a %s limited to one branch to that branch’s sessions',
    async (role) => {
      const t = await setup();
      const { as } = await t.member(role, [t.albany.id]);
      expect((await as('PUT', path(t.albanySession), { homework: 'Albany homework' })).status).toBe(
        200,
      );
      const outside = await Promise.all([
        as('GET', path(t.mainSession)),
        as('PUT', path(t.mainSession), { homework: 'Nope' }),
      ]);
      expect(outside.map((r) => r.status)).toEqual([404, 404]);
    },
  );

  it('refuses an accountant on both routes', async () => {
    const t = await setup();
    const { as } = await t.member('accountant');
    const results = await Promise.all([
      as('GET', path(t.mainSession)),
      as('PUT', path(t.mainSession), { homework: 'Nope' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403]);
  });
});
