import { memberships } from '@edustrux/db';
import { newId, type Role } from '@edustrux/shared';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// The full data export (TUI-78).

type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const member = async (role: Role) => {
    const user = await newUser(role);
    await db()
      .insert(memberships)
      .values({
        id: newId('membership'),
        orgId: org.id,
        userId: user.userId,
        role,
        branchIds: null,
      });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { as };
  };
  const main = (await api('GET', '/branches')).body.data[0];
  const family = (await api('POST', '/families', { name: 'Perera', branchId: main.id })).body;
  await api('POST', '/students', { familyId: family.id, firstName: 'Aroha', lastName: 'Perera' });
  return { org, base, api, member };
}

describe('data export', () => {
  it('exports every table as one JSON file for the owner', async () => {
    const { api, org } = await setup();
    const started = await api('POST', '/exports');
    expect(started.status).toBe(202);
    expect(started.body).toEqual({
      id: expect.stringMatching(/^exp_/),
      jobId: expect.stringMatching(/^job_/),
    });
    for (let i = 0; i < 400; i++) {
      const job = (await api('GET', `/jobs/${started.body.jobId}`)).body;
      if (job.status === 'succeeded') break;
      if (job.status === 'failed') throw new Error(job.error);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const done = await api('GET', `/exports/${started.body.id}`);
    expect(done.body).toMatchObject({
      status: 'done',
      counts: { families: 1, students: 1, branches: 1, memberships: 1, users: 1 },
      downloadUrl: expect.stringContaining('/content?expires='),
    });
    const res = await exports.default.fetch(new Request(done.body.downloadUrl));
    const document = (await res.json()) as {
      format: string;
      org: { id: string };
      tables: Record<string, Record<string, unknown>[]>;
    };
    expect(document.format).toBe('edustrux-export');
    expect(document.org.id).toBe(org.id);
    expect(document.tables.families![0]).toMatchObject({ name: 'Perera' });
    expect(document.tables.families![0]).not.toHaveProperty('org_id');
    expect(document.tables.students![0]).not.toHaveProperty('first_name_norm');
    expect(document.tables.audit_log!.length).toBeGreaterThan(0);
  });

  it('is for the owner alone', async () => {
    const { member, api } = await setup();
    for (const role of ['branch_manager', 'accountant'] as const) {
      expect((await (await member(role)).as('POST', '/exports')).status).toBe(403);
    }
    const other = await setup();
    const theirs = (await other.api('POST', '/exports')).body;
    expect((await api('GET', `/exports/${theirs.id}`)).status).toBe(404);
  });
});
