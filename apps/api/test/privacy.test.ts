import {
  absenceNotices,
  auditLog,
  enrolments,
  families,
  guardians,
  invitations,
  invoices,
  memberships,
  messageRecipients,
  studentConsents,
  students,
} from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// Privacy controls (TUI-79): consents per student, and erasing a family.

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;

type Row = { id: string; updatedAt: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async (path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as Row;
  };
  const member = async (role: Role) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds: null });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, as };
  };
  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const family = async (name: string) => {
    const f = await make('/families', { name, branchId: main.id });
    const g = await make(`/families/${f.id}/guardians`, {
      firstName: 'Mere',
      lastName: name,
      email: `mere.${name.toLowerCase()}@example.com`,
      phone: '021 555 0100',
    });
    const s = await make('/students', {
      familyId: f.id,
      firstName: 'Aroha',
      lastName: name,
    });
    return { family: f, guardian: g, student: s };
  };
  return { org, base, api, make, member, main, family };
}

describe('consents', () => {
  it('are none until recorded, then show who gave them, with the history audited', async () => {
    const { api, family } = await setup();
    const { student, guardian } = await family('Perera');
    const empty = await api('GET', `/students/${student.id}/consents`);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({
      studentId: student.id,
      consents: [
        expect.objectContaining({ type: 'photos', granted: null, guardianId: null }),
        expect.objectContaining({ type: 'medical_treatment', granted: null }),
      ],
    });
    const set = await api('PUT', `/students/${student.id}/consents/photos`, {
      granted: true,
      guardianId: guardian.id,
      note: 'Signed form',
    });
    expect(set.status).toBe(200);
    expect(set.body.consents[0]).toMatchObject({
      type: 'photos',
      granted: true,
      guardianId: guardian.id,
      note: 'Signed form',
      recordedByUserId: expect.stringMatching(/^usr_/),
    });
    const refused = await api('PUT', `/students/${student.id}/consents/photos`, { granted: false });
    expect(refused.body.consents[0]).toMatchObject({ granted: false, guardianId: null });
    const audit = (await api('GET', '/audit-log?limit=1')).body.data[0];
    expect(audit).toMatchObject({
      action: 'consent.recorded',
      entityId: student.id,
      before: { type: 'photos', granted: true },
      after: { type: 'photos', granted: false },
    });
  });

  it('refuse another family’s guardian, an unknown type, and roles that can’t write people', async () => {
    const { api, family, member } = await setup();
    const perera = await family('Perera');
    const ngata = await family('Ngata');
    const wrong = await api('PUT', `/students/${perera.student.id}/consents/photos`, {
      granted: true,
      guardianId: ngata.guardian.id,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields).toHaveProperty('guardianId');
    expect(
      (await api('PUT', `/students/${perera.student.id}/consents/swimming`, { granted: true }))
        .status,
    ).toBe(400);
    expect(
      (
        await (
          await member('teacher')
        ).as('PUT', `/students/${perera.student.id}/consents/photos`, {
          granted: true,
        })
      ).status,
    ).toBe(403);
    const stranger = await setup();
    expect((await stranger.api('GET', `/students/${perera.student.id}/consents`)).status).toBe(404);
  });

  it('are given by a parent for their own child through the portal', async () => {
    const { api, family, member } = await setup();
    const perera = await family('Perera');
    const ngata = await family('Ngata');
    const parent = await member('parent');
    await db()
      .update(guardians)
      .set({ membershipId: parent.id })
      .where(eq(guardians.id, perera.guardian.id));
    const given = await parent.as(
      'PUT',
      `/portal/students/${perera.student.id}/consents/medical_treatment`,
      { granted: true, guardianId: ngata.guardian.id },
    );
    expect(given.status).toBe(200);
    expect(given.body.consents[1]).toMatchObject({
      type: 'medical_treatment',
      granted: true,
      guardianId: perera.guardian.id,
    });
    expect(
      (await parent.as('GET', `/students/${perera.student.id}/consents`)).body.consents[1].granted,
    ).toBe(true);
    expect(
      (
        await parent.as('PUT', `/portal/students/${ngata.student.id}/consents/photos`, {
          granted: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (await parent.as('PUT', `/students/${perera.student.id}/consents/photos`, { granted: true }))
        .status,
    ).toBe(403);
    expect(
      (await api('PUT', `/portal/students/${perera.student.id}/consents/photos`, { granted: true }))
        .status,
    ).toBe(403);
  });
});

describe('POST /families/{id}/erase', () => {
  it('clears the family’s people everywhere, keeps the ids, and is owner only', async () => {
    const { org, api, family, member } = await setup();
    const { family: f, guardian, student } = await family('Perera');
    const other = await family('Ngata');
    await api('PUT', `/students/${student.id}/consents/photos`, {
      granted: true,
      guardianId: guardian.id,
    });
    await api('POST', '/absence-notices', {
      studentId: student.id,
      startDate: today(),
      reason: 'sick',
    });
    expect((await api('POST', `/guardians/${guardian.id}/invitation`, {})).status).toBe(201);
    const sent = await api('POST', '/messages', {
      subject: 'Hello',
      body: 'Term starts Monday.',
      audience: { type: 'all' },
      channels: ['email'],
    });
    expect(sent.status).toBe(201);

    expect((await (await member('front_desk')).as('POST', `/families/${f.id}/erase`)).status).toBe(
      403,
    );
    const erased = await api('POST', `/families/${f.id}/erase`);
    expect(erased.status).toBe(200);
    expect(erased.body).toEqual({
      familyId: f.id,
      erasedAt: expect.any(String),
      guardians: 1,
      students: 1,
    });

    const one = <T>(rows: T[]) => rows[0]!;
    const fam = one(await db().select().from(families).where(eq(families.id, f.id)));
    expect(fam).toMatchObject({
      name: 'Erased family',
      erasedAt: erased.body.erasedAt,
    });
    expect(fam.deletedAt).not.toBeNull();
    expect(fam.bankReference).not.toBeNull();
    expect(
      one(await db().select().from(guardians).where(eq(guardians.id, guardian.id))),
    ).toMatchObject({
      firstName: 'Erased',
      email: null,
      phone: null,
      phoneNorm: null,
      membershipId: null,
    });
    expect(
      one(await db().select().from(students).where(eq(students.id, student.id))),
    ).toMatchObject({ firstName: 'Erased', lastName: 'student' });
    expect(
      await db().select().from(studentConsents).where(eq(studentConsents.studentId, student.id)),
    ).toEqual([]);
    expect(
      one(await db().select().from(absenceNotices).where(eq(absenceNotices.studentId, student.id)))
        .reason,
    ).toBeNull();
    expect(
      await db().select().from(invitations).where(eq(invitations.guardianId, guardian.id)),
    ).toEqual([]);
    const recipients = await db()
      .select()
      .from(messageRecipients)
      .where(eq(messageRecipients.messageId, sent.body.id));
    expect(recipients.find((r) => r.guardianId === guardian.id)!.email).toBeNull();
    expect(recipients.find((r) => r.guardianId === other.guardian.id)!.email).toBe(
      'mere.ngata@example.com',
    );
    // The audit log no longer holds their details, but still says what happened.
    const created = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.orgId, org.id), eq(auditLog.entityId, guardian.id)));
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((row) => row.before === null && row.after === null)).toBe(true);
    const last = (await api('GET', '/audit-log?limit=1')).body.data[0];
    expect(last).toMatchObject({
      action: 'family.erased',
      entityId: f.id,
      after: { guardians: 1, students: 1 },
    });

    expect((await api('GET', `/families/${f.id}`)).status).toBe(404);
    expect((await api('GET', `/families/${other.family.id}`)).body.name).toBe('Ngata');
    const again = await api('POST', `/families/${f.id}/erase`);
    expect(again.body.erasedAt).toBe(erased.body.erasedAt);
    const stranger = await setup();
    expect((await stranger.api('POST', `/families/${other.family.id}/erase`)).status).toBe(404);
  });

  it('refuses a family that still owes money or has students enrolled', async () => {
    const { org, api, make, main, family } = await setup();
    const { family: f, student } = await family('Perera');
    const invoiceId = newId('invoice');
    await db()
      .insert(invoices)
      .values({
        id: invoiceId,
        orgId: org.id,
        familyId: f.id,
        status: 'issued',
        periodStart: addDays(today(), -30),
        periodEnd: today(),
        currency: 'NZD',
        subtotalAmount: 10000,
        taxAmount: 0,
        totalAmount: 10000,
        paidAmount: 2500,
      });
    const owing = await api('POST', `/families/${f.id}/erase`);
    expect(owing.status).toBe(422);
    expect(owing.body.error.fields).toEqual({ familyId: ['Unpaid invoices'] });
    await db()
      .update(invoices)
      .set({ status: 'paid', paidAmount: 10000 })
      .where(eq(invoices.id, invoiceId));

    const subject = await make('/subjects', { name: 'Mathematics' });
    const grade = await make('/grade-levels', { name: 'Year 10' });
    const course = await make('/courses', { subjectId: subject.id, gradeLevelId: grade.id });
    const klass = await make('/classes', {
      courseId: course.id,
      branchId: main.id,
      name: 'Maths',
      startDate: addDays(today(), -30),
    });
    const enrolled = await make('/enrolments', { studentId: student.id, classId: klass.id });
    const running = await api('POST', `/families/${f.id}/erase`);
    expect(running.status).toBe(422);
    expect(running.body.error.fields).toEqual({ familyId: ['Enrolments running'] });

    // Once the enrolment has ended, it can go.
    await db()
      .update(enrolments)
      .set({ endDate: addDays(today(), -1) })
      .where(eq(enrolments.id, enrolled.id));
    expect((await api('POST', `/families/${f.id}/erase`)).status).toBe(200);
  });
});
