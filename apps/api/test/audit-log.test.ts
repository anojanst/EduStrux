import { describe, expect, it } from 'vitest';
import { changedFields } from '../src/db/scope';
import { call, newOrg, newUser } from './helpers';

type Entry = {
  action: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/** An owner with a fresh org and a room in its Main branch. */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `/api/v1/orgs/${org.id}${path}`, { token: owner.token, body });
  const main = (await api('GET', '/branches')).body.data[0] as { id: string };
  const room = (await api('POST', `/branches/${main.id}/rooms`, { name: 'Room 1', capacity: 12 }))
    .body as { id: string; updatedAt: string };
  const lastAudit = async () => (await api('GET', '/audit-log?limit=1')).body.data[0] as Entry;
  return { api, room, lastAudit };
}

describe('changedFields', () => {
  it('keeps only the fields whose value changes, with the old value and the new', () => {
    const before = { name: 'Room 1', capacity: 12, notes: null, tags: ['a', 'b'] };
    expect(changedFields(before, { name: 'Room A', capacity: 12 })).toEqual({
      before: { name: 'Room 1' },
      after: { name: 'Room A' },
    });
    // A field the row doesn't have was null; equal JSON values are unchanged.
    expect(changedFields(before, { notes: 'Upstairs', tags: ['a', 'b'], extra: 1 })).toEqual({
      before: { notes: null, extra: null },
      after: { notes: 'Upstairs', extra: 1 },
    });
    // undefined is left out of an update's `set`, so it changes nothing.
    expect(changedFields(before, { name: undefined, capacity: null })).toEqual({
      before: { capacity: 12 },
      after: { capacity: null },
    });
  });
});

describe('audit rows (D-113)', () => {
  it('store only the fields an update changes, old and new', async () => {
    const { api, room, lastAudit } = await setup();

    const res = await api('PATCH', `/rooms/${room.id}`, {
      updatedAt: room.updatedAt,
      name: 'Room A',
      capacity: 12,
    });

    expect(res.status).toBe(200);
    // The capacity was sent as it was, so it isn't there.
    const { action, entityId, before, after } = await lastAudit();
    expect({ action, entityId }).toEqual({ action: 'room.updated', entityId: room.id });
    expect([before, after]).toEqual([{ name: 'Room 1' }, { name: 'Room A' }]);
  });

  it('still record an update that changes nothing, with nothing in before and after', async () => {
    const { api, room, lastAudit } = await setup();

    const res = await api('PATCH', `/rooms/${room.id}`, {
      updatedAt: room.updatedAt,
      name: 'Room 1',
    });

    expect(res.status).toBe(200);
    expect(res.body.updatedAt).not.toBe(room.updatedAt);
    expect(await lastAudit()).toMatchObject({ action: 'room.updated', before: {}, after: {} });
  });

  it('keep the whole row for a create and a delete', async () => {
    const { api, room, lastAudit } = await setup();
    const whole = { id: room.id, name: 'Room 1', capacity: 12 };

    expect(await lastAudit()).toMatchObject({ action: 'room.created', before: null, after: whole });

    expect((await api('DELETE', `/rooms/${room.id}`)).status).toBe(204);
    expect(await lastAudit()).toMatchObject({ action: 'room.deleted', before: whole });
  });
});
