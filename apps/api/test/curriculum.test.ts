import { gradeLevels } from '@edustrux/db';
import { MAX_GRADE_LEVELS, newId, type Role } from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import { addMember, call, db, newOrg, newUser } from './helpers';

type Grade = { id: string; name: string; sortOrder: number; updatedAt: string };
type Subject = { id: string; name: string; updatedAt: string };

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
  const gradeNames = async () =>
    (await api('GET', '/grade-levels')).body.data.map((g: Grade) => g.name) as string[];
  return { owner, org, base, api, addGrade, addSubject, gradeNames };
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
});
