import type { Role } from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import { addMember, call, newOrg, newUser } from './helpers';

type Dated = { id: string; name: string; startDate: string; endDate: string; updatedAt: string };
type Year = Dated;
type Term = Dated & { academicYearId: string };
type Holiday = Dated & { branchId: string | null };

async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const created = async <T>(path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`${path} create failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };
  const addYear = (name: string, startDate: string, endDate: string) =>
    created<Year>('/academic-years', { name, startDate, endDate });
  const addTerm = (academicYearId: string, name: string, startDate: string, endDate: string) =>
    created<Term>('/terms', { academicYearId, name, startDate, endDate });
  const addHoliday = (name: string, startDate: string, endDate: string, branchId?: string) =>
    created<Holiday>('/holidays', { name, startDate, endDate, branchId });
  const addBranch = (name: string) => created<{ id: string }>('/branches', { name });
  const names = async (path: string) =>
    (await api('GET', path)).body.data.map((r: Dated) => r.name) as string[];
  return { owner, org, base, api, addYear, addTerm, addHoliday, addBranch, names };
}

async function auditActions(base: string, token: string) {
  const res = await call('GET', `${base}/audit-log`, { token });
  return res.body.data.map((e: { action: string }) => e.action) as string[];
}

describe('academic years', () => {
  it('adds, lists in date order and updates a year, with audit rows', async () => {
    const { owner, base, api, addYear, names } = await setup();
    await addYear('2028', '2028-01-24', '2028-12-15');

    const res = await api('POST', '/academic-years', {
      name: '2027',
      startDate: '2027-01-25',
      endDate: '2027-12-17',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.stringMatching(/^acy_/),
      name: '2027',
      startDate: '2027-01-25',
      endDate: '2027-12-17',
    });
    expect(res.body).not.toHaveProperty('orgId');

    // Listed by start date, not creation order.
    expect(await names('/academic-years')).toEqual(['2027', '2028']);

    const updated = await api('PATCH', `/academic-years/${res.body.id}`, {
      updatedAt: res.body.updatedAt,
      name: 'Year 2027',
      endDate: '2027-12-20',
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Year 2027', endDate: '2027-12-20' });

    expect((await auditActions(base, owner.token)).slice(0, 3)).toEqual([
      'academic_year.updated',
      'academic_year.created',
      'academic_year.created',
    ]);
  });

  it('pages in start-date order with a cursor', async () => {
    const { api, addYear } = await setup();
    await addYear('2029', '2029-01-01', '2029-12-31');
    await addYear('2027', '2027-01-01', '2027-12-31');
    await addYear('2028', '2028-01-01', '2028-12-31');

    const first = await api('GET', '/academic-years?limit=2');
    expect(first.body.data.map((y: Year) => y.name)).toEqual(['2027', '2028']);
    const second = await api('GET', `/academic-years?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.data.map((y: Year) => y.name)).toEqual(['2029']);
    expect(second.body.nextCursor).toBeNull();
  });

  it.each<[unknown, string[]]>([
    [{ name: '2027', startDate: '2027-12-17', endDate: '2027-01-25' }, ['endDate']],
    [{ name: '2027', startDate: '2027-02-30', endDate: '2027-12-17' }, ['startDate']],
    [{ name: '2027', startDate: '25/01/2027', endDate: '2027-12-17' }, ['startDate']],
    [{ name: ' ', startDate: '2027-01-25', endDate: '2027-12-17' }, ['name']],
    [{ startDate: '2027-01-25', endDate: '2027-12-17' }, ['name']],
  ])('rejects %j with 400', async (body, fields) => {
    const { api } = await setup();
    const res = await api('POST', '/academic-years', body);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(fields);
  });

  it('refuses years that overlap, even by one day, but allows back-to-back years', async () => {
    const { api, addYear } = await setup();
    await addYear('2027', '2027-01-01', '2027-12-31');

    const sameDay = await api('POST', '/academic-years', {
      name: '2028',
      startDate: '2027-12-31',
      endDate: '2028-12-30',
    });
    expect(sameDay.status).toBe(422);
    expect(sameDay.body.error.message).toContain('"2027"');

    const inside = await api('POST', '/academic-years', {
      name: 'Mid',
      startDate: '2027-03-01',
      endDate: '2027-04-01',
    });
    expect(inside.status).toBe(422);

    expect(
      (
        await api('POST', '/academic-years', {
          name: '2028',
          startDate: '2028-01-01',
          endDate: '2028-12-31',
        })
      ).status,
    ).toBe(201);
  });

  it('refuses new dates that overlap another year or leave a term outside', async () => {
    const { api, addYear, addTerm } = await setup();
    const y27 = await addYear('2027', '2027-01-01', '2027-12-31');
    await addYear('2028', '2028-01-01', '2028-12-31');
    await addTerm(y27.id, 'Term 4', '2027-10-04', '2027-12-17');

    const overlap = await api('PATCH', `/academic-years/${y27.id}`, {
      updatedAt: y27.updatedAt,
      endDate: '2028-01-10',
    });
    expect(overlap.status).toBe(422);

    const shrink = await api('PATCH', `/academic-years/${y27.id}`, {
      updatedAt: y27.updatedAt,
      endDate: '2027-12-10',
    });
    expect(shrink.status).toBe(422);
    expect(shrink.body.error.message).toContain('"Term 4"');

    const ok = await api('PATCH', `/academic-years/${y27.id}`, {
      updatedAt: y27.updatedAt,
      endDate: '2027-12-17',
    });
    expect(ok.status).toBe(200);
  });

  it('rejects a new end date before the stored start date with 400', async () => {
    const { api, addYear } = await setup();
    const y = await addYear('2027', '2027-01-25', '2027-12-17');
    const res = await api('PATCH', `/academic-years/${y.id}`, {
      updatedAt: y.updatedAt,
      endDate: '2027-01-01',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'validation_failed',
      fields: { endDate: ['Must be on or after startDate'] },
    });
  });

  it('keeps names unique, ignoring case', async () => {
    const { api, addYear } = await setup();
    await addYear('Year A', '2027-01-01', '2027-12-31');
    const dup = await api('POST', '/academic-years', {
      name: 'year a',
      startDate: '2028-01-01',
      endDate: '2028-12-31',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields).toEqual({ name: ['Taken'] });
  });

  it('returns 409 for a stale updatedAt, and the year unchanged for an empty PATCH', async () => {
    const { api, addYear } = await setup();
    const y = await addYear('2027', '2027-01-01', '2027-12-31');

    const same = await api('PATCH', `/academic-years/${y.id}`, { updatedAt: y.updatedAt });
    expect(same.status).toBe(200);
    expect(same.body).toEqual(y);

    await api('PATCH', `/academic-years/${y.id}`, { updatedAt: y.updatedAt, name: 'One' });
    const stale = await api('PATCH', `/academic-years/${y.id}`, {
      updatedAt: y.updatedAt,
      name: 'Two',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });

  it("can't be deleted", async () => {
    const { api, addYear } = await setup();
    const y = await addYear('2027', '2027-01-01', '2027-12-31');
    expect((await api('DELETE', `/academic-years/${y.id}`)).status).toBe(404);
    expect((await api('GET', '/academic-years')).body.data).toHaveLength(1);
  });
});

describe('terms', () => {
  it('adds, lists, filters by year, updates and deletes terms, with audit rows', async () => {
    const { owner, base, api, addYear, addTerm, names } = await setup();
    const y27 = await addYear('2027', '2027-01-01', '2027-12-31');
    const y28 = await addYear('2028', '2028-01-01', '2028-12-31');

    const t2 = await addTerm(y27.id, 'Term 2', '2027-04-26', '2027-07-02');
    const res = await api('POST', '/terms', {
      academicYearId: y27.id,
      name: 'Term 1',
      startDate: '2027-02-01',
      endDate: '2027-04-16',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.stringMatching(/^trm_/),
      academicYearId: y27.id,
      name: 'Term 1',
    });
    await addTerm(y28.id, 'Term 1', '2028-02-01', '2028-04-14');

    expect(await names('/terms')).toEqual(['Term 1', 'Term 2', 'Term 1']);
    expect(await names(`/terms?academicYearId=${y27.id}`)).toEqual(['Term 1', 'Term 2']);

    const updated = await api('PATCH', `/terms/${t2.id}`, {
      updatedAt: t2.updatedAt,
      endDate: '2027-07-09',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.endDate).toBe('2027-07-09');

    expect((await api('DELETE', `/terms/${t2.id}`)).status).toBe(204);
    expect(await names(`/terms?academicYearId=${y27.id}`)).toEqual(['Term 1']);

    expect((await auditActions(base, owner.token)).slice(0, 5)).toEqual([
      'term.deleted',
      'term.updated',
      'term.created',
      'term.created',
      'term.created',
    ]);
  });

  it('pages terms in start-date order', async () => {
    const { api, addYear, addTerm } = await setup();
    const y = await addYear('2027', '2027-01-01', '2027-12-31');
    await addTerm(y.id, 'C', '2027-09-01', '2027-10-01');
    await addTerm(y.id, 'A', '2027-02-01', '2027-03-01');
    await addTerm(y.id, 'B', '2027-05-01', '2027-06-01');

    const first = await api('GET', '/terms?limit=2');
    expect(first.body.data.map((t: Term) => t.name)).toEqual(['A', 'B']);
    const second = await api('GET', `/terms?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.data.map((t: Term) => t.name)).toEqual(['C']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('refuses a term outside its academic year', async () => {
    const { api, addYear } = await setup();
    const y = await addYear('2027', '2027-01-25', '2027-12-17');
    const res = await api('POST', '/terms', {
      academicYearId: y.id,
      name: 'Summer school',
      startDate: '2027-12-10',
      endDate: '2028-01-20',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('"2027"');
  });

  it('refuses overlapping terms, but allows back-to-back ones', async () => {
    const { api, addYear, addTerm } = await setup();
    const y = await addYear('2027', '2027-01-01', '2027-12-31');
    const t1 = await addTerm(y.id, 'Term 1', '2027-02-01', '2027-04-16');

    const overlap = await api('POST', '/terms', {
      academicYearId: y.id,
      name: 'Term 2',
      startDate: '2027-04-16',
      endDate: '2027-07-02',
    });
    expect(overlap.status).toBe(422);
    expect(overlap.body.error.message).toContain('"Term 1"');

    const t2 = await addTerm(y.id, 'Term 2', '2027-04-17', '2027-07-02');
    const stretch = await api('PATCH', `/terms/${t1.id}`, {
      updatedAt: t1.updatedAt,
      endDate: '2027-05-01',
    });
    expect(stretch.status).toBe(422);
    expect(t2.startDate).toBe('2027-04-17');
  });

  it('keeps names unique within a year, ignoring case', async () => {
    const { api, addYear, addTerm } = await setup();
    const y27 = await addYear('2027', '2027-01-01', '2027-12-31');
    const y28 = await addYear('2028', '2028-01-01', '2028-12-31');
    await addTerm(y27.id, 'Term 1', '2027-02-01', '2027-04-16');

    const dup = await api('POST', '/terms', {
      academicYearId: y27.id,
      name: 'TERM 1',
      startDate: '2027-05-01',
      endDate: '2027-06-01',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields).toEqual({ name: ['Taken'] });
    expect((await addTerm(y28.id, 'Term 1', '2028-02-01', '2028-04-14')).name).toBe('Term 1');
  });

  it('keeps a term in its academic year', async () => {
    const { api, addYear, addTerm } = await setup();
    const y27 = await addYear('2027', '2027-01-01', '2027-12-31');
    const y28 = await addYear('2028', '2028-01-01', '2028-12-31');
    const t = await addTerm(y27.id, 'Term 1', '2027-02-01', '2027-04-16');

    const res = await api('PATCH', `/terms/${t.id}`, {
      updatedAt: t.updatedAt,
      academicYearId: y28.id,
      name: 'First term',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ academicYearId: y27.id, name: 'First term' });
  });

  it('returns 404 for an unknown academic year', async () => {
    const { api } = await setup();
    const res = await api('POST', '/terms', {
      academicYearId: 'acy_missing',
      name: 'Term 1',
      startDate: '2027-02-01',
      endDate: '2027-04-16',
    });
    expect(res.status).toBe(404);
    expect((await api('GET', '/terms?academicYearId=acy_missing')).status).toBe(404);
  });

  it('rejects an end date before the start with 400, and a stale updatedAt with 409', async () => {
    const { api, addYear, addTerm } = await setup();
    const y = await addYear('2027', '2027-01-01', '2027-12-31');
    const bad = await api('POST', '/terms', {
      academicYearId: y.id,
      name: 'Term 1',
      startDate: '2027-04-16',
      endDate: '2027-02-01',
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields)).toEqual(['endDate']);

    const t = await addTerm(y.id, 'Term 1', '2027-02-01', '2027-04-16');
    await api('PATCH', `/terms/${t.id}`, { updatedAt: t.updatedAt, name: 'T1' });
    const stale = await api('PATCH', `/terms/${t.id}`, { updatedAt: t.updatedAt, name: 'T one' });
    expect(stale.status).toBe(409);
  });
});

describe('holidays', () => {
  it('adds, lists in date order and deletes holidays, with audit rows', async () => {
    const { owner, base, api, addHoliday, addBranch, names } = await setup();
    const albany = await addBranch('Albany');
    await addHoliday('Labour Day', '2027-10-25', '2027-10-25');

    const res = await api('POST', '/holidays', {
      name: 'Easter break',
      startDate: '2027-03-26',
      endDate: '2027-04-05',
      branchId: albany.id,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.stringMatching(/^hol_/),
      name: 'Easter break',
      branchId: albany.id,
    });

    expect(await names('/holidays')).toEqual(['Easter break', 'Labour Day']);
    const labour = (await api('GET', '/holidays')).body.data[1] as Holiday;
    expect(labour.branchId).toBeNull();

    expect((await api('DELETE', `/holidays/${res.body.id}`)).status).toBe(204);
    expect(await names('/holidays')).toEqual(['Labour Day']);

    expect((await auditActions(base, owner.token)).slice(0, 3)).toEqual([
      'holiday.deleted',
      'holiday.created',
      'holiday.created',
    ]);
  });

  it('filters by date range and by branch', async () => {
    const { api, addHoliday, addBranch, names } = await setup();
    const albany = await addBranch('Albany');
    const botany = await addBranch('Botany');
    await addHoliday('Summer break', '2026-12-19', '2027-01-24');
    await addHoliday('Albany repairs', '2027-03-01', '2027-03-05', albany.id);
    await addHoliday('Botany closed', '2027-03-03', '2027-03-03', botany.id);
    await addHoliday('Labour Day', '2027-10-25', '2027-10-25');

    // Holidays that touch the range, including one that started before it.
    expect(await names('/holidays?from=2027-01-01&to=2027-03-02')).toEqual([
      'Summer break',
      'Albany repairs',
    ]);
    expect(await names(`/holidays?branchId=${albany.id}`)).toEqual([
      'Summer break',
      'Albany repairs',
      'Labour Day',
    ]);
  });

  it('allows a break that spans two academic years, with no years set up at all', async () => {
    const { addHoliday } = await setup();
    const h = await addHoliday('Summer break', '2026-12-19', '2027-01-24');
    expect(h.endDate).toBe('2027-01-24');
  });

  it("returns 404 for a branch that isn't the org's", async () => {
    const { api, addBranch } = await setup();
    const gone = await addBranch('Gone');
    await api('DELETE', `/branches/${gone.id}`);
    const body = { name: 'Closed', startDate: '2027-03-01', endDate: '2027-03-01' };

    expect((await api('POST', '/holidays', { ...body, branchId: gone.id })).status).toBe(404);
    expect((await api('POST', '/holidays', { ...body, branchId: 'brn_missing' })).status).toBe(404);
    expect((await api('GET', `/holidays?branchId=${gone.id}`)).status).toBe(404);
  });

  it('rejects an end date before the start, and bad filter dates, with 400', async () => {
    const { api } = await setup();
    const bad = await api('POST', '/holidays', {
      name: 'Backwards',
      startDate: '2027-03-05',
      endDate: '2027-03-01',
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields)).toEqual(['endDate']);
    expect((await api('GET', '/holidays?from=03/01/2027')).status).toBe(400);
  });

  it('refuses to delete a branch while it has its own holidays', async () => {
    const { api, addBranch, addHoliday } = await setup();
    const albany = await addBranch('Albany');
    const h = await addHoliday('Albany repairs', '2027-03-01', '2027-03-05', albany.id);
    await addHoliday('Labour Day', '2027-10-25', '2027-10-25');

    const refused = await api('DELETE', `/branches/${albany.id}`);
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toContain('1 holiday');

    await api('DELETE', `/holidays/${h.id}`);
    expect((await api('DELETE', `/branches/${albany.id}`)).status).toBe(204);
  });
});

describe('org isolation', () => {
  it("can't read or change another org's calendar through any route", async () => {
    const alice = await setup();
    const year = await alice.addYear('2027', '2027-01-01', '2027-12-31');
    const term = await alice.addTerm(year.id, 'Term 1', '2027-02-01', '2027-04-16');
    const holiday = await alice.addHoliday('Labour Day', '2027-10-25', '2027-10-25');
    const branch = await alice.addBranch('Albany');
    const bob = await setup();

    const results = await Promise.all([
      bob.api('PATCH', `/academic-years/${year.id}`, { updatedAt: year.updatedAt, name: 'X' }),
      bob.api('POST', '/terms', {
        academicYearId: year.id,
        name: 'Sneaky',
        startDate: '2027-05-01',
        endDate: '2027-06-01',
      }),
      bob.api('PATCH', `/terms/${term.id}`, { updatedAt: term.updatedAt, name: 'X' }),
      bob.api('DELETE', `/terms/${term.id}`),
      bob.api('GET', `/terms?academicYearId=${year.id}`),
      bob.api('DELETE', `/holidays/${holiday.id}`),
      bob.api('POST', '/holidays', {
        name: 'Sneaky',
        startDate: '2027-03-01',
        endDate: '2027-03-01',
        branchId: branch.id,
      }),
      bob.api('GET', `/holidays?branchId=${branch.id}`),
      call('GET', `${alice.base}/academic-years`, { token: bob.owner.token }),
      call('GET', `${alice.base}/holidays`, { token: bob.owner.token }),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(404));

    expect(await alice.names('/terms')).toEqual(['Term 1']);
    expect(await alice.names('/holidays')).toEqual(['Labour Day']);
    expect(await bob.names('/academic-years')).toEqual([]);
  });
});

describe('permissions', () => {
  it.each(['branch_manager', 'front_desk', 'teacher', 'parent', 'accountant'] as Role[])(
    '%s can read the calendar but not change it',
    async (role) => {
      const { org, base, addYear, addTerm, addHoliday } = await setup();
      const year = await addYear('2027', '2027-01-01', '2027-12-31');
      const term = await addTerm(year.id, 'Term 1', '2027-02-01', '2027-04-16');
      const holiday = await addHoliday('Labour Day', '2027-10-25', '2027-10-25');
      const member = await newUser(role);
      const token = await addMember(org.id, member.clerkUserId, role);
      const as = (method: string, path: string, body?: unknown) =>
        call(method, `${base}${path}`, { token, body });

      const reads = await Promise.all([
        as('GET', '/academic-years'),
        as('GET', '/terms'),
        as('GET', '/holidays'),
      ]);
      expect(reads.map((r) => r.status)).toEqual([200, 200, 200]);

      const writes = await Promise.all([
        as('POST', '/academic-years', {
          name: '2028',
          startDate: '2028-01-01',
          endDate: '2028-12-31',
        }),
        as('PATCH', `/academic-years/${year.id}`, { updatedAt: year.updatedAt, name: 'X' }),
        as('POST', '/terms', {
          academicYearId: year.id,
          name: 'Term 2',
          startDate: '2027-05-01',
          endDate: '2027-06-01',
        }),
        as('PATCH', `/terms/${term.id}`, { updatedAt: term.updatedAt, name: 'X' }),
        as('DELETE', `/terms/${term.id}`),
        as('POST', '/holidays', { name: 'X', startDate: '2027-03-01', endDate: '2027-03-01' }),
        as('DELETE', `/holidays/${holiday.id}`),
      ]);
      expect(writes.map((r) => r.status)).toEqual(Array(7).fill(403));
    },
  );
});
