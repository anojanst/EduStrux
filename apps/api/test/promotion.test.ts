import { memberships } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// Year-end promotion (TUI-45): everyone up a grade in the new academic year, with exceptions.

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;

type Row = { id: string; updatedAt: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;
type Student = Row & { grades: { academicYearId: string; gradeLevelId: string }[] };

/**
 * Year 9, 10 and 11, this year and next. This year: Aroha (Main) in Year 9, Ben (Main) in Year
 * 10, Cleo (Main) in Year 11, and Ari (Albany) in Year 10.
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
    await db()
      .insert(memberships)
      .values({ id: newId('membership'), orgId: org.id, userId: user.userId, role, branchIds });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { as };
  };
  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const albany = await make('/branches', { name: 'Albany' });
  const thisYear = await make('/academic-years', {
    name: 'This year',
    startDate: addDays(today(), -100),
    endDate: addDays(today(), 100),
  });
  const nextYear = await make('/academic-years', {
    name: 'Next year',
    startDate: addDays(today(), 101),
    endDate: addDays(today(), 400),
  });
  const y9 = await make('/grade-levels', { name: 'Year 9' });
  const y10 = await make('/grade-levels', { name: 'Year 10' });
  const y11 = await make('/grade-levels', { name: 'Year 11' });
  const add = async (firstName: string, branchId: string, gradeLevelId: string) => {
    const family = await make('/families', { name: firstName, branchId });
    return make<Student>('/students', {
      familyId: family.id,
      firstName,
      lastName: 'X',
      gradeLevelId,
    });
  };
  const aroha = await add('Aroha', main.id, y9.id);
  const ben = await add('Ben', main.id, y10.id);
  const cleo = await add('Cleo', main.id, y11.id);
  const ari = await add('Ari', albany.id, y10.id);

  const promote = (body: Record<string, unknown> = {}, as: As = api) =>
    as('POST', '/students/promote', {
      fromAcademicYearId: thisYear.id,
      toAcademicYearId: nextYear.id,
      ...body,
    });
  const finished = async (jobId: string, as: As = api) => {
    for (let i = 0; i < 400; i++) {
      const job = (await as('GET', `/jobs/${jobId}`)).body;
      if (job.status === 'succeeded' || job.status === 'failed') return job;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('job did not finish');
  };
  const nextGrade = async (student: Row) =>
    ((await api('GET', `/students/${student.id}`)).body as Student).grades.find(
      (g) => g.academicYearId === nextYear.id,
    )?.gradeLevelId ?? null;
  return {
    api,
    member,
    main,
    albany,
    thisYear,
    nextYear,
    y9,
    y10,
    y11,
    aroha,
    ben,
    cleo,
    ari,
    promote,
    finished,
    nextGrade,
  };
}

describe('POST /students/promote', () => {
  it('moves everyone up a grade, the last grade to none, with exceptions, once', async () => {
    const s = await setup();
    const started = await s.promote({
      exceptions: [{ studentId: s.ben.id, gradeLevelId: s.y10.id }],
    });
    expect(started.status).toBe(202);
    const job = await s.finished(started.body.jobId);
    expect(job).toMatchObject({
      status: 'succeeded',
      result: {
        fromAcademicYearId: s.thisYear.id,
        toAcademicYearId: s.nextYear.id,
        promoted: 2,
        exceptions: 1,
        finished: 1,
        alreadySet: 0,
      },
    });
    expect(await s.nextGrade(s.aroha)).toBe(s.y10.id);
    expect(await s.nextGrade(s.ben)).toBe(s.y10.id);
    expect(await s.nextGrade(s.cleo)).toBe(null);
    expect(await s.nextGrade(s.ari)).toBe(s.y11.id);
    const audit = (await s.api('GET', '/audit-log?limit=1')).body.data[0];
    expect(audit).toMatchObject({ action: 'students.promoted', entityId: started.body.jobId });

    // Again: everyone already has a grade, so nothing changes.
    const again = await s.finished((await s.promote()).body.jobId);
    expect(again.result).toMatchObject({ promoted: 0, alreadySet: 3, finished: 1 });
  });

  it('keeps branch staff to their branches', async () => {
    const s = await setup();
    const desk = await s.member('front_desk', [s.albany.id]);
    const started = await s.promote({}, desk.as);
    expect(started.status).toBe(202);
    expect((await s.finished(started.body.jobId, desk.as)).result).toMatchObject({ promoted: 1 });
    expect(await s.nextGrade(s.ari)).toBe(s.y11.id);
    expect(await s.nextGrade(s.aroha)).toBe(null);
    const outOfReach = await s.promote(
      { exceptions: [{ studentId: s.aroha.id, gradeLevelId: null }] },
      desk.as,
    );
    expect(outOfReach.status).toBe(404);
  });

  it('refuses years out of order, unknown ids, and bad input', async () => {
    const s = await setup();
    const backwards = await s.promote({
      fromAcademicYearId: s.nextYear.id,
      toAcademicYearId: s.thisYear.id,
    });
    expect(backwards.status).toBe(422);
    expect(backwards.body.error.fields).toEqual({
      toAcademicYearId: ['Not after fromAcademicYearId'],
    });
    expect((await s.promote({ toAcademicYearId: 'acy_missing' })).status).toBe(404);
    expect(
      (await s.promote({ exceptions: [{ studentId: s.ben.id, gradeLevelId: 'grd_missing' }] }))
        .status,
    ).toBe(404);
    expect(
      (await s.promote({ exceptions: [{ studentId: 'stu_missing', gradeLevelId: null }] })).status,
    ).toBe(404);
    expect((await s.promote({ toAcademicYearId: s.thisYear.id })).status).toBe(400);
    expect(
      (
        await s.promote({
          exceptions: [
            { studentId: s.ben.id, gradeLevelId: null },
            { studentId: s.ben.id, gradeLevelId: null },
          ],
        })
      ).status,
    ).toBe(400);
  });

  it('is for those who write people: 403 for a teacher, parent or accountant', async () => {
    const s = await setup();
    for (const role of ['teacher', 'parent', 'accountant'] as const) {
      expect((await s.promote({}, (await s.member(role)).as)).status).toBe(403);
    }
  });
});
