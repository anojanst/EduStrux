import { taxRates } from '@edustrux/db';
import type { Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { addMember, call, db, newOrg, newUser } from './helpers';

type TaxRate = { id: string; name: string; rateBps: number; inclusive: boolean; updatedAt: string };

async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const addRate = async (name: string, rateBps: number, inclusive = true) => {
    const res = await api('POST', '/tax-rates', { name, rateBps, inclusive });
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

    const res = await api('POST', '/tax-rates', { name: 'GST', rateBps: 1500, inclusive: true });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^txr_/),
      name: 'GST',
      rateBps: 1500,
      inclusive: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    await addRate('Zero-rated', 0, false);
    expect((await api('GET', '/tax-rates')).body.data.map((r: TaxRate) => r.name)).toEqual([
      'GST',
      'Zero-rated',
    ]);

    const updated = await api('PATCH', `/tax-rates/${res.body.id}`, {
      updatedAt: res.body.updatedAt,
      rateBps: 1250,
      inclusive: false,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'GST', rateBps: 1250, inclusive: false });

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

  it.each([[0], [1], [887], [1500], [10_000]])('stores %i basis points as given', async (bps) => {
    const { addRate } = await setup();
    const rate = await addRate('Sales tax', bps);
    expect(rate.rateBps).toBe(bps);
    const row = await db().query.taxRates.findFirst({ where: eq(taxRates.id, rate.id) });
    expect(row?.rateBps).toBe(bps);
  });

  it.each<[unknown]>([[10_001], [-1], [887.5], ['1500'], [null]])(
    'rejects rateBps %j with 400',
    async (rateBps) => {
      const { api } = await setup();
      const res = await api('POST', '/tax-rates', { name: 'GST', rateBps, inclusive: true });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.error.fields)).toEqual(['rateBps']);
    },
  );

  it('requires the inclusive flag and a name', async () => {
    const { api } = await setup();
    const res = await api('POST', '/tax-rates', { rateBps: 1500 });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['inclusive', 'name']);
  });

  it('keeps names unique in the org, ignoring case', async () => {
    const { api, addRate } = await setup();
    await addRate('GST', 1500);
    const vat = await addRate('VAT', 2000);

    expect(
      (await api('POST', '/tax-rates', { name: 'gst', rateBps: 1000, inclusive: true })).status,
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
    for (const name of ['A', 'B', 'C']) await addRate(name, 1000);
    const first = await api('GET', '/tax-rates?limit=2');
    expect(first.body.data.map((r: TaxRate) => r.name)).toEqual(['A', 'B']);
    const second = await api('GET', `/tax-rates?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.data.map((r: TaxRate) => r.name)).toEqual(['C']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('returns 409 for a stale updatedAt, and the rate unchanged for an empty PATCH', async () => {
    const { api, addRate } = await setup();
    const rate = await addRate('GST', 1500);

    const same = await api('PATCH', `/tax-rates/${rate.id}`, { updatedAt: rate.updatedAt });
    expect(same.status).toBe(200);
    expect(same.body).toEqual(rate);

    await api('PATCH', `/tax-rates/${rate.id}`, { updatedAt: rate.updatedAt, rateBps: 1000 });
    const stale = await api('PATCH', `/tax-rates/${rate.id}`, {
      updatedAt: rate.updatedAt,
      rateBps: 1200,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });
});

describe('org isolation', () => {
  it("can't read or change another org's tax rates", async () => {
    const alice = await setup();
    const rate = await alice.addRate('GST', 1500);
    const bob = await setup();

    const results = await Promise.all([
      bob.api('PATCH', `/tax-rates/${rate.id}`, { updatedAt: rate.updatedAt, rateBps: 0 }),
      bob.api('DELETE', `/tax-rates/${rate.id}`),
      call('GET', `${alice.base}/tax-rates`, { token: bob.owner.token }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404]);
    expect((await alice.api('GET', '/tax-rates')).body.data[0].rateBps).toBe(1500);
  });
});

describe('permissions', () => {
  it.each(['branch_manager', 'front_desk', 'teacher', 'parent', 'accountant'] as Role[])(
    '%s can read tax rates but not change them',
    async (role) => {
      const { org, base, addRate } = await setup();
      const rate = await addRate('GST', 1500);
      const member = await newUser(role);
      const token = await addMember(org.id, member.clerkUserId, role);
      const as = (method: string, path: string, body?: unknown) =>
        call(method, `${base}${path}`, { token, body });

      expect((await as('GET', '/tax-rates')).status).toBe(200);
      const writes = await Promise.all([
        as('POST', '/tax-rates', { name: 'VAT', rateBps: 2000, inclusive: false }),
        as('PATCH', `/tax-rates/${rate.id}`, { updatedAt: rate.updatedAt, rateBps: 0 }),
        as('DELETE', `/tax-rates/${rate.id}`),
      ]);
      expect(writes.map((r) => r.status)).toEqual([403, 403, 403]);
    },
  );
});
