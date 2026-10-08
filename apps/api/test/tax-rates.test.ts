import { taxRates } from '@edustrux/db';
import type { Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { addMember, call, db, newOrg, newUser } from './helpers';

type TaxRate = { id: string; name: string; percent: string; inclusive: boolean; updatedAt: string };

async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const addRate = async (name: string, percent: string, inclusive = true) => {
    const res = await api('POST', '/tax-rates', { name, percent, inclusive });
    if (res.status !== 201) throw new Error(`tax rate create failed: ${JSON.stringify(res.body)}`);
    return res.body as TaxRate;
  };
  return { owner, org, base, api, addRate };
}

describe('tax rates', () => {
  it('starts with none, which means no tax', async () => {
    const { api } = await setup();
    const res = await api('GET', '/tax-rates');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], nextCursor: null });
  });

  it('adds, lists, updates and deletes a rate, with audit rows', async () => {
    const { owner, base, api, addRate } = await setup();

    const res = await api('POST', '/tax-rates', { name: 'GST', percent: '15', inclusive: true });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^txr_/),
      name: 'GST',
      percent: '15',
      inclusive: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    await addRate('Zero-rated', '0', false);
    expect((await api('GET', '/tax-rates')).body.data.map((r: TaxRate) => r.name)).toEqual([
      'GST',
      'Zero-rated',
    ]);

    const updated = await api('PATCH', `/tax-rates/${res.body.id}`, {
      updatedAt: res.body.updatedAt,
      percent: '12.5',
      inclusive: false,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'GST', percent: '12.5', inclusive: false });

    expect((await api('DELETE', `/tax-rates/${res.body.id}`)).status).toBe(204);
    expect((await api('GET', '/tax-rates')).body.data.map((r: TaxRate) => r.name)).toEqual([
      'Zero-rated',
    ]);

    const audit = await call('GET', `${base}/audit-log`, { token: owner.token });
    expect(audit.body.data.slice(0, 4).map((e: { action: string }) => e.action)).toEqual([
      'tax_rate.deleted',
      'tax_rate.updated',
      'tax_rate.created',
      'tax_rate.created',
    ]);
  });

  it.each([
    ['8.875', '8.875', 8875],
    ['15.0', '15', 15000],
    ['7.250', '7.25', 7250],
    ['100', '100', 100_000],
    ['0.001', '0.001', 1],
  ])('stores "%s" exactly and returns it as "%s"', async (percent, shown, stored) => {
    const { addRate } = await setup();
    const rate = await addRate('Sales tax', percent);
    expect(rate.percent).toBe(shown);
    const row = await db().query.taxRates.findFirst({ where: eq(taxRates.id, rate.id) });
    expect(row?.rateMilliPercent).toBe(stored);
  });

  it.each([['100.001'], ['101'], ['-1'], ['1.2345'], ['abc'], [''], [' 15'], ['1e2'], [15]])(
    'rejects percent %j with 400',
    async (percent) => {
      const { api } = await setup();
      const res = await api('POST', '/tax-rates', { name: 'GST', percent, inclusive: true });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.error.fields)).toEqual(['percent']);
    },
  );

  it('requires the inclusive flag and a name', async () => {
    const { api } = await setup();
    const res = await api('POST', '/tax-rates', { percent: '15' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['inclusive', 'name']);
  });

  it('keeps names unique in the org, ignoring case', async () => {
    const { api, addRate } = await setup();
    await addRate('GST', '15');
    const vat = await addRate('VAT', '20');

    expect(
      (await api('POST', '/tax-rates', { name: 'gst', percent: '10', inclusive: true })).status,
    ).toBe(409);
    const rename = await api('PATCH', `/tax-rates/${vat.id}`, {
      updatedAt: vat.updatedAt,
      name: 'GST',
    });
    expect(rename.status).toBe(409);
    expect(rename.body.error.fields).toEqual({ name: ['Taken'] });
  });

  it('pages with a cursor', async () => {
    const { api, addRate } = await setup();
    for (const name of ['A', 'B', 'C']) await addRate(name, '10');
    const first = await api('GET', '/tax-rates?limit=2');
    expect(first.body.data.map((r: TaxRate) => r.name)).toEqual(['A', 'B']);
    const second = await api('GET', `/tax-rates?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.data.map((r: TaxRate) => r.name)).toEqual(['C']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('returns 409 for a stale updatedAt, and the rate unchanged for an empty PATCH', async () => {
    const { api, addRate } = await setup();
    const rate = await addRate('GST', '15');

    const same = await api('PATCH', `/tax-rates/${rate.id}`, { updatedAt: rate.updatedAt });
    expect(same.status).toBe(200);
    expect(same.body).toEqual(rate);

    await api('PATCH', `/tax-rates/${rate.id}`, { updatedAt: rate.updatedAt, percent: '10' });
    const stale = await api('PATCH', `/tax-rates/${rate.id}`, {
      updatedAt: rate.updatedAt,
      percent: '12',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });
});

describe('org isolation', () => {
  it("can't read or change another org's tax rates", async () => {
    const alice = await setup();
    const rate = await alice.addRate('GST', '15');
    const bob = await setup();

    const results = await Promise.all([
      bob.api('PATCH', `/tax-rates/${rate.id}`, { updatedAt: rate.updatedAt, percent: '0' }),
      bob.api('DELETE', `/tax-rates/${rate.id}`),
      call('GET', `${alice.base}/tax-rates`, { token: bob.owner.token }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404]);
    expect((await alice.api('GET', '/tax-rates')).body.data[0].percent).toBe('15');
  });
});

describe('permissions', () => {
  it.each(['branch_manager', 'front_desk', 'teacher', 'parent', 'accountant'] as Role[])(
    '%s can read tax rates but not change them',
    async (role) => {
      const { org, base, addRate } = await setup();
      const rate = await addRate('GST', '15');
      const member = await newUser(role);
      const token = await addMember(org.id, member.clerkUserId, role);
      const as = (method: string, path: string, body?: unknown) =>
        call(method, `${base}${path}`, { token, body });

      expect((await as('GET', '/tax-rates')).status).toBe(200);
      const writes = await Promise.all([
        as('POST', '/tax-rates', { name: 'VAT', percent: '20', inclusive: false }),
        as('PATCH', `/tax-rates/${rate.id}`, { updatedAt: rate.updatedAt, percent: '0' }),
        as('DELETE', `/tax-rates/${rate.id}`),
      ]);
      expect(writes.map((r) => r.status)).toEqual([403, 403, 403]);
    },
  );
});
