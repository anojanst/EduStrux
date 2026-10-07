import { memberships } from '@edustrux/db';
import { newId, type Role } from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import { addMember, call, db, newOrg, newUser, sampleOrg } from './helpers';

type Branch = { id: string; name: string; address: string | null; updatedAt: string };
type Room = {
  id: string;
  branchId: string;
  name: string;
  capacity: number | null;
  updatedAt: string;
};

/** An owner with a fresh org, and helpers bound to that org. */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const main = (await api('GET', '/branches')).body.data[0] as Branch;
  const addBranch = async (name: string) => {
    const res = await api('POST', '/branches', { name });
    if (res.status !== 201) throw new Error(`branch create failed: ${JSON.stringify(res.body)}`);
    return res.body as Branch;
  };
  const addRoom = async (branchId: string, name: string, capacity?: number) => {
    const res = await api('POST', `/branches/${branchId}/rooms`, { name, capacity });
    if (res.status !== 201) throw new Error(`room create failed: ${JSON.stringify(res.body)}`);
    return res.body as Room;
  };
  return { owner, org, base, api, main, addBranch, addRoom };
}

async function auditActions(base: string, token: string) {
  const res = await call('GET', `${base}/audit-log`, { token });
  return res.body.data.map((e: { action: string }) => e.action) as string[];
}

describe('default branch', () => {
  it('gives every new org one "Main" branch, recorded in its org.created audit row', async () => {
    const { owner, base, api, main } = await setup();

    const list = await api('GET', '/branches');
    expect(list.status).toBe(200);
    expect(list.body).toEqual({
      data: [
        {
          id: expect.stringMatching(/^brn_/),
          name: 'Main',
          address: null,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      ],
      nextCursor: null,
    });

    const audit = await call('GET', `${base}/audit-log`, { token: owner.token });
    expect(audit.body.data).toHaveLength(1);
    expect(audit.body.data[0]).toMatchObject({
      action: 'org.created',
      after: { defaultBranch: { id: main.id, name: 'Main' } },
    });
  });
});

describe('branches', () => {
  it('adds, lists, updates and deletes a branch, with an audit row for each write', async () => {
    const { owner, base, api, main } = await setup();

    const created = await api('POST', '/branches', {
      name: '  Albany ',
      address: '12 Main Road, Albany',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^brn_/),
      name: 'Albany',
      address: '12 Main Road, Albany',
    });
    expect(created.body).not.toHaveProperty('orgId');
    expect(created.body).not.toHaveProperty('deletedAt');

    const list = await api('GET', '/branches');
    expect(list.body.data.map((b: Branch) => b.name)).toEqual(['Main', 'Albany']);

    const updated = await api('PATCH', `/branches/${created.body.id}`, {
      updatedAt: created.body.updatedAt,
      name: 'Albany Village',
      address: null,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Albany Village', address: null });

    const removed = await api('DELETE', `/branches/${created.body.id}`);
    expect(removed.status).toBe(204);
    expect(removed.body).toBeNull();
    expect((await api('GET', '/branches')).body.data).toEqual([
      expect.objectContaining({ id: main.id }),
    ]);

    expect((await auditActions(base, owner.token)).slice(0, 3)).toEqual([
      'branch.deleted',
      'branch.updated',
      'branch.created',
    ]);
  });

  it('pages the list with a cursor, oldest first', async () => {
    const { api, addBranch } = await setup();
    await addBranch('Second');
    await addBranch('Third');

    const first = await api('GET', '/branches?limit=2');
    expect(first.body.data.map((b: Branch) => b.name)).toEqual(['Main', 'Second']);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await api('GET', `/branches?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.data.map((b: Branch) => b.name)).toEqual(['Third']);
    expect(second.body.nextCursor).toBeNull();
  });

  it.each([
    [{}, ['name']],
    [{ name: '   ' }, ['name']],
    [{ name: 'x'.repeat(121) }, ['name']],
    [{ name: 'Albany', address: 42 }, ['address']],
  ])('rejects an invalid branch %j with field errors', async (body, fields) => {
    const { api } = await setup();
    const res = await api('POST', '/branches', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.fields)).toEqual(fields);
  });

  it('keeps names unique in the org, ignoring case, but frees a name when its branch is deleted', async () => {
    const { api, main, addBranch } = await setup();
    const albany = await addBranch('Albany');

    const dup = await api('POST', '/branches', { name: 'ALBANY' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'conflict', fields: { name: ['Taken'] } });

    const rename = await api('PATCH', `/branches/${main.id}`, {
      updatedAt: main.updatedAt,
      name: 'albany',
    });
    expect(rename.status).toBe(409);

    expect((await api('DELETE', `/branches/${albany.id}`)).status).toBe(204);
    expect((await api('POST', '/branches', { name: 'Albany' })).status).toBe(201);
  });

  it('lets a branch keep its own name in a different case', async () => {
    const { api, main } = await setup();
    const res = await api('PATCH', `/branches/${main.id}`, {
      updatedAt: main.updatedAt,
      name: 'MAIN',
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('MAIN');
  });

  it('returns 409 when updatedAt is stale', async () => {
    const { api, main } = await setup();
    await api('PATCH', `/branches/${main.id}`, { updatedAt: main.updatedAt, name: 'First' });
    const stale = await api('PATCH', `/branches/${main.id}`, {
      updatedAt: main.updatedAt,
      name: 'Second',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });

  it('returns the branch unchanged when a PATCH changes nothing', async () => {
    const { api, main } = await setup();
    const res = await api('PATCH', `/branches/${main.id}`, { updatedAt: main.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(main);
  });
});

describe('deleting a branch', () => {
  it("refuses to delete the org's last branch", async () => {
    const { api, main } = await setup();
    const res = await api('DELETE', `/branches/${main.id}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('unprocessable');
  });

  it('refuses while the branch has rooms', async () => {
    const { api, addBranch, addRoom } = await setup();
    const albany = await addBranch('Albany');
    const room = await addRoom(albany.id, 'Room 1');

    expect((await api('DELETE', `/branches/${albany.id}`)).status).toBe(422);
    expect((await api('DELETE', `/rooms/${room.id}`)).status).toBe(204);
    expect((await api('DELETE', `/branches/${albany.id}`)).status).toBe(204);
  });

  it('refuses while staff are limited to the branch', async () => {
    const { org, api, addBranch } = await setup();
    const albany = await addBranch('Albany');
    const manager = await newUser('branch_manager');
    await db()
      .insert(memberships)
      .values({
        id: newId('membership'),
        orgId: org.id,
        userId: manager.userId,
        role: 'branch_manager',
        branchIds: [albany.id],
      });

    const res = await api('DELETE', `/branches/${albany.id}`);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('1 staff member');
  });
});

describe('single-tutor mode', () => {
  it('refuses a second branch while the mode is on, and allows it once turned off', async () => {
    const owner = await newUser('owner');
    const created = await call('POST', '/api/v1/orgs', {
      token: owner.token,
      body: { ...sampleOrg(), singleTutorMode: true },
    });
    const base = `/api/v1/orgs/${created.body.id}`;

    const refused = await call('POST', `${base}/branches`, {
      token: owner.token,
      body: { name: 'Second' },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('unprocessable');

    await call('PATCH', base, {
      token: owner.token,
      body: { updatedAt: created.body.updatedAt, singleTutorMode: false },
    });
    const allowed = await call('POST', `${base}/branches`, {
      token: owner.token,
      body: { name: 'Second' },
    });
    expect(allowed.status).toBe(201);
  });

  it('refuses to turn the mode on while the org has more than one branch', async () => {
    const { org, base, owner, addBranch } = await setup();
    await addBranch('Second');

    const res = await call('PATCH', base, {
      token: owner.token,
      body: { updatedAt: org.updatedAt, singleTutorMode: true },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toEqual({ singleTutorMode: ['More than one branch'] });
  });

  it('can be turned on when the org has one branch', async () => {
    const { org, base, owner } = await setup();
    const res = await call('PATCH', base, {
      token: owner.token,
      body: { updatedAt: org.updatedAt, singleTutorMode: true },
    });
    expect(res.status).toBe(200);
    expect(res.body.singleTutorMode).toBe(true);
  });
});

describe('rooms', () => {
  it('adds, lists, updates and deletes a room, with an audit row for each write', async () => {
    const { owner, base, api, main } = await setup();

    const created = await api('POST', `/branches/${main.id}/rooms`, {
      name: 'Room 1',
      capacity: 12,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^rm_/),
      branchId: main.id,
      name: 'Room 1',
      capacity: 12,
    });
    const noCapacity = await api('POST', `/branches/${main.id}/rooms`, { name: 'Hall' });
    expect(noCapacity.body.capacity).toBeNull();

    const list = await api('GET', `/branches/${main.id}/rooms`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: Room) => r.name)).toEqual(['Room 1', 'Hall']);

    const updated = await api('PATCH', `/rooms/${created.body.id}`, {
      updatedAt: created.body.updatedAt,
      capacity: null,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Room 1', capacity: null });

    expect((await api('DELETE', `/rooms/${created.body.id}`)).status).toBe(204);
    const after = await api('GET', `/branches/${main.id}/rooms`);
    expect(after.body.data.map((r: Room) => r.name)).toEqual(['Hall']);

    expect((await auditActions(base, owner.token)).slice(0, 4)).toEqual([
      'room.deleted',
      'room.updated',
      'room.created',
      'room.created',
    ]);
  });

  it('pages rooms with a cursor', async () => {
    const { api, main, addRoom } = await setup();
    for (const name of ['A', 'B', 'C']) await addRoom(main.id, name);

    const first = await api('GET', `/branches/${main.id}/rooms?limit=2`);
    expect(first.body.data.map((r: Room) => r.name)).toEqual(['A', 'B']);
    const second = await api(
      'GET',
      `/branches/${main.id}/rooms?limit=2&cursor=${first.body.nextCursor}`,
    );
    expect(second.body.data.map((r: Room) => r.name)).toEqual(['C']);
    expect(second.body.nextCursor).toBeNull();
  });

  it.each([0, 1001, 2.5, '12'])('rejects capacity %j', async (capacity) => {
    const { api, main } = await setup();
    const res = await api('POST', `/branches/${main.id}/rooms`, { name: 'Room 1', capacity });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['capacity']);
  });

  it('keeps room names unique within a branch, ignoring case', async () => {
    const { api, main, addBranch, addRoom } = await setup();
    await addRoom(main.id, 'Room 1');

    const dup = await api('POST', `/branches/${main.id}/rooms`, { name: 'ROOM 1' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields).toEqual({ name: ['Taken'] });

    const albany = await addBranch('Albany');
    expect((await api('POST', `/branches/${albany.id}/rooms`, { name: 'Room 1' })).status).toBe(
      201,
    );
  });

  it('never moves a room to another branch', async () => {
    const { api, main, addBranch, addRoom } = await setup();
    const room = await addRoom(main.id, 'Room 1');
    const albany = await addBranch('Albany');

    const res = await api('PATCH', `/rooms/${room.id}`, {
      updatedAt: room.updatedAt,
      branchId: albany.id,
      name: 'Room One',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ branchId: main.id, name: 'Room One' });
  });

  it('returns 409 when updatedAt is stale', async () => {
    const { api, main, addRoom } = await setup();
    const room = await addRoom(main.id, 'Room 1');
    await api('PATCH', `/rooms/${room.id}`, { updatedAt: room.updatedAt, capacity: 5 });
    const stale = await api('PATCH', `/rooms/${room.id}`, {
      updatedAt: room.updatedAt,
      capacity: 6,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });

  it("returns 404 for a deleted branch's rooms", async () => {
    const { api, addBranch } = await setup();
    const albany = await addBranch('Albany');
    await api('DELETE', `/branches/${albany.id}`);

    expect((await api('GET', `/branches/${albany.id}/rooms`)).status).toBe(404);
    expect((await api('POST', `/branches/${albany.id}/rooms`, { name: 'Room 1' })).status).toBe(
      404,
    );
  });
});

describe('org isolation', () => {
  it("can't read or change another org's branches and rooms through any route", async () => {
    const alice = await setup();
    const room = await alice.addRoom(alice.main.id, 'Room 1');
    const bob = await setup();

    // Bob uses his own org in the path, with Alice's ids.
    const results = await Promise.all([
      bob.api('PATCH', `/branches/${alice.main.id}`, {
        updatedAt: alice.main.updatedAt,
        name: 'Hijacked',
      }),
      bob.api('DELETE', `/branches/${alice.main.id}`),
      bob.api('GET', `/branches/${alice.main.id}/rooms`),
      bob.api('POST', `/branches/${alice.main.id}/rooms`, { name: 'Sneaky' }),
      bob.api('PATCH', `/rooms/${room.id}`, { updatedAt: room.updatedAt, name: 'Hijacked' }),
      bob.api('DELETE', `/rooms/${room.id}`),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404]);

    // Bob uses Alice's org in the path.
    const viaAliceOrg = await Promise.all([
      call('GET', `${alice.base}/branches`, { token: bob.owner.token }),
      call('POST', `${alice.base}/branches`, { token: bob.owner.token, body: { name: 'X' } }),
    ]);
    expect(viaAliceOrg.map((r) => r.status)).toEqual([404, 404]);

    const after = await alice.api('GET', `/branches/${alice.main.id}/rooms`);
    expect(after.body.data).toEqual([expect.objectContaining({ name: 'Room 1' })]);
  });
});

describe('permissions', () => {
  it.each(['branch_manager', 'front_desk', 'teacher', 'parent', 'accountant'] as Role[])(
    '%s can read branches and rooms but not change them',
    async (role) => {
      const { org, base, main, addRoom } = await setup();
      const room = await addRoom(main.id, 'Room 1');
      const member = await newUser(role);
      const token = await addMember(org.id, member.clerkUserId, role);
      const as = (method: string, path: string, body?: unknown) =>
        call(method, `${base}${path}`, { token, body });

      expect((await as('GET', '/branches')).status).toBe(200);
      expect((await as('GET', `/branches/${main.id}/rooms`)).status).toBe(200);

      const writes = await Promise.all([
        as('POST', '/branches', { name: 'Nope' }),
        as('PATCH', `/branches/${main.id}`, { updatedAt: main.updatedAt, name: 'Nope' }),
        as('DELETE', `/branches/${main.id}`),
        as('POST', `/branches/${main.id}/rooms`, { name: 'Nope' }),
        as('PATCH', `/rooms/${room.id}`, { updatedAt: room.updatedAt, name: 'Nope' }),
        as('DELETE', `/rooms/${room.id}`),
      ]);
      expect(writes.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
      expect(writes[0]!.body.error.code).toBe('forbidden');
    },
  );
});
