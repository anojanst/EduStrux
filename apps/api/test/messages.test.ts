import { guardians, memberships, messageRecipients, messages } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { deliverEmail, EMAIL_MAX_RETRIES } from '../src/background/email';
import { call, db, newOrg, newUser } from './helpers';

// Announcements, templates, notification settings, the portal's messages (TUI-69, TUI-70) and
// sending their emails through Resend (TUI-65).

const TZ = 'Pacific/Auckland';
const firstDay = () => addDays(localNow(TZ).date, -30);

type Row = { id: string; updatedAt: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;
type Recipient = {
  familyId: string;
  guardianId: string;
  email: string | null;
  emailStatus: string | null;
};

/**
 * Two branches and a teacher.
 * - Main: the Perera family, Mere (with an email) and Tom (none); Aroha is in Year 10 this year
 *   and in Maths, which `teacher` teaches.
 * - Albany: the Ngata family, Ana (with an email); Ari is in English.
 */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async <T = Row>(path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };
  const member = async (role: Role, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, as };
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const albany = await make('/branches', { name: 'Albany' });
  await make('/academic-years', {
    name: 'This year',
    startDate: addDays(localNow(TZ).date, -100),
    endDate: addDays(localNow(TZ).date, 200),
  });
  const year10 = await make('/grade-levels', { name: 'Year 10' });
  const maths = await make('/subjects', { name: 'Mathematics' });
  const english = await make('/subjects', { name: 'English' });
  const mathsCourse = await make('/courses', { subjectId: maths.id, gradeLevelId: year10.id });
  const englishCourse = await make('/courses', { subjectId: english.id, gradeLevelId: year10.id });
  const teacher = await member('teacher');
  const mathsClass = await make('/classes', {
    courseId: mathsCourse.id,
    branchId: main.id,
    name: 'Maths',
    startDate: firstDay(),
    teacherId: teacher.id,
  });
  const englishClass = await make('/classes', {
    courseId: englishCourse.id,
    branchId: albany.id,
    name: 'English',
    startDate: firstDay(),
  });

  const perera = await make('/families', { name: 'Perera', branchId: main.id });
  const mere = await make(`/families/${perera.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
    email: 'mere@example.com',
  });
  const tom = await make(`/families/${perera.id}/guardians`, {
    firstName: 'Tom',
    lastName: 'Perera',
  });
  const aroha = await make('/students', {
    familyId: perera.id,
    firstName: 'Aroha',
    lastName: 'Perera',
    gradeLevelId: year10.id,
  });
  const ngata = await make('/families', { name: 'Ngata', branchId: albany.id });
  const ana = await make(`/families/${ngata.id}/guardians`, {
    firstName: 'Ana',
    lastName: 'Ngata',
    email: 'ana@example.com',
  });
  const ari = await make('/students', { familyId: ngata.id, firstName: 'Ari', lastName: 'Ngata' });
  await make('/enrolments', { studentId: aroha.id, classId: mathsClass.id, startDate: firstDay() });
  await make('/enrolments', { studentId: ari.id, classId: englishClass.id, startDate: firstDay() });

  const send = (body: Record<string, unknown>, as: As = api) =>
    as('POST', '/messages', { subject: 'Hello', body: 'Term starts Monday.', ...body });
  const recipientsOf = async (id: string) =>
    (await api('GET', `/messages/${id}`)).body.recipients as Recipient[];
  const familiesOf = async (id: string) =>
    [...new Set((await recipientsOf(id)).map((r) => r.familyId))].sort();

  return {
    org,
    base,
    api,
    make,
    member,
    main,
    albany,
    year10,
    maths,
    english,
    teacher,
    mathsClass,
    englishClass,
    perera,
    mere,
    tom,
    aroha,
    ngata,
    ana,
    ari,
    send,
    recipientsOf,
    familiesOf,
  };
}

describe('POST /messages', () => {
  it('sends to every family, a recipient per guardian, with an audit row', async () => {
    const { api, send, perera, ngata, mere, tom, ana } = await setup();
    const res = await send({ audience: { type: 'all' } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^msg_/),
      kind: 'announcement',
      event: null,
      subject: 'Hello',
      body: 'Term starts Monday.',
      audience: { type: 'all', ids: [] },
      channels: ['email', 'portal'],
      templateId: null,
      sentByMembershipId: expect.stringMatching(/^mem_/),
      recipientCount: 3,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const detail = await api('GET', `/messages/${res.body.id}`);
    expect(detail.status).toBe(200);
    const byGuardian = Object.fromEntries(
      (detail.body.recipients as Recipient[]).map((r) => [r.guardianId, r]),
    );
    expect(byGuardian[mere.id]).toMatchObject({ familyId: perera.id, email: 'mere@example.com' });
    // Tom has no email address, so nothing is emailed to him.
    expect(byGuardian[tom.id]).toMatchObject({ email: null, emailStatus: 'skipped' });
    expect(byGuardian[ana.id]).toMatchObject({ familyId: ngata.id });
    // With no Resend key in tests, the queued emails can't be sent and fail; either way they
    // started queued.
    expect(['queued', 'failed']).toContain(byGuardian[mere.id]!.emailStatus);
    expect(detail.body.delivery.skipped).toBe(1);

    const audit = (await api('GET', '/audit-log?limit=1')).body.data[0];
    expect(audit).toMatchObject({
      action: 'message.sent',
      entityId: res.body.id,
      after: { kind: 'announcement', recipients: 3, subject: 'Hello' },
    });
  });

  it('reaches the families each audience names', async () => {
    const {
      send,
      familiesOf,
      main,
      year10,
      maths,
      mathsClass,
      englishClass,
      teacher,
      perera,
      ngata,
    } = await setup();
    const to = async (audience: Record<string, unknown>) => {
      const res = await send({ audience });
      expect(res.status).toBe(201);
      return familiesOf(res.body.id);
    };
    expect(await to({ type: 'branch', ids: [main.id] })).toEqual([perera.id]);
    expect(await to({ type: 'grade', ids: [year10.id] })).toEqual([perera.id]);
    expect(await to({ type: 'subject', ids: [maths.id] })).toEqual([perera.id]);
    expect(await to({ type: 'class', ids: [englishClass.id] })).toEqual([ngata.id]);
    expect(await to({ type: 'class', ids: [mathsClass.id, englishClass.id] })).toEqual(
      [perera.id, ngata.id].sort(),
    );
    expect(await to({ type: 'teacher', ids: [teacher.id] })).toEqual([perera.id]);
    expect(await to({ type: 'custom', ids: [ngata.id] })).toEqual([ngata.id]);
  });

  it('fills in a template, sends only the channels asked for, and needs a subject and body', async () => {
    const { api, send, recipientsOf, ngata } = await setup();
    const template = (
      await api('POST', '/message-templates', {
        name: 'Closed',
        subject: 'Centre closed',
        body: 'We are closed today.',
      })
    ).body;
    const res = await send({
      subject: undefined,
      body: undefined,
      templateId: template.id,
      audience: { type: 'custom', ids: [ngata.id] },
      channels: ['portal'],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      subject: 'Centre closed',
      body: 'We are closed today.',
      templateId: template.id,
      channels: ['portal'],
    });
    // Portal only: nothing is emailed.
    expect((await recipientsOf(res.body.id)).map((r) => r.emailStatus)).toEqual([null]);

    const missing = await api('POST', '/messages', { audience: { type: 'all' } });
    expect(missing.status).toBe(422);
    expect(missing.body.error.fields).toEqual({ subject: ['Required'], body: ['Required'] });
    const noTemplate = await send({ templateId: 'mtp_missing', audience: { type: 'all' } });
    expect(noTemplate.status).toBe(404);
  });

  it('refuses a bad audience with 400, and one that reaches nobody with 422', async () => {
    const { send, albany } = await setup();
    const empty = await send({ audience: { type: 'class', ids: [] } });
    expect(empty.status).toBe(400);
    expect(empty.body.error.fields).toHaveProperty(['audience.ids']);
    expect((await send({ audience: { type: 'all', ids: ['x'] } })).status).toBe(400);
    expect((await send({ audience: { type: 'everyone' } })).status).toBe(400);
    expect((await send({ audience: { type: 'all' }, channels: [] })).status).toBe(400);
    expect((await send({ audience: { type: 'all' }, channels: ['email', 'email'] })).status).toBe(
      400,
    );
    expect((await send({ audience: { type: 'all' }, subject: '' })).status).toBe(400);
    const nobody = await send({ audience: { type: 'class', ids: ['cls_missing'] } });
    expect(nobody.status).toBe(422);
    expect(nobody.body.error.fields).toEqual({ audience: ['No one'] });
    expect((await send({ audience: { type: 'branch', ids: [albany.id] } })).status).toBe(201);
  });

  it('keeps branch staff and teachers to the families they reach', async () => {
    const { send, member, main, teacher, familiesOf, perera, ngata } = await setup();
    const desk = await member('front_desk', [main.id]);
    const fromDesk = await send({ audience: { type: 'all' } }, desk.as);
    expect(fromDesk.status).toBe(201);
    expect(await familiesOf(fromDesk.body.id)).toEqual([perera.id]);
    const outOfReach = await send({ audience: { type: 'custom', ids: [ngata.id] } }, desk.as);
    expect(outOfReach.status).toBe(404);

    const fromTeacher = await send({ audience: { type: 'all' } }, teacher.as);
    expect(fromTeacher.status).toBe(201);
    expect(await familiesOf(fromTeacher.body.id)).toEqual([perera.id]);
  });

  it('is 403 for a parent and an accountant, and 404 for another org', async () => {
    const { send, member, base } = await setup();
    for (const role of ['parent', 'accountant'] as const) {
      expect((await send({ audience: { type: 'all' } }, (await member(role)).as)).status).toBe(403);
    }
    const stranger = await newUser('owner_b');
    await newOrg(stranger.token, 'Harmony Music School');
    const res = await call('POST', `${base}/messages`, {
      token: stranger.token,
      body: { subject: 'x', body: 'y', audience: { type: 'all' } },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /messages', () => {
  it('lists every message for the owner and only their own for anyone else', async () => {
    const { api, send, member, main } = await setup();
    const desk = await member('front_desk', [main.id]);
    const mine = (await send({ audience: { type: 'all' } }, desk.as)).body;
    const owners = (await send({ audience: { type: 'all' } })).body;

    const all = await api('GET', '/messages');
    expect(all.body.data.map((m: Row) => m.id)).toEqual([owners.id, mine.id]);
    const paged = await api('GET', '/messages?limit=1');
    expect(paged.body.nextCursor).toEqual(expect.any(String));
    const next = await api('GET', `/messages?limit=1&cursor=${paged.body.nextCursor}`);
    expect(next.body.data.map((m: Row) => m.id)).toEqual([mine.id]);

    const own = await desk.as('GET', '/messages');
    expect(own.body.data.map((m: Row) => m.id)).toEqual([mine.id]);
    expect((await desk.as('GET', `/messages/${owners.id}`)).status).toBe(404);
    expect((await desk.as('GET', `/messages/${mine.id}`)).status).toBe(200);
    expect((await api('GET', '/messages?kind=automatic')).body.data).toEqual([]);

    const parent = await member('parent');
    expect((await parent.as('GET', '/messages')).status).toBe(403);
    expect((await (await member('accountant')).as('GET', '/messages')).status).toBe(403);
  });
});

describe('GET /portal/messages', () => {
  it('shows a parent the portal messages sent to their families, newest first', async () => {
    const { send, member, mere, perera, ngata } = await setup();
    const parent = await member('parent');
    await db().update(guardians).set({ membershipId: parent.id }).where(eq(guardians.id, mere.id));
    const toAll = (await send({ audience: { type: 'all' } })).body;
    await send({ audience: { type: 'custom', ids: [ngata.id] } });
    const emailOnly = (await send({ audience: { type: 'all' }, channels: ['email'] })).body;

    const res = await parent.as('GET', '/portal/messages');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [
        {
          id: toAll.id,
          kind: 'announcement',
          event: null,
          subject: 'Hello',
          body: 'Term starts Monday.',
          familyIds: [perera.id],
          createdAt: expect.any(String),
        },
      ],
      nextCursor: null,
    });
    expect(res.body.data.map((m: Row) => m.id)).not.toContain(emailOnly.id);
  });

  it('is for parents alone', async () => {
    const { api } = await setup();
    expect((await api('GET', '/portal/messages')).status).toBe(403);
  });
});

describe('message templates', () => {
  it('adds, lists, updates and deletes a template; names are unique ignoring case', async () => {
    const { api, member } = await setup();
    const created = await api('POST', '/message-templates', {
      name: 'Welcome',
      subject: 'Welcome!',
      body: 'Glad to have you.',
    });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.stringMatching(/^mtp_/),
      name: 'Welcome',
      subject: 'Welcome!',
      body: 'Glad to have you.',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const twice = await api('POST', '/message-templates', {
      name: 'WELCOME',
      subject: 'x',
      body: 'y',
    });
    expect(twice.status).toBe(409);
    expect(twice.body.error.fields).toEqual({ name: ['Taken'] });
    expect((await api('POST', '/message-templates', { name: 'x' })).status).toBe(400);

    expect((await api('GET', '/message-templates')).body.data).toEqual([created.body]);
    const teacher = await member('teacher');
    expect((await teacher.as('GET', '/message-templates')).status).toBe(200);
    expect(
      (await teacher.as('POST', '/message-templates', { name: 'a', subject: 'b', body: 'c' }))
        .status,
    ).toBe(403);

    const id = created.body.id as string;
    const updated = await api('PATCH', `/message-templates/${id}`, {
      updatedAt: created.body.updatedAt,
      body: 'So glad to have you.',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.body).toBe('So glad to have you.');
    const stale = await api('PATCH', `/message-templates/${id}`, {
      updatedAt: created.body.updatedAt,
      body: 'late',
    });
    expect(stale.status).toBe(409);
    const audit = (await api('GET', '/audit-log?limit=1')).body.data[0];
    expect(audit).toMatchObject({
      action: 'message_template.updated',
      before: { body: 'Glad to have you.' },
      after: { body: 'So glad to have you.' },
    });

    expect((await api('DELETE', `/message-templates/${id}`)).status).toBe(204);
    expect((await api('DELETE', `/message-templates/${id}`)).status).toBe(404);
    expect((await api('GET', '/message-templates')).body.data).toEqual([]);
    // The name is free again once deleted.
    expect(
      (await api('POST', '/message-templates', { name: 'Welcome', subject: 'a', body: 'b' }))
        .status,
    ).toBe(201);
  });

  it('is 404 for another org’s template', async () => {
    const { api } = await setup();
    const other = await setup();
    const template = (
      await other.api('POST', '/message-templates', { name: 'T', subject: 's', body: 'b' })
    ).body;
    expect(
      (await api('PATCH', `/message-templates/${template.id}`, { updatedAt: template.updatedAt }))
        .status,
    ).toBe(404);
    expect((await api('DELETE', `/message-templates/${template.id}`)).status).toBe(404);
  });
});

describe('notification settings', () => {
  it('gives the defaults, then what the owner saves, with an audit row', async () => {
    const { api, member } = await setup();
    expect((await api('GET', '/notification-settings')).body).toEqual({
      sessionChanges: true,
      invoiceIssued: true,
      overdueReminders: true,
      overdueReminderDays: [1, 7, 14],
      reminderHour: 9,
      replyToEmail: null,
      updatedAt: null,
    });
    const saved = await api('PUT', '/notification-settings', {
      sessionChanges: false,
      invoiceIssued: true,
      overdueReminders: true,
      overdueReminderDays: [14, 3],
      reminderHour: 17,
      replyToEmail: 'Office@Example.com',
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      sessionChanges: false,
      invoiceIssued: true,
      overdueReminders: true,
      overdueReminderDays: [3, 14],
      reminderHour: 17,
      replyToEmail: 'office@example.com',
      updatedAt: expect.any(String),
    });
    expect((await api('GET', '/notification-settings')).body).toEqual(saved.body);
    const audit = (await api('GET', '/audit-log?limit=1')).body.data[0];
    expect(audit).toMatchObject({
      action: 'notification_settings.updated',
      after: { sessionChanges: false, reminderHour: 17 },
    });

    const again = await api('PUT', '/notification-settings', {
      ...saved.body,
      updatedAt: undefined,
      sessionChanges: true,
    });
    expect(again.body.sessionChanges).toBe(true);

    const bad = await api('PUT', '/notification-settings', {
      ...saved.body,
      updatedAt: undefined,
      overdueReminderDays: [1, 1],
      reminderHour: 24,
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual([
      'overdueReminderDays',
      'reminderHour',
    ]);

    const desk = await member('front_desk');
    expect((await desk.as('GET', '/notification-settings')).status).toBe(200);
    expect((await desk.as('PUT', '/notification-settings', saved.body)).status).toBe(403);
  });
});

describe('sending an email (TUI-65)', () => {
  /** A message with one queued recipient, written straight to the database. */
  async function queuedRecipient(orgId: string, guardianId: string, familyId: string) {
    const messageId = newId('message');
    const recipientId = newId('messageRecipient');
    await db()
      .insert(messages)
      .values({
        id: messageId,
        orgId,
        kind: 'announcement',
        subject: 'Closed <today>',
        body: 'We are closed.\n\nSee you tomorrow & thanks.',
        audience: { type: 'all', ids: [] },
        channels: ['email'],
        recipientCount: 1,
      });
    await db().insert(messageRecipients).values({
      id: recipientId,
      orgId,
      messageId,
      familyId,
      guardianId,
      emailStatus: 'queued',
    });
    return { messageId, recipientId };
  }
  const statusOf = async (id: string) =>
    (await db().query.messageRecipients.findFirst({ where: (r, { eq }) => eq(r.id, id) }))!;
  const configured = { ...env, RESEND_API_KEY: 're_test', EMAIL_FROM: 'Centre <hi@example.com>' };

  it('sends it through Resend, escaped and tagged, and marks it sent', async () => {
    const { org, mere, perera } = await setup();
    const { recipientId } = await queuedRecipient(org.id, mere.id, perera.id);
    const fetchFn = vi.fn(async () => Response.json({ id: 'email_123' }));
    await deliverEmail(
      db(),
      configured,
      { orgId: org.id, to: 'mere@example.com', template: 'message', data: {}, recipientId },
      1,
      fetchFn as unknown as typeof fetch,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(recipientId);
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({
      from: 'Centre <hi@example.com>',
      to: ['mere@example.com'],
      subject: 'Closed <today>',
      tags: [
        { name: 'org_id', value: org.id },
        { name: 'recipient_id', value: recipientId },
      ],
    });
    expect(sent.html).toMatch(/<p [^>]*>See you tomorrow &amp; thanks.<\/p>/);
    expect(sent.html).not.toContain('<today>');
    expect(sent.html).toContain('>Closed &lt;today&gt;</h1>');
    expect(sent.html).toMatch(/color: #155d63;[^>]*>Bright Minds Tuition<\/td>/);
    expect(sent.html).toContain('border-top: 4px solid #155d63;');
    // No app address: the footer names EduStrux without the logo.
    expect(sent.html).not.toContain('<img');
    expect(sent.text).toContain('Sent by Bright Minds Tuition.');
    expect(await statusOf(recipientId)).toMatchObject({
      emailStatus: 'sent',
      providerId: 'email_123',
      sentAt: expect.any(String),
    });

    // A redelivered queue message sends nothing twice.
    await deliverEmail(
      db(),
      configured,
      { orgId: org.id, to: 'mere@example.com', template: 'message', data: {}, recipientId },
      2,
      fetchFn as unknown as typeof fetch,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries what may pass later, and fails what won’t, or the last try', async () => {
    const { org, mere, perera } = await setup();
    const message = (recipientId: string) => ({
      orgId: org.id,
      to: 'mere@example.com',
      template: 'message',
      data: {},
      recipientId,
    });
    const busy = vi.fn(async () => new Response('slow down', { status: 429 }));
    const first = await queuedRecipient(org.id, mere.id, perera.id);
    await expect(
      deliverEmail(
        db(),
        configured,
        message(first.recipientId),
        1,
        busy as unknown as typeof fetch,
      ),
    ).rejects.toThrow('Resend 429');
    expect((await statusOf(first.recipientId)).emailStatus).toBe('queued');
    await deliverEmail(
      db(),
      configured,
      message(first.recipientId),
      EMAIL_MAX_RETRIES + 1,
      busy as unknown as typeof fetch,
    );
    expect(await statusOf(first.recipientId)).toMatchObject({
      emailStatus: 'failed',
      error: 'Resend 429: slow down',
    });

    const refused = vi.fn(async () => new Response('bad address', { status: 422 }));
    const second = await queuedRecipient(org.id, mere.id, perera.id);
    await deliverEmail(
      db(),
      configured,
      message(second.recipientId),
      1,
      refused as unknown as typeof fetch,
    );
    expect((await statusOf(second.recipientId)).emailStatus).toBe('failed');

    const third = await queuedRecipient(org.id, mere.id, perera.id);
    const never = vi.fn();
    await deliverEmail(db(), env, message(third.recipientId), 1, never as unknown as typeof fetch);
    expect(never).not.toHaveBeenCalled();
    expect(await statusOf(third.recipientId)).toMatchObject({
      emailStatus: 'failed',
      error: 'Email sending is not set up (RESEND_API_KEY and EMAIL_FROM)',
    });
  });

  it('sends to the guardian’s address now, and skips one who has none any more', async () => {
    const { org, mere, perera } = await setup();
    const fetchFn = vi.fn(async () => Response.json({ id: 'email_5' }));
    const { recipientId } = await queuedRecipient(org.id, mere.id, perera.id);
    // Mere's address changes after the message was sent: the new one is used.
    await db()
      .update(guardians)
      .set({ email: 'mere.new@example.com' })
      .where(eq(guardians.id, mere.id));
    await deliverEmail(
      db(),
      configured,
      { orgId: org.id, to: '', template: 'message', data: {}, recipientId },
      1,
      fetchFn as unknown as typeof fetch,
    );
    const sent = JSON.parse(
      (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(sent.to).toEqual(['mere.new@example.com']);

    const later = await queuedRecipient(org.id, mere.id, perera.id);
    await db().update(guardians).set({ email: null }).where(eq(guardians.id, mere.id));
    fetchFn.mockClear();
    await deliverEmail(
      db(),
      configured,
      { orgId: org.id, to: '', template: 'message', data: {}, recipientId: later.recipientId },
      1,
      fetchFn as unknown as typeof fetch,
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await statusOf(later.recipientId)).emailStatus).toBe('skipped');
  });

  it('sends an invitation with a button when the app’s address is known, else its code', async () => {
    const { org } = await setup();
    const fetchFn = vi.fn(async () => Response.json({ id: 'email_9' }));
    const invitation = {
      orgId: org.id,
      to: 'new@example.com',
      template: 'invitation',
      data: {
        token: 'tok_abc',
        role: 'teacher',
        orgName: 'Bright Minds Tuition',
        expiresAt: '2026-11-01T00:00:00.000Z',
      },
    };
    const sentBody = (call: number) =>
      JSON.parse((fetchFn.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);

    await deliverEmail(
      db(),
      { ...configured, APP_URL: 'https://app.example.com/' },
      invitation,
      1,
      fetchFn as unknown as typeof fetch,
    );
    const linked = sentBody(0);
    expect(linked.subject).toBe('You’re invited to join Bright Minds Tuition');
    expect(linked.html).toContain(
      '<a href="https://app.example.com/invitations/tok_abc" target="_blank" style="display: inline-block;',
    );
    expect(linked.html).toContain('>Accept invitation</a>');
    expect(linked.html).toContain('This invitation works until');
    expect(linked.html).toContain('<img src="https://app.example.com/email-logo.png"');
    expect(linked.text).toContain('on EduStrux as a teacher');
    expect(linked.text).toContain('Accept invitation: https://app.example.com/invitations/tok_abc');
    expect(linked.text).not.toContain('invitation code');

    await deliverEmail(db(), configured, invitation, 1, fetchFn as unknown as typeof fetch);
    const coded = sentBody(1);
    expect(coded.text).toContain('Your invitation code is tok_abc.');
    expect(coded.html).not.toContain('Accept invitation');
  });
});
