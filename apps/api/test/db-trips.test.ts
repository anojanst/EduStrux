import { createDb, memberships, orgs, sessions, users } from '@edustrux/db';
import { addDays, localNow, newId } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { JobMessage } from '../src/background/messages';
import { countTrips } from '../src/middleware/db';
import { getOrg } from '../src/modules/orgs/service';
import { startJob } from '../src/modules/platform/service';
import { addMember, call, db, newOrg, newUser, tokenFor } from './helpers';

// A trip is one call to D1: a statement, or a batch. On production each one is a network round
// trip. `call()` reads a request's trips and stages from its Server-Timing header (D-099).

const today = () => localNow('Pacific/Auckland').date; // sampleOrg's timezone
type Row = { id: string; updatedAt: string };

/** An owner with a fresh org, and `api` bound to that org. */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  return { owner, org, base, api };
}

const orgNotFound = { error: { code: 'not_found', message: 'Organisation not found' } };

describe('the D1 call counter', () => {
  it('counts a statement as one trip, a batch as one trip, and calls sent together as one stage', async () => {
    const { d1, counts } = countTrips(env.DB);

    await d1.prepare('select 1').first();
    expect(counts).toMatchObject({ trips: 1, stages: 1 });

    await d1.batch([d1.prepare('select 1'), d1.prepare('select ?').bind(2)]);
    expect(counts).toMatchObject({ trips: 2, stages: 2 });

    await Promise.all([d1.prepare('select 1').all(), d1.prepare('select ?').bind(2).raw()]);
    expect(counts).toMatchObject({ trips: 4, stages: 3 });
  });

  it('counts a chain of calls at its full depth while another call is still in flight', async () => {
    // A stand-in D1 whose calls finish only when the test says so.
    const waiting = new Map<string, () => void>();
    const slow = {
      prepare: (name: string) => ({
        run: () => new Promise<void>((finish) => waiting.set(name, finish)),
      }),
    } as unknown as D1Database;
    const finish = async (name: string) => {
      waiting.get(name)!();
      await new Promise((settled) => setTimeout(settled, 0));
    };
    const { d1, counts } = countTrips(slow);
    const send = (name: string) => d1.prepare(name).run();

    // Promise.all([a1().then(a2), b1()]), with b1 the last to finish.
    const all = Promise.all([send('a1').then(() => send('a2')), send('b1')]);
    expect(counts).toMatchObject({ trips: 2, stages: 1 }); // a1 and b1 went together

    await finish('a1');
    // a2 starts while b1 is still in flight, but it waited for a1, so it is a second stage.
    expect(counts).toMatchObject({ trips: 3, stages: 2 });

    await finish('a2');
    await finish('b1');
    await all;
    expect(counts).toMatchObject({ trips: 3, stages: 2 });
  });

  it('is on every API response as a Server-Timing header, with the database time', async () => {
    const health = await call('GET', '/api/v1/health');
    expect(health.headers.get('Server-Timing')).toMatch(/^db;dur=\d+\.\d;trips=0;stages=0$/);
    expect(health.db).toEqual({ trips: 0, stages: 0 });

    const { token } = await newUser();
    const me = await call('GET', '/api/v1/me', { token });
    expect(me.headers.get('Server-Timing')).toMatch(/^db;dur=\d+\.\d;trips=2;stages=2$/);
    expect(me.db).toEqual({ trips: 2, stages: 2 });
  });
});

describe('sign-in, membership and org in one trip', () => {
  it('GET /audit-log and GET /jobs/{id} make 2 trips, where they made 3', async () => {
    const { owner, org, api } = await setup();
    const queue = { send: async () => {} } as unknown as Queue<JobMessage>;
    const jobId = await startJob(
      { db: db(), orgId: org.id, actorUserId: owner.userId },
      queue,
      'test.echo',
    );

    const audit = await api('GET', '/audit-log');
    const job = await api('GET', `/jobs/${jobId}`);

    expect([audit.status, job.status]).toEqual([200, 200]);
    expect(audit.db).toEqual({ trips: 2, stages: 2 });
    expect(job.db).toEqual({ trips: 2, stages: 2 });
  });

  it('still answers 401 before it reaches D1, then 404, then 403', async () => {
    const { org, base, api } = await setup();
    const stranger = await newUser('stranger');
    const teacher = await newUser('teacher');
    const teacherToken = await addMember(org.id, teacher.clerkUserId, 'teacher');

    const noToken = await call('GET', '/api/v1/orgs/org_nope/audit-log');
    expect(noToken.status).toBe(401);
    expect(noToken.body.error.code).toBe('unauthenticated');
    expect(noToken.db.trips).toBe(0);

    const forged = (await tokenFor('user_x')).split('.').slice(0, 2).join('.') + '.c2lnbmF0dXJl';
    const badToken = await call('GET', `${base}/audit-log`, { token: forged });
    expect(badToken.status).toBe(401);
    expect(badToken.db.trips).toBe(0);

    // Owner-only, but a non-member is told the org doesn't exist, not that they lack the role.
    const notAMember = await call('GET', `${base}/audit-log`, { token: stranger.token });
    expect(notAMember.status).toBe(404);
    expect(notAMember.body).toEqual(orgNotFound);
    expect(notAMember.db.trips).toBe(1);

    const wrongRole = await call('GET', `${base}/audit-log`, { token: teacherToken });
    expect(wrongRole.status).toBe(403);
    expect(wrongRole.body.error.code).toBe('forbidden');
    expect(wrongRole.db.trips).toBe(1);

    expect((await api('GET', '/audit-log')).status).toBe(200);
  });

  it('gives the same 404 to a non-member, a suspended or removed member, and for a missing or deleted org', async () => {
    const { org, base } = await setup();
    const get = (token: string, path = base) => call('GET', path, { token });
    const stranger = await newUser('stranger');
    const suspended = await newUser('suspended');
    const removed = await newUser('removed');
    await addMember(org.id, suspended.clerkUserId, 'teacher');
    await addMember(org.id, removed.clerkUserId, 'teacher');
    expect((await get(suspended.token)).status).toBe(200);
    expect((await get(removed.token)).status).toBe(200);

    await db()
      .update(memberships)
      .set({ status: 'suspended' })
      .where(eq(memberships.userId, suspended.userId));
    await db()
      .update(memberships)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(memberships.userId, removed.userId));

    const other = await setup();
    await db()
      .update(orgs)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(orgs.id, other.org.id));

    const answers = [
      await get(stranger.token),
      await get(suspended.token),
      await get(removed.token),
      await get(stranger.token, '/api/v1/orgs/org_doesnotexist'),
      await get(other.owner.token, other.base), // still its owner, but the org is deleted
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(answer.body).toEqual(orgNotFound);
      expect(answer.db.trips).toBe(1);
    }
  });

  it("creates a new user's row on their first request, outside an org and on an org route", async () => {
    const { org, base } = await setup();
    const userRow = (clerkUserId: string) =>
      db().query.users.findFirst({ where: (u, { eq }) => eq(u.clerkUserId, clerkUserId) });

    const outside = `user_test_new_${crypto.randomUUID().slice(0, 8)}`;
    const me = await call('GET', '/api/v1/me', {
      token: await tokenFor(outside, { email: 'outside@example.com' }),
    });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: 'outside@example.com', memberships: [] });
    expect(me.body.id).toBe((await userRow(outside))!.id);

    const inOrg = `user_test_new_${crypto.randomUUID().slice(0, 8)}`;
    const token = await tokenFor(inOrg, { email: 'in-org@example.com', name: 'Ana New' });
    expect(await userRow(inOrg)).toBeUndefined();
    const first = await call('GET', base, { token });
    expect(first.status).toBe(404); // not a member of anything yet
    expect(first.body).toEqual(orgNotFound);
    const created = await userRow(inOrg);
    expect(created).toMatchObject({ email: 'in-org@example.com', name: 'Ana New' });
    expect(created!.id).toMatch(/^usr_[0-9a-z]{26}$/);

    // Once they are a member, the same token gets in, as the same user.
    await db()
      .insert(memberships)
      .values({ id: newId('membership'), orgId: org.id, userId: created!.id, role: 'teacher' });
    const second = await call('GET', base, { token });
    expect(second.status).toBe(200);
    expect(second.db.trips).toBe(1);
    expect(await db().select().from(users).where(eq(users.clerkUserId, inOrg))).toHaveLength(1);
  });

  it('keeps the email and name fresh from the token on an org route', async () => {
    const { owner, base } = await setup();
    const renamed = await tokenFor(owner.clerkUserId, { email: 'new@example.com', name: 'Mere' });

    const changed = await call('GET', base, { token: renamed });
    expect(changed.status).toBe(200);
    expect(changed.db.trips).toBe(2); // the sign-in trip, then the update

    const same = await call('GET', base, { token: renamed });
    expect(same.db.trips).toBe(1);

    // A token without the claims leaves them as they are.
    const me = await call('GET', '/api/v1/me', { token: await tokenFor(owner.clerkUserId) });
    expect(me.body).toMatchObject({ id: owner.userId, email: 'new@example.com', name: 'Mere' });
  });
});

describe('the org is read once per request', () => {
  it('GET /orgs/{id} answers from the sign-in trip alone, where it made 3', async () => {
    const { org, api } = await setup();
    const res = await api('GET', '');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(org);
    expect(res.db).toEqual({ trips: 1, stages: 1 });
  });

  it('PATCH /orgs/{id} returns the updated org in 2 trips, where it made 5', async () => {
    const { org, api } = await setup();

    const res = await api('PATCH', '', { updatedAt: org.updatedAt, taxNumber: 'GST 123-456-789' });
    expect(res.status).toBe(200);
    expect(res.db).toEqual({ trips: 2, stages: 2 }); // the sign-in trip, then the write
    expect(res.body).toEqual({
      ...org,
      taxNumber: 'GST 123-456-789',
      updatedAt: expect.any(String),
    });
    // What it returned is what is stored.
    expect(res.body).toEqual((await api('GET', '')).body);

    // The next edit goes through with the updatedAt it returned, and the first one is now stale.
    const next = await api('PATCH', '', { updatedAt: res.body.updatedAt, name: 'Renamed' });
    expect(next.status).toBe(200);
    expect(next.body.name).toBe('Renamed');
    const stale = await api('PATCH', '', { updatedAt: res.body.updatedAt, name: 'Stale edit' });
    expect(stale.status).toBe(409);
    expect(stale.db.trips).toBe(1);
  });

  it('getOrg uses the org on the context, and reads it where there is none, as a queue job does', async () => {
    const { org } = await setup();
    const other = await setup();
    const row = (await db().query.orgs.findFirst({ where: (o, { eq }) => eq(o.id, org.id) }))!;
    const { d1, counts } = countTrips(env.DB);
    const ctx = { db: createDb(d1), orgId: org.id, actorUserId: null };

    expect((await getOrg({ ...ctx, org: row })).id).toBe(org.id);
    expect(counts.trips).toBe(0);

    expect((await getOrg(ctx)).timezone).toBe('Pacific/Auckland');
    expect(counts.trips).toBe(1);

    // An org row that isn't the context's org is never used.
    expect((await getOrg({ ...ctx, orgId: other.org.id, org: row })).id).toBe(other.org.id);
    expect(counts.trips).toBe(2);
  });

  // These read the org two or three times in one request (TUI-90). Each number is today's exact
  // count, and its message gives the count before. They are checked as "at most" so the tasks
  // that cut these endpoints further (TUI-89, TUI-94 to TUI-96) don't have to change this file.
  it('the endpoints that read the org again no longer do', async () => {
    const { org, api } = await setup();
    const make = async (path: string, body: unknown) => {
      const res = await api('POST', path, body);
      if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
      return res;
    };
    const monthAgo = addDays(today(), -30);
    const week = `from=${addDays(today(), -7)}&to=${addDays(today(), 7)}`;

    const main = (await api('GET', '/branches')).body.data[0] as Row;
    const subject = (await make('/subjects', { name: 'Mathematics' })).body as Row;
    const grade = (await make('/grade-levels', { name: 'Year 10' })).body as Row;
    await make('/academic-years', {
      name: 'This year',
      startDate: addDays(today(), -100),
      endDate: addDays(today(), 100),
    });
    const course = (
      await make('/courses', { subjectId: subject.id, gradeLevelId: grade.id, durationMinutes: 60 })
    ).body as Row;
    const klass = (
      await make('/classes', {
        courseId: course.id,
        branchId: main.id,
        name: 'Group A',
        startDate: monthAgo,
      })
    ).body as Row;
    const family = (await make('/families', { name: 'Perera', branchId: main.id })).body as Row;

    const addStudent = await make('/students', {
      familyId: family.id,
      firstName: 'Aroha',
      lastName: 'Perera',
      dateOfBirth: '2012-05-17',
      gradeLevelId: grade.id,
    });
    const student = addStudent.body as Row;
    const changeStudent = await api('PATCH', `/students/${student.id}`, {
      updatedAt: student.updatedAt,
      dateOfBirth: '2012-05-18',
      gradeLevelId: grade.id,
    });
    const listStudents = await api('GET', '/students');
    const enrol = await make('/enrolments', {
      studentId: student.id,
      classId: klass.id,
      startDate: monthAgo,
    });
    const listSessions = await api('GET', `/sessions?${week}&studentId=${student.id}`);
    // A session written straight to the database: the generator only makes upcoming ones.
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
    const markAttendance = await api('PUT', `/sessions/${sessionId}/attendance`, {
      records: [{ studentId: student.id, status: 'present' }],
    });

    const ok = [changeStudent, listStudents, listSessions, markAttendance];
    expect(ok.map((res) => res.status)).toEqual([200, 200, 200, 200]);
    expect(addStudent.db.trips, 'POST /students: 12 → 8').toBeLessThanOrEqual(8);
    expect(changeStudent.db.trips, 'PATCH /students/{id}: 13 → 9').toBeLessThanOrEqual(9);
    expect(listStudents.db.trips, 'GET /students: 6 → 4').toBeLessThanOrEqual(4);
    // 9 until the plan's cap of active students added a read to the same stage (TUI-74).
    expect(enrol.db.trips, 'POST /enrolments: 12 → 9 → 10').toBeLessThanOrEqual(10);
    expect(listSessions.db.trips, 'GET /sessions: 9 → 6').toBeLessThanOrEqual(6);
    // 8 until make-ups added three reads to the same stage (TUI-55).
    expect(markAttendance.db.trips, 'PUT /attendance: 11 → 8 → 11').toBeLessThanOrEqual(11);
  });
});
