import { describe, expect, it } from 'vitest';
import { addMember, call, newOrg, newUser, sampleOrg } from './helpers';

describe('orgs', () => {
  it('creates an org and makes the caller its owner', async () => {
    const { token } = await newUser('owner');
    const res = await call('POST', '/api/v1/orgs', { token, body: sampleOrg() });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Bright Minds Tuition',
      currency: 'NZD',
      plan: 'trial',
      status: 'trialing',
      dateFormat: 'DD/MM/YYYY',
    });
    expect(res.body.id).toMatch(/^org_/);
    expect(res.body.slug).toMatch(/^bright-minds-tuition/);

    const me = await call('GET', '/api/v1/me', { token });
    expect(me.body.memberships).toEqual([
      expect.objectContaining({ role: 'owner', org: expect.objectContaining({ id: res.body.id }) }),
    ]);
  });

  it('returns field errors in the shared error format', async () => {
    const { token } = await newUser();
    const res = await call('POST', '/api/v1/orgs', {
      token,
      body: { ...sampleOrg(), currency: 'nz', timezone: 'Mars/Base' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.fields)).toEqual(
      expect.arrayContaining(['currency', 'timezone']),
    );
  });

  it('only accepts English locales, on create and update (D-015)', async () => {
    const { token } = await newUser();
    const create = await call('POST', '/api/v1/orgs', {
      token,
      body: { ...sampleOrg(), locale: 'fr-FR' },
    });
    expect(create.status).toBe(400);
    expect(Object.keys(create.body.error.fields)).toEqual(['locale']);

    const org = await newOrg(token);
    const update = await call('PATCH', `/api/v1/orgs/${org.id}`, {
      token,
      body: { updatedAt: org.updatedAt, locale: 'de-DE' },
    });
    expect(update.status).toBe(400);
    expect(Object.keys(update.body.error.fields)).toEqual(['locale']);

    const ok = await call('PATCH', `/api/v1/orgs/${org.id}`, {
      token,
      body: { updatedAt: org.updatedAt, locale: 'en-IN' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.locale).toBe('en-IN');
  });

  it('checks auth before validating the body', async () => {
    const res = await call('POST', '/api/v1/orgs', { body: {} });
    expect(res.status).toBe(401);
  });

  it('rejects a slug that is already taken', async () => {
    const { token } = await newUser();
    const slug = `taken-${crypto.randomUUID().slice(0, 6)}`;
    expect(
      (await call('POST', '/api/v1/orgs', { token, body: { ...sampleOrg(), slug } })).status,
    ).toBe(201);
    const dup = await call('POST', '/api/v1/orgs', { token, body: { ...sampleOrg(), slug } });
    expect(dup.status).toBe(409);
  });

  it('updates settings and records it in the audit log', async () => {
    const { token } = await newUser();
    const org = await newOrg(token);

    const res = await call('PATCH', `/api/v1/orgs/${org.id}`, {
      token,
      body: { updatedAt: org.updatedAt, taxNumber: 'GST 123-456-789', brandColor: '#336699' },
    });
    expect(res.status).toBe(200);
    expect(res.body.taxNumber).toBe('GST 123-456-789');

    const audit = await call('GET', `/api/v1/orgs/${org.id}/audit-log`, { token });
    expect(audit.status).toBe(200);
    expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual([
      'org.updated',
      'org.created',
    ]);
  });

  it('returns 409 when updatedAt is stale', async () => {
    const { token } = await newUser();
    const org = await newOrg(token);
    await call('PATCH', `/api/v1/orgs/${org.id}`, {
      token,
      body: { updatedAt: org.updatedAt, name: 'First edit' },
    });
    const stale = await call('PATCH', `/api/v1/orgs/${org.id}`, {
      token,
      body: { updatedAt: org.updatedAt, name: 'Second edit' },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });

  it('pages the audit log with a cursor', async () => {
    const { token } = await newUser();
    const org = await newOrg(token);
    let updatedAt = org.updatedAt;
    for (const name of ['One', 'Two', 'Three']) {
      const res = await call('PATCH', `/api/v1/orgs/${org.id}`, {
        token,
        body: { updatedAt, name },
      });
      updatedAt = res.body.updatedAt;
    }

    const first = await call('GET', `/api/v1/orgs/${org.id}/audit-log?limit=3`, { token });
    expect(first.body.data).toHaveLength(3);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await call(
      'GET',
      `/api/v1/orgs/${org.id}/audit-log?limit=3&cursor=${first.body.nextCursor}`,
      { token },
    );
    expect(second.body.data.map((e: { action: string }) => e.action)).toEqual(['org.created']);
    expect(second.body.nextCursor).toBeNull();
  });

  it.each(['0', '201', 'abc'])('rejects audit log limit=%s with a field error', async (limit) => {
    const { token } = await newUser();
    const org = await newOrg(token);

    const res = await call('GET', `/api/v1/orgs/${org.id}/audit-log?limit=${limit}`, { token });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.fields)).toEqual(['limit']);
  });
});

describe('org isolation', () => {
  it('returns the same 404 for another org as for an org that does not exist', async () => {
    const alice = await newUser('alice');
    const bob = await newUser('bob');
    const alicesOrg = await newOrg(alice.token, 'Alice Academy');

    const otherOrg = await call('GET', `/api/v1/orgs/${alicesOrg.id}`, { token: bob.token });
    const missing = await call('GET', '/api/v1/orgs/org_doesnotexist', { token: bob.token });

    expect(otherOrg.status).toBe(404);
    expect(otherOrg.body).toEqual(missing.body);
  });

  it("can't change or read another org's data through any route", async () => {
    const alice = await newUser('alice');
    const bob = await newUser('bob');
    const org = await newOrg(alice.token);

    const patch = await call('PATCH', `/api/v1/orgs/${org.id}`, {
      token: bob.token,
      body: { updatedAt: org.updatedAt, name: 'Hijacked' },
    });
    const audit = await call('GET', `/api/v1/orgs/${org.id}/audit-log`, { token: bob.token });
    const job = await call('GET', `/api/v1/orgs/${org.id}/jobs/job_x`, { token: bob.token });

    expect([patch.status, audit.status, job.status]).toEqual([404, 404, 404]);
    const after = await call('GET', `/api/v1/orgs/${org.id}`, { token: alice.token });
    expect(after.body.name).toBe('Bright Minds Tuition');
  });
});

describe('permissions', () => {
  it('lets a teacher read the org but not change it', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const teacher = await newUser('teacher');
    const teacherToken = await addMember(org.id, teacher.clerkUserId, 'teacher');

    expect((await call('GET', `/api/v1/orgs/${org.id}`, { token: teacherToken })).status).toBe(200);

    const patch = await call('PATCH', `/api/v1/orgs/${org.id}`, {
      token: teacherToken,
      body: { updatedAt: org.updatedAt, name: 'Nope' },
    });
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe('forbidden');
  });

  it.each(['branch_manager', 'front_desk', 'teacher', 'parent', 'accountant'] as const)(
    'keeps the audit log owner-only: %s gets 403',
    async (role) => {
      const owner = await newUser('owner');
      const org = await newOrg(owner.token);
      const member = await newUser(role);
      const token = await addMember(org.id, member.clerkUserId, role);

      const res = await call('GET', `/api/v1/orgs/${org.id}/audit-log`, { token });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    },
  );
});
