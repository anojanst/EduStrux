import { courses, gradeLevels, memberships } from '@edustrux/db';
import { MAX_GRADE_LEVELS, newId, type Role } from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import { addMember, call, db, newOrg, newUser } from './helpers';

type Grade = { id: string; name: string; sortOrder: number; updatedAt: string };
type Subject = { id: string; name: string; updatedAt: string };
type Course = {
  id: string;
  subjectId: string;
  gradeLevelId: string;
  curriculum: string | null;
  teachingMedium: string | null;
  defaultPrice: { amount: number; currency: string } | null;
  durationMinutes: number | null;
  updatedAt: string;
};

async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const addGrade = async (name: string) => {
    const res = await api('POST', '/grade-levels', { name });
    if (res.status !== 201) throw new Error(`grade create failed: ${JSON.stringify(res.body)}`);
    return res.body as Grade;
  };
  const addSubject = async (name: string) => {
    const res = await api('POST', '/subjects', { name });
    if (res.status !== 201) throw new Error(`subject create failed: ${JSON.stringify(res.body)}`);
    return res.body as Subject;
  };
  const addCourse = async (body: Record<string, unknown>) => {
    const res = await api('POST', '/courses', body);
    if (res.status !== 201) throw new Error(`course create failed: ${JSON.stringify(res.body)}`);
    return res.body as Course;
  };
  const gradeNames = async () =>
    (await api('GET', '/grade-levels')).body.data.map((g: Grade) => g.name) as string[];
  return { owner, org, base, api, addGrade, addSubject, addCourse, gradeNames };
}

/** An org with one subject and one grade level, ready for courses. */
async function courseSetup() {
  const org = await setup();
  const maths = await org.addSubject('Mathematics');
  const y10 = await org.addGrade('Year 10');
  return { ...org, maths, y10, pair: { subjectId: maths.id, gradeLevelId: y10.id } };
}

async function auditActions(base: string, token: string) {
  const res = await call('GET', `${base}/audit-log`, { token });
  return res.body.data.map((e: { action: string }) => e.action) as string[];
}

describe('grade levels', () => {
  it('adds grades to the end, lists them in order, renames and deletes, with audit rows', async () => {
    const { owner, base, api, addGrade, gradeNames } = await setup();

    const y1 = await api('POST', '/grade-levels', { name: 'Year 1' });
    expect(y1.status).toBe(201);
    expect(y1.body).toMatchObject({
      id: expect.stringMatching(/^grd_/),
      name: 'Year 1',
      sortOrder: 1,
    });
    expect(y1.body).not.toHaveProperty('orgId');
    const y2 = await addGrade('Year 2');
    expect(y2.sortOrder).toBe(2);

    const list = await api('GET', '/grade-levels');
    expect(list.status).toBe(200);
    expect(list.body.nextCursor).toBeNull();
    expect(list.body.data.map((g: Grade) => [g.name, g.sortOrder])).toEqual([
      ['Year 1', 1],
      ['Year 2', 2],
    ]);

    const renamed = await api('PATCH', `/grade-levels/${y1.body.id}`, {
      updatedAt: y1.body.updatedAt,
      name: 'Year One',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Year One', sortOrder: 1 });

    expect((await api('DELETE', `/grade-levels/${y1.body.id}`)).status).toBe(204);
    expect(await gradeNames()).toEqual(['Year 2']);

    expect((await auditActions(base, owner.token)).slice(0, 4)).toEqual([
      'grade_level.deleted',
      'grade_level.updated',
      'grade_level.created',
      'grade_level.created',
    ]);
  });

  it('reorders every grade in one change, with one audit row', async () => {
    const { owner, base, api, addGrade, gradeNames } = await setup();
    const [a, b, c] = [await addGrade('A'), await addGrade('B'), await addGrade('C')];

    const res = await api('PUT', '/grade-levels/order', { ids: [c.id, a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.map((g: Grade) => [g.name, g.sortOrder])).toEqual([
      ['C', 1],
      ['A', 2],
      ['B', 3],
    ]);
    expect(await gradeNames()).toEqual(['C', 'A', 'B']);

    const audit = await call('GET', `${base}/audit-log?limit=1`, { token: owner.token });
    expect(audit.body.data[0]).toMatchObject({
      action: 'grade_level.reordered',
      before: { ids: [a.id, b.id, c.id] },
      after: { ids: [c.id, a.id, b.id] },
    });

    // A new grade still goes to the end.
    await addGrade('D');
    expect(await gradeNames()).toEqual(['C', 'A', 'B', 'D']);
  });

  it('keeps the order after a grade in the middle is deleted', async () => {
    const { api, addGrade, gradeNames } = await setup();
    await addGrade('A');
    const b = await addGrade('B');
    await addGrade('C');
    await api('DELETE', `/grade-levels/${b.id}`);
    await addGrade('D');
    expect(await gradeNames()).toEqual(['A', 'C', 'D']);
  });

  it.each<[unknown, string]>([
    [{ ids: [] }, 'an empty list'],
    [{ ids: 'grd_x' }, 'a string'],
    [{}, 'no ids'],
  ])('rejects %j (%s) with 400', async (body) => {
    const { api } = await setup();
    const res = await api('PUT', '/grade-levels/order', body);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['ids']);
  });

  it('rejects a duplicate id with 400', async () => {
    const { api, addGrade } = await setup();
    const a = await addGrade('A');
    const b = await addGrade('B');
    const res = await api('PUT', '/grade-levels/order', { ids: [a.id, b.id, a.id] });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.ids).toEqual(['Each grade level can appear only once']);
  });

  it('rejects a list that leaves a grade out with 422, and changes nothing', async () => {
    const { api, addGrade, gradeNames } = await setup();
    const a = await addGrade('A');
    const b = await addGrade('B');
    await addGrade('C');

    const res = await api('PUT', '/grade-levels/order', { ids: [b.id, a.id] });
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toEqual({ ids: ['Expected 3 ids, got 2'] });
    expect(await gradeNames()).toEqual(['A', 'B', 'C']);
  });

  it('rejects an id from another org or a deleted grade with 404', async () => {
    const alice = await setup();
    const a = await alice.addGrade('A');
    const gone = await alice.addGrade('Gone');
    await alice.api('DELETE', `/grade-levels/${gone.id}`);
    const bob = await setup();
    const bobs = await bob.addGrade('Bob grade');

    expect((await alice.api('PUT', '/grade-levels/order', { ids: [a.id, bobs.id] })).status).toBe(
      404,
    );
    expect((await alice.api('PUT', '/grade-levels/order', { ids: [a.id, gone.id] })).status).toBe(
      404,
    );
  });

  it('keeps names unique in the org, ignoring case, and frees a deleted name', async () => {
    const { api, addGrade } = await setup();
    const y10 = await addGrade('Year 10');

    const dup = await api('POST', '/grade-levels', { name: 'year 10' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields).toEqual({ name: ['Taken'] });

    await api('DELETE', `/grade-levels/${y10.id}`);
    expect((await api('POST', '/grade-levels', { name: 'Year 10' })).status).toBe(201);
  });

  it.each([[{}], [{ name: '' }], [{ name: 'x'.repeat(121) }]])(
    'rejects an invalid grade %j with 400',
    async (body) => {
      const { api } = await setup();
      const res = await api('POST', '/grade-levels', body);
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.error.fields)).toEqual(['name']);
    },
  );

  it('returns 409 when updatedAt is stale', async () => {
    const { api, addGrade } = await setup();
    const g = await addGrade('Year 1');
    await api('PATCH', `/grade-levels/${g.id}`, { updatedAt: g.updatedAt, name: 'Y1' });
    const stale = await api('PATCH', `/grade-levels/${g.id}`, {
      updatedAt: g.updatedAt,
      name: 'Yr 1',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });

  it('accepts a one-character grade name like "K"', async () => {
    const { api } = await setup();
    expect((await api('POST', '/grade-levels', { name: 'K' })).status).toBe(201);
  });

  it(`refuses more than ${MAX_GRADE_LEVELS} grade levels`, async () => {
    const { org, api } = await setup();
    const rows = Array.from({ length: MAX_GRADE_LEVELS }, (_, i) => ({
      id: newId('gradeLevel'),
      orgId: org.id,
      name: `Grade ${i + 1}`,
      sortOrder: i + 1,
    }));
    // D1 allows at most 100 bound values per statement, so insert 10 rows at a time.
    for (let i = 0; i < rows.length; i += 10) {
      await db()
        .insert(gradeLevels)
        .values(rows.slice(i, i + 10));
    }

    const res = await api('POST', '/grade-levels', { name: 'One too many' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('unprocessable');
  });
});

describe('subjects', () => {
  it('adds, lists, renames and deletes subjects, with audit rows', async () => {
    const { owner, base, api, addSubject } = await setup();

    const maths = await api('POST', '/subjects', { name: 'Mathematics' });
    expect(maths.status).toBe(201);
    expect(maths.body).toMatchObject({ id: expect.stringMatching(/^sbj_/), name: 'Mathematics' });
    await addSubject('English');

    const list = await api('GET', '/subjects');
    expect(list.body.data.map((s: Subject) => s.name)).toEqual(['Mathematics', 'English']);

    const renamed = await api('PATCH', `/subjects/${maths.body.id}`, {
      updatedAt: maths.body.updatedAt,
      name: 'Maths',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Maths');

    expect((await api('DELETE', `/subjects/${maths.body.id}`)).status).toBe(204);
    const after = await api('GET', '/subjects');
    expect(after.body.data.map((s: Subject) => s.name)).toEqual(['English']);

    expect((await auditActions(base, owner.token)).slice(0, 4)).toEqual([
      'subject.deleted',
      'subject.updated',
      'subject.created',
      'subject.created',
    ]);
  });

  it('pages subjects with a cursor', async () => {
    const { api, addSubject } = await setup();
    for (const name of ['Art', 'Biology', 'Chemistry']) await addSubject(name);

    const first = await api('GET', '/subjects?limit=2');
    expect(first.body.data.map((s: Subject) => s.name)).toEqual(['Art', 'Biology']);
    const second = await api('GET', `/subjects?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.data.map((s: Subject) => s.name)).toEqual(['Chemistry']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('keeps names unique in the org, ignoring case', async () => {
    const { api, addSubject } = await setup();
    const art = await addSubject('Art');
    await addSubject('Music');

    expect((await api('POST', '/subjects', { name: 'ART' })).status).toBe(409);
    const rename = await api('PATCH', `/subjects/${art.id}`, {
      updatedAt: art.updatedAt,
      name: 'music',
    });
    expect(rename.status).toBe(409);
    expect(rename.body.error.fields).toEqual({ name: ['Taken'] });
  });

  it('rejects an invalid subject and a bad limit with 400', async () => {
    const { api } = await setup();
    const res = await api('POST', '/subjects', { name: '  ' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['name']);
    expect((await api('GET', '/subjects?limit=0')).status).toBe(400);
  });

  it('returns 409 when updatedAt is stale', async () => {
    const { api, addSubject } = await setup();
    const s = await addSubject('Art');
    await api('PATCH', `/subjects/${s.id}`, { updatedAt: s.updatedAt, name: 'Visual Art' });
    const stale = await api('PATCH', `/subjects/${s.id}`, { updatedAt: s.updatedAt, name: 'Arts' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });

  it('returns the subject unchanged when a PATCH changes nothing', async () => {
    const { api, addSubject } = await setup();
    const s = await addSubject('Art');
    const res = await api('PATCH', `/subjects/${s.id}`, { updatedAt: s.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(s);
  });
});

describe('courses', () => {
  it('adds a course with every field, lists, updates and deletes it, with audit rows', async () => {
    const { owner, base, api, maths, y10, pair } = await courseSetup();

    const created = await api('POST', '/courses', {
      ...pair,
      curriculum: 'Cambridge',
      teachingMedium: 'English',
      defaultPrice: { amount: 4500, currency: 'NZD' },
      durationMinutes: 60,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^crs_/),
      subjectId: maths.id,
      gradeLevelId: y10.id,
      curriculum: 'Cambridge',
      teachingMedium: 'English',
      defaultPrice: { amount: 4500, currency: 'NZD' },
      durationMinutes: 60,
    });
    for (const hidden of ['orgId', 'deletedAt', 'defaultPriceAmount', 'defaultPriceCurrency']) {
      expect(created.body).not.toHaveProperty(hidden);
    }

    const list = await api('GET', '/courses');
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ data: [created.body], nextCursor: null });

    const updated = await api('PATCH', `/courses/${created.body.id}`, {
      updatedAt: created.body.updatedAt,
      curriculum: 'NCEA',
      defaultPrice: { amount: 5000, currency: 'NZD' },
      durationMinutes: 90,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      curriculum: 'NCEA',
      teachingMedium: 'English',
      defaultPrice: { amount: 5000, currency: 'NZD' },
      durationMinutes: 90,
    });

    expect((await api('DELETE', `/courses/${created.body.id}`)).status).toBe(204);
    expect((await api('GET', '/courses')).body.data).toEqual([]);

    const audit = await call('GET', `${base}/audit-log?limit=3`, { token: owner.token });
    expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual([
      'course.deleted',
      'course.updated',
      'course.created',
    ]);
    expect(audit.body.data[1]).toMatchObject({
      entityType: 'course',
      entityId: created.body.id,
      actorUserId: owner.userId,
    });
    // Only what changed: the currency was sent as it was (D-113).
    expect(audit.body.data[1].before).toEqual({
      curriculum: 'Cambridge',
      defaultPriceAmount: 4500,
      durationMinutes: 60,
    });
    expect(audit.body.data[1].after).toEqual({
      curriculum: 'NCEA',
      defaultPriceAmount: 5000,
      durationMinutes: 90,
    });
  });

  it('adds a course with only a subject and a grade level', async () => {
    const { api, pair } = await courseSetup();
    const res = await api('POST', '/courses', pair);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ...pair,
      curriculum: null,
      teachingMedium: null,
      defaultPrice: null,
      durationMinutes: null,
    });
  });

  it('accepts a free course: a default price of 0', async () => {
    const { api, pair } = await courseSetup();
    const res = await api('POST', '/courses', {
      ...pair,
      defaultPrice: { amount: 0, currency: 'NZD' },
    });
    expect(res.status).toBe(201);
    expect(res.body.defaultPrice).toEqual({ amount: 0, currency: 'NZD' });
  });

  it('filters by subject and grade level, and pages with a cursor', async () => {
    const { api, addSubject, addGrade, addCourse, maths, y10 } = await courseSetup();
    const english = await addSubject('English');
    const y9 = await addGrade('Year 9');
    const mathsY10 = await addCourse({ subjectId: maths.id, gradeLevelId: y10.id });
    const mathsY9 = await addCourse({ subjectId: maths.id, gradeLevelId: y9.id });
    const englishY10 = await addCourse({ subjectId: english.id, gradeLevelId: y10.id });
    const englishY9 = await addCourse({ subjectId: english.id, gradeLevelId: y9.id });
    const ids = async (query: string) =>
      (await api('GET', `/courses${query}`)).body.data.map((c: Course) => c.id) as string[];

    expect(await ids('')).toEqual([mathsY10.id, mathsY9.id, englishY10.id, englishY9.id]);
    expect(await ids(`?subjectId=${maths.id}`)).toEqual([mathsY10.id, mathsY9.id]);
    expect(await ids(`?gradeLevelId=${y10.id}`)).toEqual([mathsY10.id, englishY10.id]);
    expect(await ids(`?subjectId=${english.id}&gradeLevelId=${y9.id}`)).toEqual([englishY9.id]);

    const first = await api('GET', '/courses?limit=3');
    expect(first.body.data).toHaveLength(3);
    const second = await api('GET', `/courses?limit=3&cursor=${first.body.nextCursor}`);
    expect(second.body.data.map((c: Course) => c.id)).toEqual([englishY9.id]);
    expect(second.body.nextCursor).toBeNull();

    // The filters page too.
    const page1 = await api('GET', `/courses?subjectId=${maths.id}&limit=1`);
    expect(page1.body.data.map((c: Course) => c.id)).toEqual([mathsY10.id]);
    expect(await ids(`?subjectId=${maths.id}&limit=1&cursor=${page1.body.nextCursor}`)).toEqual([
      mathsY9.id,
    ]);
  });

  it('returns 404 for a filter id the org does not have, and 400 for a bad limit', async () => {
    const { api } = await courseSetup();
    expect((await api('GET', '/courses?subjectId=sbj_nope')).status).toBe(404);
    expect((await api('GET', '/courses?gradeLevelId=grd_nope')).status).toBe(404);
    expect((await api('GET', '/courses?limit=0')).status).toBe(400);
  });

  it('keeps subject + grade + curriculum + medium unique, ignoring case', async () => {
    const { api, addCourse, pair } = await courseSetup();
    await addCourse(pair);

    const dup = await api('POST', '/courses', pair);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'conflict', fields: { _: ['Taken'] } });

    // A curriculum or a medium makes it a different course.
    await addCourse({ ...pair, curriculum: 'Cambridge' });
    await addCourse({ ...pair, curriculum: 'Cambridge', teachingMedium: 'Tamil' });
    await addCourse({ ...pair, teachingMedium: 'Tamil' });

    const sameCurriculum = await api('POST', '/courses', { ...pair, curriculum: 'cambridge' });
    expect(sameCurriculum.status).toBe(409);
    const sameBoth = await api('POST', '/courses', {
      ...pair,
      curriculum: 'CAMBRIDGE',
      teachingMedium: 'tamil',
    });
    expect(sameBoth.status).toBe(409);
    // null is the same as leaving the label out.
    const explicitNulls = await api('POST', '/courses', {
      ...pair,
      curriculum: null,
      teachingMedium: null,
    });
    expect(explicitNulls.status).toBe(409);
  });

  it('refuses a PATCH that would make two courses the same', async () => {
    const { api, addCourse, pair } = await courseSetup();
    await addCourse(pair);
    await addCourse({ ...pair, curriculum: 'Cambridge' });
    const ncea = await addCourse({ ...pair, curriculum: 'NCEA' });
    const patch = (body: Record<string, unknown>) =>
      api('PATCH', `/courses/${ncea.id}`, { updatedAt: ncea.updatedAt, ...body });

    const taken = await patch({ curriculum: 'cambridge' });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatchObject({ code: 'conflict', fields: { _: ['Taken'] } });
    // Clearing the curriculum would collide with the plain course.
    expect((await patch({ curriculum: null })).status).toBe(409);

    // Changing only the case of its own label isn't a clash.
    const recased = await patch({ curriculum: 'ncea' });
    expect(recased.status).toBe(200);
    expect(recased.body.curriculum).toBe('ncea');
  });

  it('compares a label the PATCH leaves alone as it is stored, ignoring case', async () => {
    const { api, addCourse, pair } = await courseSetup();
    await addCourse({ ...pair, curriculum: 'Cambridge', teachingMedium: 'Tamil' });
    const ncea = await addCourse({ ...pair, curriculum: 'NCEA', teachingMedium: 'TAMIL' });
    const patch = (body: Record<string, unknown>) =>
      api('PATCH', `/courses/${ncea.id}`, { updatedAt: ncea.updatedAt, ...body });

    // With its stored medium, the new curriculum would make it the same as the first course.
    expect((await patch({ curriculum: 'cambridge' })).status).toBe(409);
    // With another medium it wouldn't.
    const changed = await patch({ curriculum: 'cambridge', teachingMedium: 'English' });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ curriculum: 'cambridge', teachingMedium: 'English' });
  });

  it('allows the same curriculum and medium for another subject or grade', async () => {
    const { addSubject, addGrade, addCourse, pair, maths, y10 } = await courseSetup();
    const english = await addSubject('English');
    const y9 = await addGrade('Year 9');
    await addCourse({ ...pair, curriculum: 'Cambridge' });
    await addCourse({ subjectId: english.id, gradeLevelId: y10.id, curriculum: 'Cambridge' });
    await addCourse({ subjectId: maths.id, gradeLevelId: y9.id, curriculum: 'Cambridge' });
  });

  it('is also unique in the database, where a missing label counts as a value', async () => {
    const { org, addCourse, pair } = await courseSetup();
    await addCourse(pair);
    await addCourse({ ...pair, curriculum: 'Cambridge' });
    const row = (curriculum: string | null) => ({
      id: newId('course'),
      orgId: org.id,
      ...pair,
      curriculum,
    });

    // Drizzle wraps the D1 error, so the constraint is named in the cause.
    const insert = (curriculum: string | null) =>
      db()
        .insert(courses)
        .values(row(curriculum))
        .then(
          () => 'inserted',
          (e: Error) => String(e.cause),
        );

    expect(await insert(null)).toMatch(/UNIQUE constraint failed/);
    expect(await insert('CAMBRIDGE')).toMatch(/UNIQUE constraint failed/);
    expect(await insert('NCEA')).toBe('inserted');
  });

  it('frees the combination when a course is deleted', async () => {
    const { api, addCourse, pair } = await courseSetup();
    const course = await addCourse({ ...pair, curriculum: 'Cambridge' });
    await api('DELETE', `/courses/${course.id}`);
    expect((await api('POST', '/courses', { ...pair, curriculum: 'Cambridge' })).status).toBe(201);
  });

  const ids = { subjectId: 'sbj_x', gradeLevelId: 'grd_x' };
  it.each<[Record<string, unknown>, string[]]>([
    [{}, ['subjectId', 'gradeLevelId']],
    [{ ...ids, curriculum: '  ' }, ['curriculum']],
    [{ ...ids, teachingMedium: 'x'.repeat(61) }, ['teachingMedium']],
    [{ ...ids, defaultPrice: { amount: -1, currency: 'NZD' } }, ['defaultPrice.amount']],
    [{ ...ids, defaultPrice: { amount: 45.5, currency: 'NZD' } }, ['defaultPrice.amount']],
    [{ ...ids, defaultPrice: { amount: '4500', currency: 'NZD' } }, ['defaultPrice.amount']],
    [{ ...ids, defaultPrice: { amount: 4500, currency: 'nzd' } }, ['defaultPrice.currency']],
    [{ ...ids, defaultPrice: { amount: 4500 } }, ['defaultPrice.currency']],
    [{ ...ids, defaultPrice: 4500 }, ['defaultPrice']],
    [{ ...ids, durationMinutes: 0 }, ['durationMinutes']],
    [{ ...ids, durationMinutes: 601 }, ['durationMinutes']],
    [{ ...ids, durationMinutes: 45.5 }, ['durationMinutes']],
  ])('rejects an invalid course %j with 400', async (body, fields) => {
    const { api } = await setup();
    const res = await api('POST', '/courses', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.fields)).toEqual(fields);
  });

  it('rejects a default price that is not in the organisation’s currency with 400', async () => {
    const { api, addCourse, pair } = await courseSetup(); // the org's currency is NZD
    const wrong = { 'defaultPrice.currency': ["Must be the organisation's currency, NZD"] };

    const created = await api('POST', '/courses', {
      ...pair,
      defaultPrice: { amount: 4500, currency: 'AUD' },
    });
    expect(created.status).toBe(400);
    expect(created.body.error).toMatchObject({ code: 'validation_failed', fields: wrong });

    const course = await addCourse(pair);
    const patched = await api('PATCH', `/courses/${course.id}`, {
      updatedAt: course.updatedAt,
      defaultPrice: { amount: 4500, currency: 'AUD' },
    });
    expect(patched.status).toBe(400);
    expect(patched.body.error.fields).toEqual(wrong);
    expect((await api('GET', '/courses')).body.data[0].defaultPrice).toBeNull();
  });

  it('returns 404 for a subject or grade level that is unknown, deleted or another org’s', async () => {
    const { api, addSubject, addGrade, maths, y10 } = await courseSetup();
    const goneSubject = await addSubject('Gone');
    await api('DELETE', `/subjects/${goneSubject.id}`);
    const goneGrade = await addGrade('Gone');
    await api('DELETE', `/grade-levels/${goneGrade.id}`);
    const bob = await courseSetup();

    const results = await Promise.all([
      api('POST', '/courses', { subjectId: 'sbj_nope', gradeLevelId: y10.id }),
      api('POST', '/courses', { subjectId: maths.id, gradeLevelId: 'grd_nope' }),
      api('POST', '/courses', { subjectId: goneSubject.id, gradeLevelId: y10.id }),
      api('POST', '/courses', { subjectId: maths.id, gradeLevelId: goneGrade.id }),
      api('POST', '/courses', { subjectId: bob.maths.id, gradeLevelId: y10.id }),
      api('POST', '/courses', { subjectId: maths.id, gradeLevelId: bob.y10.id }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect((await api('GET', '/courses')).body.data).toEqual([]);
  });

  it('clears fields with null', async () => {
    const { api, addCourse, pair } = await courseSetup();
    const course = await addCourse({
      ...pair,
      curriculum: 'Cambridge',
      teachingMedium: 'English',
      defaultPrice: { amount: 4500, currency: 'NZD' },
      durationMinutes: 60,
    });
    const res = await api('PATCH', `/courses/${course.id}`, {
      updatedAt: course.updatedAt,
      curriculum: null,
      teachingMedium: null,
      defaultPrice: null,
      durationMinutes: null,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      curriculum: null,
      teachingMedium: null,
      defaultPrice: null,
      durationMinutes: null,
    });
  });

  it('keeps the course’s subject and grade level: a PATCH can’t move it', async () => {
    const { api, addSubject, addGrade, addCourse, pair } = await courseSetup();
    const english = await addSubject('English');
    const y9 = await addGrade('Year 9');
    const course = await addCourse(pair);

    const res = await api('PATCH', `/courses/${course.id}`, {
      updatedAt: course.updatedAt,
      subjectId: english.id,
      gradeLevelId: y9.id,
      durationMinutes: 45,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ...pair, durationMinutes: 45 });
  });

  it('rejects an invalid PATCH with 400', async () => {
    const { api, addCourse, pair } = await courseSetup();
    const course = await addCourse(pair);
    const noUpdatedAt = await api('PATCH', `/courses/${course.id}`, { durationMinutes: 45 });
    expect(noUpdatedAt.status).toBe(400);
    expect(Object.keys(noUpdatedAt.body.error.fields)).toEqual(['updatedAt']);
    const badDuration = await api('PATCH', `/courses/${course.id}`, {
      updatedAt: course.updatedAt,
      durationMinutes: 4,
    });
    expect(badDuration.status).toBe(400);
    expect(Object.keys(badDuration.body.error.fields)).toEqual(['durationMinutes']);
  });

  it('returns 409 when updatedAt is stale', async () => {
    const { api, addCourse, pair } = await courseSetup();
    const c = await addCourse(pair);
    await api('PATCH', `/courses/${c.id}`, { updatedAt: c.updatedAt, durationMinutes: 45 });
    const stale = await api('PATCH', `/courses/${c.id}`, {
      updatedAt: c.updatedAt,
      durationMinutes: 50,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });

  it('returns the course unchanged when a PATCH changes nothing', async () => {
    const { api, addCourse, pair } = await courseSetup();
    const c = await addCourse({ ...pair, defaultPrice: { amount: 4500, currency: 'NZD' } });
    const res = await api('PATCH', `/courses/${c.id}`, { updatedAt: c.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(c);
  });

  it('returns 404 for a course that is unknown or deleted', async () => {
    const { api, addCourse, pair } = await courseSetup();
    const c = await addCourse(pair);
    await api('DELETE', `/courses/${c.id}`);
    const results = await Promise.all([
      api('PATCH', `/courses/${c.id}`, { updatedAt: c.updatedAt, durationMinutes: 45 }),
      api('DELETE', `/courses/${c.id}`),
      api('PATCH', '/courses/crs_nope', { updatedAt: c.updatedAt, durationMinutes: 45 }),
      api('DELETE', '/courses/crs_nope'),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404]);
  });
});

describe('grade levels and subjects in use', () => {
  it('refuses to delete a grade level or subject that a course uses', async () => {
    const { api, addSubject, addGrade, addCourse, maths, y10, pair, gradeNames } =
      await courseSetup();
    const english = await addSubject('English');
    const y9 = await addGrade('Year 9');
    const course = await addCourse(pair);
    const second = await addCourse({ ...pair, curriculum: 'Cambridge' });

    const grade = await api('DELETE', `/grade-levels/${y10.id}`);
    expect(grade.status).toBe(422);
    expect(grade.body.error).toMatchObject({
      code: 'unprocessable',
      message: "Delete this grade level's 2 course(s) first.",
    });
    const subject = await api('DELETE', `/subjects/${maths.id}`);
    expect(subject.status).toBe(422);
    expect(subject.body.error).toMatchObject({
      code: 'unprocessable',
      message: "Delete this subject's 2 course(s) first.",
    });
    expect(await gradeNames()).toEqual(['Year 10', 'Year 9']);

    // Ones no course uses can still go.
    expect((await api('DELETE', `/grade-levels/${y9.id}`)).status).toBe(204);
    expect((await api('DELETE', `/subjects/${english.id}`)).status).toBe(204);

    // Deleted courses don't count.
    await api('DELETE', `/courses/${course.id}`);
    expect((await api('DELETE', `/subjects/${maths.id}`)).status).toBe(422);
    await api('DELETE', `/courses/${second.id}`);
    expect((await api('DELETE', `/grade-levels/${y10.id}`)).status).toBe(204);
    expect((await api('DELETE', `/subjects/${maths.id}`)).status).toBe(204);
  });
});

describe('org isolation', () => {
  it("can't read or change another org's grade levels and subjects through any route", async () => {
    const alice = await setup();
    const grade = await alice.addGrade('Year 1');
    const subject = await alice.addSubject('Art');
    const bob = await setup();

    const results = await Promise.all([
      bob.api('PATCH', `/grade-levels/${grade.id}`, { updatedAt: grade.updatedAt, name: 'X' }),
      bob.api('DELETE', `/grade-levels/${grade.id}`),
      bob.api('PATCH', `/subjects/${subject.id}`, { updatedAt: subject.updatedAt, name: 'X' }),
      bob.api('DELETE', `/subjects/${subject.id}`),
      call('GET', `${alice.base}/grade-levels`, { token: bob.owner.token }),
      call('GET', `${alice.base}/subjects`, { token: bob.owner.token }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404]);

    expect(await alice.gradeNames()).toEqual(['Year 1']);
    expect((await bob.api('GET', '/subjects')).body.data).toEqual([]);
  });

  it("can't read or change another org's courses through any route", async () => {
    const alice = await courseSetup();
    const course = await alice.addCourse(alice.pair);
    const bob = await courseSetup();

    const results = await Promise.all([
      bob.api('PATCH', `/courses/${course.id}`, {
        updatedAt: course.updatedAt,
        durationMinutes: 45,
      }),
      bob.api('DELETE', `/courses/${course.id}`),
      call('GET', `${alice.base}/courses`, { token: bob.owner.token }),
      call('POST', `${alice.base}/courses`, { token: bob.owner.token, body: alice.pair }),
      bob.api('GET', `/courses?subjectId=${alice.maths.id}`),
      bob.api('GET', `/courses?gradeLevelId=${alice.y10.id}`),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404]);

    expect((await alice.api('GET', '/courses')).body.data).toEqual([course]);
    expect((await bob.api('GET', '/courses')).body.data).toEqual([]);
  });
});

describe('permissions', () => {
  it.each(['branch_manager', 'front_desk', 'teacher', 'parent', 'accountant'] as Role[])(
    '%s can read grade levels and subjects but not change them',
    async (role) => {
      const { org, base, addGrade, addSubject } = await setup();
      const grade = await addGrade('Year 1');
      const subject = await addSubject('Art');
      const member = await newUser(role);
      const token = await addMember(org.id, member.clerkUserId, role);
      const as = (method: string, path: string, body?: unknown) =>
        call(method, `${base}${path}`, { token, body });

      expect((await as('GET', '/grade-levels')).status).toBe(200);
      expect((await as('GET', '/subjects')).status).toBe(200);

      const writes = await Promise.all([
        as('POST', '/grade-levels', { name: 'Nope' }),
        as('PATCH', `/grade-levels/${grade.id}`, { updatedAt: grade.updatedAt, name: 'Nope' }),
        as('DELETE', `/grade-levels/${grade.id}`),
        as('PUT', '/grade-levels/order', { ids: [grade.id] }),
        as('POST', '/subjects', { name: 'Nope' }),
        as('PATCH', `/subjects/${subject.id}`, { updatedAt: subject.updatedAt, name: 'Nope' }),
        as('DELETE', `/subjects/${subject.id}`),
      ]);
      expect(writes.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403]);
    },
  );

  it.each(['branch_manager', 'front_desk'] as Role[])(
    '%s can add, change and delete courses',
    async (role) => {
      const { owner, org, base, pair } = await courseSetup();
      const member = await newUser(role);
      const token = await addMember(org.id, member.clerkUserId, role);
      const as = (method: string, path: string, body?: unknown) =>
        call(method, `${base}${path}`, { token, body });

      const created = await as('POST', '/courses', { ...pair, durationMinutes: 60 });
      expect(created.status).toBe(201);
      const updated = await as('PATCH', `/courses/${created.body.id}`, {
        updatedAt: created.body.updatedAt,
        durationMinutes: 90,
      });
      expect(updated.status).toBe(200);
      expect((await as('GET', '/courses')).body.data).toEqual([updated.body]);
      expect((await as('DELETE', `/courses/${created.body.id}`)).status).toBe(204);

      // The audit rows name the staff member, not the owner.
      const audit = await call('GET', `${base}/audit-log?limit=3`, { token: owner.token });
      expect(
        audit.body.data.map((e: { action: string; actorUserId: string }) => [
          e.action,
          e.actorUserId,
        ]),
      ).toEqual([
        ['course.deleted', member.userId],
        ['course.updated', member.userId],
        ['course.created', member.userId],
      ]);
    },
  );

  it('a manager limited to one branch still writes courses, which have no branch', async () => {
    const { org, api, base, pair } = await courseSetup();
    const branches = await api('GET', '/branches');
    const member = await newUser('branch_manager');
    await db()
      .insert(memberships)
      .values({
        id: newId('membership'),
        orgId: org.id,
        userId: member.userId,
        role: 'branch_manager',
        branchIds: [branches.body.data[0].id],
      });

    const res = await call('POST', `${base}/courses`, { token: member.token, body: pair });
    expect(res.status).toBe(201);
  });

  // Teachers and parents read courses without the default price; the field is left out rather
  // than null, which means no price is set (D-110).
  it.each<[Role, boolean]>([
    ['teacher', false],
    ['parent', false],
    ['accountant', true],
  ])('%s can read courses but not change them (sees prices: %s)', async (role, seesPrice) => {
    const { org, base, addCourse, maths, y10 } = await courseSetup();
    const priced = await addCourse({
      subjectId: maths.id,
      gradeLevelId: y10.id,
      defaultPrice: { amount: 4500, currency: 'NZD' },
    });
    const unpriced = await addCourse({
      subjectId: maths.id,
      gradeLevelId: y10.id,
      curriculum: 'Cambridge',
    });
    const member = await newUser(role);
    const token = await addMember(org.id, member.clerkUserId, role);
    const as = (method: string, path: string, body?: unknown) =>
      call(method, `${base}${path}`, { token, body });

    const list = await as('GET', '/courses');
    expect(list.status).toBe(200);
    if (seesPrice) {
      expect(list.body.data).toEqual([priced, unpriced]);
    } else {
      const { defaultPrice: _a, ...pricedSeen } = priced;
      const { defaultPrice: _b, ...unpricedSeen } = unpriced;
      expect(list.body.data).toEqual([pricedSeen, unpricedSeen]);
      expect(list.body.data.some((c: object) => 'defaultPrice' in c)).toBe(false);
    }

    const writes = await Promise.all([
      as('POST', '/courses', { subjectId: maths.id, gradeLevelId: y10.id, curriculum: 'Nope' }),
      as('PATCH', `/courses/${priced.id}`, { updatedAt: priced.updatedAt, durationMinutes: 45 }),
      as('DELETE', `/courses/${priced.id}`),
    ]);
    expect(writes.map((r) => r.status)).toEqual([403, 403, 403]);
  });

  // Branch managers and front desk write courses, but a course's default price is the owner's to
  // set (D-111). They may send the one it already has, as a form that sends every field does.
  it.each(['branch_manager', 'front_desk'] as Role[])(
    '%s can’t set or change a course’s default price',
    async (role) => {
      const { owner, org, base, api, addCourse, pair, maths, y10 } = await courseSetup();
      const member = await newUser(role);
      const token = await addMember(org.id, member.clerkUserId, role);
      const as = (method: string, path: string, body?: unknown) =>
        call(method, `${base}${path}`, { token, body });
      const price = { amount: 4500, currency: 'NZD' };

      // Adding a course: with a price it's refused and nothing is added; null is no price.
      const refusedCreate = await as('POST', '/courses', { ...pair, defaultPrice: price });
      expect(refusedCreate.status).toBe(403);
      expect(refusedCreate.body.error.code).toBe('forbidden');
      expect((await api('GET', '/courses')).body.data).toEqual([]);
      const created = await as('POST', '/courses', { ...pair, defaultPrice: null });
      expect(created.status).toBe(201);
      expect(created.body.defaultPrice).toBeNull();

      // Giving it one, before or after the owner has, is refused.
      const refusedSet = await as('PATCH', `/courses/${created.body.id}`, {
        updatedAt: created.body.updatedAt,
        defaultPrice: price,
      });
      expect(refusedSet.status).toBe(403);
      const priced = await addCourse({
        subjectId: maths.id,
        gradeLevelId: y10.id,
        curriculum: 'Cambridge',
        defaultPrice: price,
      });
      const refused = await Promise.all([
        as('PATCH', `/courses/${priced.id}`, {
          updatedAt: priced.updatedAt,
          defaultPrice: { amount: 1, currency: 'NZD' },
        }),
        as('PATCH', `/courses/${priced.id}`, { updatedAt: priced.updatedAt, defaultPrice: null }),
      ]);
      expect(refused.map((r) => r.status)).toEqual([403, 403]);

      // They see the price, and sending the same one back with other changes is fine.
      const list = (await as('GET', '/courses')).body.data;
      expect(list.map((c: { defaultPrice: unknown }) => c.defaultPrice)).toEqual([null, price]);
      const updated = await as('PATCH', `/courses/${priced.id}`, {
        updatedAt: priced.updatedAt,
        defaultPrice: price,
        durationMinutes: 90,
      });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ defaultPrice: price, durationMinutes: 90 });
      const unpriced = await as('PATCH', `/courses/${created.body.id}`, {
        updatedAt: created.body.updatedAt,
        defaultPrice: null,
        durationMinutes: 60,
      });
      expect(unpriced.status).toBe(200);

      // The writes that went through are theirs in the audit log, and only the price is unchanged.
      const audit = await call('GET', `${base}/audit-log?limit=3`, { token: owner.token });
      expect(
        audit.body.data.map((e: { action: string; actorUserId: string; after: unknown }) => [
          e.action,
          e.actorUserId,
          e.after,
        ]),
      ).toEqual([
        ['course.updated', member.userId, { durationMinutes: 60 }],
        ['course.updated', member.userId, { durationMinutes: 90 }],
        ['course.created', owner.userId, expect.objectContaining({ defaultPriceAmount: 4500 })],
      ]);
    },
  );
});
