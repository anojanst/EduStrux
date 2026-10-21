import { invitations, memberships } from '@edustrux/db';
import { newId, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// Staff and invitations (D-131): invite by email, accept with the token, change role, branches
// and status, remove. A guardian's invite signs a parent in to their family (D-053).

type Row = { id: string; updatedAt: string };
type Member = Row & {
  userId: string;
  name: string | null;
  email: string | null;
  role: Role;
  branchIds: string[] | null;
  status: 'active' | 'suspended';
};
type Created = {
  invitation: {
    id: string;
    email: string;
    role: Role;
    branchIds: string[] | null;
    guardianId: string | null;
    expiresAt: string;
  };
  token: string;
};
type Audit = {
  action: string;
  entityType: string;
  entityId: string;
  actorUserId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

/**
 * An owner with a fresh org and two branches, Main and Albany, a class at Main, and the Perera
 * family of Main with Mere, a guardian with an email.
 */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const as =
    (token: string): As =>
    (method, path, body) =>
      call(method, `${base}${path}`, { token, body });
  const api = as(owner.token);
  const make = async <T = Row>(path: string, body: unknown, by: As = api) => {
    const res = await by('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };
  /** A member written straight to the database, optionally limited to some branches. */
  const member = async (role: Role, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds });
    return { id, userId: user.userId, token: user.token, as: as(user.token) };
  };
  const accept = (token: string, invite: string) =>
    call('POST', `/api/v1/invitations/${invite}/accept`, { token });
  const staff = async (by: As = api) => (await by('GET', '/staff')).body.data as Member[];
  const lastAudit = async () => ((await api('GET', '/audit-log?limit=1')).body.data as Audit[])[0]!;

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const albany = await make('/branches', { name: 'Albany' });
  const family = await make('/families', { name: 'Perera', branchId: main.id });
  const mere = await make<Row & { email: string; membershipId: string | null }>(
    `/families/${family.id}/guardians`,
    { firstName: 'Mere', lastName: 'Perera', email: 'Mere@Example.com' },
  );

  return {
    owner,
    org,
    base,
    as,
    api,
    make,
    member,
    accept,
    staff,
    lastAudit,
    main,
    albany,
    family,
    mere,
  };
}

/** Another org, with its own owner and a teacher, for ids that aren't the first org's. */
async function otherOrg() {
  const owner = await newUser('owner_b');
  const org = await newOrg(owner.token, 'Other Centre');
  const teacher = newId('membership');
  const user = await newUser('teacher_b');
  await db()
    .insert(memberships)
    .values({ id: teacher, orgId: org.id, userId: user.userId, role: 'teacher' });
  return { owner, org, teacher };
}

describe('GET /staff', () => {
  it('lists every member but parents, with their name and email', async () => {
    const t = await setup();
    const teacher = await t.member('teacher');
    await t.member('parent');
    const res = await t.api('GET', '/staff');
    expect(res.status).toBe(200);
    expect(res.db.stages).toBeLessThanOrEqual(2);
    const list = res.body.data as Member[];
    expect(list.map((m) => m.role)).toEqual(['owner', 'teacher']);
    expect(list[1]).toMatchObject({
      id: teacher.id,
      userId: teacher.userId,
      email: 'teacher@example.com',
      branchIds: null,
      status: 'active',
    });
    expect(list[0]).not.toHaveProperty('orgId');
  });

  it('pages by id', async () => {
    const t = await setup();
    await t.member('teacher');
    await t.member('front_desk');
    const first = await t.api('GET', '/staff?limit=2');
    expect(first.body.data).toHaveLength(2);
    const second = await t.api('GET', `/staff?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it('shows a branch manager only the staff whose branches are all theirs', async () => {
    const t = await setup();
    const manager = await t.member('branch_manager', [t.main.id]);
    const mainTeacher = await t.member('teacher', [t.main.id]);
    const mainDesk = await t.member('front_desk', [t.main.id]);
    await t.member('teacher'); // every branch
    await t.member('front_desk', [t.albany.id]);
    await t.member('front_desk', [t.main.id, t.albany.id]);
    await t.member('accountant');
    const seen = (await t.staff(manager.as)).map((m) => m.id);
    expect(seen).toEqual([manager.id, mainTeacher.id, mainDesk.id]);

    // With no branch list they reach those roles in every branch, still no owner or accountant.
    const everywhere = await t.member('branch_manager');
    const roles = (await t.staff(everywhere.as)).map((m) => m.role);
    expect(roles).not.toContain('owner');
    expect(roles).not.toContain('accountant');
    expect(roles).toHaveLength(7);
  });

  it('is 403 for front desk, teachers, parents and accountants', async () => {
    const t = await setup();
    for (const role of ['front_desk', 'teacher', 'parent', 'accountant'] as const) {
      const m = await t.member(role);
      expect((await m.as('GET', '/staff')).status).toBe(403);
    }
  });

  it("is 404 for an org you aren't in", async () => {
    const t = await setup();
    const b = await otherOrg();
    expect(
      (await call('GET', `/api/v1/orgs/${b.org.id}/staff`, { token: t.owner.token })).status,
    ).toBe(404);
  });
});

describe('POST /staff/invitations', () => {
  it('invites by email, keeps only the token’s hash, and audits without it', async () => {
    const t = await setup();
    const res = await t.api('POST', '/staff/invitations', {
      email: 'New.Teacher@Example.com',
      role: 'teacher',
      branchIds: [t.main.id],
    });
    expect(res.status).toBe(201);
    expect(res.db.stages).toBeLessThanOrEqual(3);
    const { invitation, token } = res.body as Created;
    expect(invitation).toMatchObject({
      email: 'new.teacher@example.com',
      role: 'teacher',
      branchIds: [t.main.id],
      guardianId: null,
    });
    expect(token.length).toBeGreaterThanOrEqual(40);
    const days = (Date.parse(invitation.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    const stored = await db().query.invitations.findFirst({
      where: (i, { eq }) => eq(i.id, invitation.id),
    });
    expect(stored!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.tokenHash).not.toContain(token);

    const audit = await t.lastAudit();
    expect(audit).toMatchObject({
      action: 'invitation.created',
      entityId: invitation.id,
      actorUserId: t.owner.userId,
    });
    expect(audit.after).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('gives owners and accountants no branch list', async () => {
    const t = await setup();
    const bad = await t.api('POST', '/staff/invitations', {
      email: 'acc@example.com',
      role: 'accountant',
      branchIds: [t.main.id],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields).toHaveProperty('branchIds');
    const ok = await t.make<Created>('/staff/invitations', {
      email: 'acc@example.com',
      role: 'accountant',
    });
    expect(ok.invitation.branchIds).toBeNull();
  });

  it('validates the body (400)', async () => {
    const t = await setup();
    for (const body of [
      { email: 'not-an-email', role: 'teacher' },
      { email: 'p@example.com', role: 'parent' },
      { email: 'x@example.com', role: 'admin' },
      { role: 'teacher' },
    ]) {
      const res = await t.api('POST', '/staff/invitations', body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
  });

  it('refuses an unknown branch (422) and someone already a member (409)', async () => {
    const t = await setup();
    const unknown = await t.api('POST', '/staff/invitations', {
      email: 'x@example.com',
      role: 'teacher',
      branchIds: ['brn_nope'],
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.fields).toEqual({ branchIds: ['Unknown branch'] });

    await t.member('teacher'); // signs in as teacher@example.com
    const member = await t.api('POST', '/staff/invitations', {
      email: 'TEACHER@example.com',
      role: 'front_desk',
    });
    expect(member.status).toBe(409);
    expect(member.body.error.fields).toEqual({ email: ['Already a member'] });
  });

  it('withdraws the pending invite when the same email is invited again', async () => {
    const t = await setup();
    const first = await t.make<Created>('/staff/invitations', {
      email: 'x@example.com',
      role: 'teacher',
    });
    await t.make<Created>('/staff/invitations', { email: 'x@example.com', role: 'front_desk' });
    const person = await newUser('x');
    expect((await t.accept(person.token, first.token)).status).toBe(404);
  });

  it('keeps a branch manager to their own branches and to roles that don’t reach the org', async () => {
    const t = await setup();
    const manager = await t.member('branch_manager', [t.main.id]);
    const invite = (body: object) =>
      manager.as('POST', '/staff/invitations', { email: 'x@example.com', ...body });
    expect((await invite({ role: 'owner' })).status).toBe(403);
    expect((await invite({ role: 'accountant' })).status).toBe(403);
    expect((await invite({ role: 'teacher' })).status).toBe(403); // no list = every branch
    expect((await invite({ role: 'teacher', branchIds: [t.albany.id] })).status).toBe(403);
    expect((await invite({ role: 'teacher', branchIds: [t.main.id, t.albany.id] })).status).toBe(
      403,
    );
    const ok = await invite({ role: 'front_desk', branchIds: [t.main.id] });
    expect(ok.status).toBe(201);
  });

  it('is 403 for front desk, teachers, parents and accountants', async () => {
    const t = await setup();
    for (const role of ['front_desk', 'teacher', 'parent', 'accountant'] as const) {
      const m = await t.member(role);
      const res = await m.as('POST', '/staff/invitations', {
        email: 'x@example.com',
        role: 'teacher',
      });
      expect(res.status).toBe(403);
    }
  });

  it("is 404 for an org you aren't in, and for another org's branch ids 422", async () => {
    const t = await setup();
    const b = await otherOrg();
    const res = await call('POST', `/api/v1/orgs/${b.org.id}/staff/invitations`, {
      token: t.owner.token,
      body: { email: 'x@example.com', role: 'teacher' },
    });
    expect(res.status).toBe(404);
    const theirBranch = (
      await call('GET', `/api/v1/orgs/${b.org.id}/branches`, { token: b.owner.token })
    ).body.data[0].id;
    const cross = await t.api('POST', '/staff/invitations', {
      email: 'x@example.com',
      role: 'teacher',
      branchIds: [theirBranch],
    });
    expect(cross.status).toBe(422);
  });
});

describe('POST /api/v1/invitations/{token}/accept', () => {
  it('joins the org with the invite’s role and branches', async () => {
    const t = await setup();
    const { invitation, token } = await t.make<Created>('/staff/invitations', {
      email: 'desk@example.com',
      role: 'front_desk',
      branchIds: [t.main.id],
    });
    const person = await newUser('desk');
    const res = await t.accept(person.token, token);
    expect(res.status).toBe(200);
    expect(res.db.stages).toBeLessThanOrEqual(4);
    expect(res.body).toMatchObject({
      role: 'front_desk',
      branchIds: [t.main.id],
      org: { id: t.org.id, name: 'Bright Minds Tuition', slug: t.org.slug },
    });
    const membershipId = res.body.id as string;

    const me = await call('GET', '/api/v1/me', { token: person.token });
    expect(me.body.memberships.map((m: { id: string }) => m.id)).toEqual([membershipId]);
    expect((await t.as(person.token)('GET', '/families')).status).toBe(200);
    expect((await t.staff()).map((m) => m.id)).toContain(membershipId);

    const audit = await t.lastAudit();
    expect(audit).toMatchObject({
      action: 'invitation.accepted',
      entityType: 'invitation',
      entityId: invitation.id,
      actorUserId: person.userId,
      after: { membershipId, joined: 'insert', role: 'front_desk', branchIds: [t.main.id] },
    });

    const again = await t.accept((await newUser('other')).token, token);
    expect(again.status).toBe(422);
    expect(again.body.error.fields).toEqual({ token: ['Used'] });
  });

  it('refuses an unknown token (404), an expired one (422) and no sign-in (401)', async () => {
    const t = await setup();
    const person = await newUser('x');
    expect((await t.accept(person.token, 'nope')).status).toBe(404);

    const { invitation, token } = await t.make<Created>('/staff/invitations', {
      email: 'x@example.com',
      role: 'teacher',
    });
    expect((await call('POST', `/api/v1/invitations/${token}/accept`)).status).toBe(401);
    await db()
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(invitations.id, invitation.id));
    const expired = await t.accept(person.token, token);
    expect(expired.status).toBe(422);
    expect(expired.body.error.fields).toEqual({ token: ['Expired'] });
  });

  it('is 409 for someone already a member', async () => {
    const t = await setup();
    const { token } = await t.make<Created>('/staff/invitations', {
      email: 'other@example.com',
      role: 'teacher',
    });
    const res = await t.accept(t.owner.token, token);
    expect(res.status).toBe(409);
  });

  it('brings back a removed member’s membership', async () => {
    const t = await setup();
    const teacher = await t.member('teacher');
    expect((await t.api('DELETE', `/staff/${teacher.id}`)).status).toBe(204);
    const { token } = await t.make<Created>('/staff/invitations', {
      email: 'again@example.com',
      role: 'front_desk',
      branchIds: [t.albany.id],
    });
    const res = await t.accept(teacher.token, token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: teacher.id,
      role: 'front_desk',
      branchIds: [t.albany.id],
    });
    expect((await t.lastAudit()).after).toMatchObject({ joined: 'restore' });
    expect((await teacher.as('GET', '/families')).status).toBe(200);
  });
});

describe('POST /guardians/{guardianId}/invitation', () => {
  it('signs a parent in to the guardian’s family', async () => {
    const t = await setup();
    const res = await t.api('POST', `/guardians/${t.mere.id}/invitation`, {});
    expect(res.status).toBe(201);
    const { invitation, token } = res.body as Created;
    expect(invitation).toMatchObject({
      email: 'mere@example.com',
      role: 'parent',
      branchIds: null,
      guardianId: t.mere.id,
    });
    expect((await t.lastAudit()).action).toBe('invitation.created');

    const parent = await newUser('mere');
    const accepted = await t.accept(parent.token, token);
    expect(accepted.status).toBe(200);
    expect(accepted.body.role).toBe('parent');
    const families = (await t.as(parent.token)('GET', '/families')).body.data as Row[];
    expect(families.map((f) => f.id)).toEqual([t.family.id]);
    const guardian = (await t.api('GET', `/families/${t.family.id}`)).body.guardians[0];
    expect(guardian.membershipId).toBe(accepted.body.id);
    // Parents aren't listed as staff.
    expect((await t.staff()).map((m) => m.role)).toEqual(['owner']);

    const linked = await t.api('POST', `/guardians/${t.mere.id}/invitation`, {});
    expect(linked.status).toBe(409);
  });

  it('adds a second family to a parent who already signs in', async () => {
    const t = await setup();
    const parent = await newUser('mere');
    await t.accept(
      parent.token,
      (await t.make<Created>(`/guardians/${t.mere.id}/invitation`, {})).token,
    );

    const other = await t.make('/families', { name: 'Silva', branchId: t.albany.id });
    const ana = await t.make(`/families/${other.id}/guardians`, {
      firstName: 'Ana',
      lastName: 'Silva',
    });
    const { token } = await t.make<Created>(`/guardians/${ana.id}/invitation`, {
      email: 'mere@example.com',
    });
    const res = await t.accept(parent.token, token);
    expect(res.status).toBe(200);
    expect((await t.lastAudit()).after).toMatchObject({ joined: 'existing' });
    const families = (await t.as(parent.token)('GET', '/families')).body.data as Row[];
    expect(families.map((f) => f.id).sort()).toEqual([t.family.id, other.id].sort());
  });

  it('refuses staff (409) and a removed guardian (422) on accept', async () => {
    const t = await setup();
    const { token } = await t.make<Created>(`/guardians/${t.mere.id}/invitation`, {});
    expect((await t.accept(t.owner.token, token)).status).toBe(409);

    const ana = await t.make(`/families/${t.family.id}/guardians`, {
      firstName: 'Ana',
      lastName: 'Perera',
      email: 'ana@example.com',
    });
    const forAna = await t.make<Created>(`/guardians/${ana.id}/invitation`, {});
    expect((await t.api('DELETE', `/guardians/${ana.id}`)).status).toBe(204);
    const res = await t.accept((await newUser('ana')).token, forAna.token);
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toEqual({ token: ['Guardian removed'] });
  });

  it('needs an email when the guardian has none (422), and a valid one (400)', async () => {
    const t = await setup();
    const ana = await t.make(`/families/${t.family.id}/guardians`, {
      firstName: 'Ana',
      lastName: 'Perera',
    });
    const none = await t.api('POST', `/guardians/${ana.id}/invitation`, {});
    expect(none.status).toBe(422);
    expect(none.body.error.fields).toEqual({ email: ['Required'] });
    const bad = await t.api('POST', `/guardians/${ana.id}/invitation`, { email: 'nope' });
    expect(bad.status).toBe(400);
    const ok = await t.api('POST', `/guardians/${ana.id}/invitation`, { email: 'ana@example.com' });
    expect(ok.status).toBe(201);
  });

  it('lets front desk invite their branch’s guardians only, and refuses other roles', async () => {
    const t = await setup();
    const mainDesk = await t.member('front_desk', [t.main.id]);
    const albanyDesk = await t.member('front_desk', [t.albany.id]);
    expect((await mainDesk.as('POST', `/guardians/${t.mere.id}/invitation`, {})).status).toBe(201);
    expect((await albanyDesk.as('POST', `/guardians/${t.mere.id}/invitation`, {})).status).toBe(
      404,
    );
    for (const role of ['teacher', 'parent', 'accountant'] as const) {
      const m = await t.member(role);
      expect((await m.as('POST', `/guardians/${t.mere.id}/invitation`, {})).status).toBe(403);
    }
  });

  it("is 404 for another org's guardian", async () => {
    const t = await setup();
    const b = await otherOrg();
    const fam = await call('POST', `/api/v1/orgs/${b.org.id}/families`, {
      token: b.owner.token,
      body: {
        name: 'Other',
        branchId: (await call('GET', `/api/v1/orgs/${b.org.id}/branches`, { token: b.owner.token }))
          .body.data[0].id,
      },
    });
    const g = await call('POST', `/api/v1/orgs/${b.org.id}/families/${fam.body.id}/guardians`, {
      token: b.owner.token,
      body: { firstName: 'O', lastName: 'B', email: 'ob@example.com' },
    });
    expect((await t.api('POST', `/guardians/${g.body.id}/invitation`, {})).status).toBe(404);
  });
});

describe('PATCH /staff/{membershipId}', () => {
  it('changes role and branches, and audits only what changed', async () => {
    const t = await setup();
    const teacher = await t.member('teacher');
    const [before] = (await t.staff()).filter((m) => m.id === teacher.id);
    const res = await t.api('PATCH', `/staff/${teacher.id}`, {
      updatedAt: before!.updatedAt,
      role: 'front_desk',
      branchIds: [t.main.id, t.main.id],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      role: 'front_desk',
      branchIds: [t.main.id],
      status: 'active',
    });
    const audit = await t.lastAudit();
    expect(audit).toMatchObject({
      action: 'membership.updated',
      entityId: teacher.id,
      before: { role: 'teacher', branchIds: null },
      after: { role: 'front_desk', branchIds: [t.main.id] },
    });
    // The new role is what the member now gets.
    expect(
      (await teacher.as('POST', '/families', { name: 'X', branchId: t.albany.id })).status,
    ).toBe(403);

    const stale = await t.api('PATCH', `/staff/${teacher.id}`, {
      updatedAt: before!.updatedAt,
      status: 'suspended',
    });
    expect(stale.status).toBe(409);
  });

  it('clears the branch list when the role reaches the whole org', async () => {
    const t = await setup();
    const desk = await t.member('front_desk', [t.main.id]);
    const [before] = (await t.staff()).filter((m) => m.id === desk.id);
    const res = await t.api('PATCH', `/staff/${desk.id}`, {
      updatedAt: before!.updatedAt,
      role: 'accountant',
    });
    expect(res.body).toMatchObject({ role: 'accountant', branchIds: null });
  });

  it('suspends a member, who then loses access', async () => {
    const t = await setup();
    const teacher = await t.member('teacher');
    const [before] = (await t.staff()).filter((m) => m.id === teacher.id);
    const res = await t.api('PATCH', `/staff/${teacher.id}`, {
      updatedAt: before!.updatedAt,
      status: 'suspended',
    });
    expect(res.body.status).toBe('suspended');
    expect((await teacher.as('GET', '/classes')).status).toBe(404);
  });

  it('validates the body (400)', async () => {
    const t = await setup();
    const teacher = await t.member('teacher');
    for (const body of [
      { status: 'suspended' },
      { updatedAt: 'yesterday', status: 'suspended' },
      { updatedAt: new Date().toISOString(), role: 'parent' },
      { updatedAt: new Date().toISOString(), role: 'owner', branchIds: [t.main.id] },
      { updatedAt: new Date().toISOString(), status: 'gone' },
    ]) {
      expect((await t.api('PATCH', `/staff/${teacher.id}`, body)).status).toBe(400);
    }
  });

  it('refuses your own membership, a parent’s role, and an unknown branch (422)', async () => {
    const t = await setup();
    const me = (await t.staff())[0]!;
    const self = await t.api('PATCH', `/staff/${me.id}`, {
      updatedAt: me.updatedAt,
      role: 'teacher',
    });
    expect(self.status).toBe(422);

    const parent = await t.member('parent');
    const row = await db().query.memberships.findFirst({
      where: (m, { eq }) => eq(m.id, parent.id),
    });
    const role = await t.api('PATCH', `/staff/${parent.id}`, {
      updatedAt: row!.updatedAt,
      role: 'teacher',
    });
    expect(role.status).toBe(422);
    const status = await t.api('PATCH', `/staff/${parent.id}`, {
      updatedAt: row!.updatedAt,
      status: 'suspended',
    });
    expect(status.status).toBe(200);

    const teacher = await t.member('teacher');
    const [before] = (await t.staff()).filter((m) => m.id === teacher.id);
    const unknown = await t.api('PATCH', `/staff/${teacher.id}`, {
      updatedAt: before!.updatedAt,
      branchIds: ['brn_nope'],
    });
    expect(unknown.status).toBe(422);
  });

  it('keeps a branch manager to their reach (404) and grants (403)', async () => {
    const t = await setup();
    const manager = await t.member('branch_manager', [t.main.id]);
    const mine = await t.member('teacher', [t.main.id]);
    const theirs = await t.member('teacher', [t.albany.id]);
    const owner = (await t.staff())[0]!;
    const [before] = (await t.staff(manager.as)).filter((m) => m.id === mine.id);
    const patch = (id: string, body: object) =>
      manager.as('PATCH', `/staff/${id}`, { updatedAt: before!.updatedAt, ...body });

    expect((await patch(theirs.id, { status: 'suspended' })).status).toBe(404);
    expect((await patch(owner.id, { status: 'suspended' })).status).toBe(404);
    expect((await patch(mine.id, { role: 'owner' })).status).toBe(403);
    expect((await patch(mine.id, { branchIds: [t.albany.id] })).status).toBe(403);
    expect((await patch(mine.id, { branchIds: null })).status).toBe(403);
    const ok = await patch(mine.id, { role: 'front_desk' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ role: 'front_desk', branchIds: [t.main.id] });
  });

  it('is 403 for front desk, teachers, parents and accountants', async () => {
    const t = await setup();
    const target = await t.member('teacher');
    for (const role of ['front_desk', 'teacher', 'parent', 'accountant'] as const) {
      const m = await t.member(role);
      const res = await m.as('PATCH', `/staff/${target.id}`, {
        updatedAt: new Date().toISOString(),
        status: 'suspended',
      });
      expect(res.status).toBe(403);
    }
  });

  it("is 404 for another org's member", async () => {
    const t = await setup();
    const b = await otherOrg();
    const res = await t.api('PATCH', `/staff/${b.teacher}`, {
      updatedAt: new Date().toISOString(),
      status: 'suspended',
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /staff/{membershipId}', () => {
  it('removes a member, who then loses access', async () => {
    const t = await setup();
    const teacher = await t.member('teacher');
    const res = await t.api('DELETE', `/staff/${teacher.id}`);
    expect(res.status).toBe(204);
    expect((await t.staff()).map((m) => m.id)).not.toContain(teacher.id);
    expect((await teacher.as('GET', '/classes')).status).toBe(404);
    expect(await t.lastAudit()).toMatchObject({
      action: 'membership.deleted',
      entityId: teacher.id,
      before: { role: 'teacher' },
    });
  });

  it('refuses a teacher of a class (422), who can still be suspended', async () => {
    const t = await setup();
    const teacher = await t.member('teacher');
    const subject = await t.make('/subjects', { name: 'Maths' });
    const grade = await t.make('/grade-levels', { name: 'Year 9' });
    const course = await t.make('/courses', { subjectId: subject.id, gradeLevelId: grade.id });
    await t.make('/classes', {
      courseId: course.id,
      branchId: t.main.id,
      name: 'A',
      startDate: '2026-01-05',
      teacherId: teacher.id,
    });
    const res = await t.api('DELETE', `/staff/${teacher.id}`);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('1 class');
  });

  it('unlinks a removed parent’s guardians', async () => {
    const t = await setup();
    const parent = await newUser('mere');
    const accepted = await t.accept(
      parent.token,
      (await t.make<Created>(`/guardians/${t.mere.id}/invitation`, {})).token,
    );
    expect((await t.api('DELETE', `/staff/${accepted.body.id}`)).status).toBe(204);
    const guardian = (await t.api('GET', `/families/${t.family.id}`)).body.guardians[0];
    expect(guardian.membershipId).toBeNull();
    // They can be invited again.
    expect((await t.api('POST', `/guardians/${t.mere.id}/invitation`, {})).status).toBe(201);
  });

  it('refuses your own membership (422)', async () => {
    const t = await setup();
    const me = (await t.staff())[0]!;
    expect((await t.api('DELETE', `/staff/${me.id}`)).status).toBe(422);
  });

  it('keeps a branch manager to their reach (404)', async () => {
    const t = await setup();
    const manager = await t.member('branch_manager', [t.main.id]);
    const theirs = await t.member('teacher', [t.albany.id]);
    const mine = await t.member('teacher', [t.main.id]);
    expect((await manager.as('DELETE', `/staff/${theirs.id}`)).status).toBe(404);
    expect((await manager.as('DELETE', `/staff/${mine.id}`)).status).toBe(204);
  });

  it('is 403 for front desk, teachers, parents and accountants, and 404 across orgs', async () => {
    const t = await setup();
    const target = await t.member('teacher');
    for (const role of ['front_desk', 'teacher', 'parent', 'accountant'] as const) {
      const m = await t.member(role);
      expect((await m.as('DELETE', `/staff/${target.id}`)).status).toBe(403);
    }
    const b = await otherOrg();
    expect((await t.api('DELETE', `/staff/${b.teacher}`)).status).toBe(404);
  });
});
