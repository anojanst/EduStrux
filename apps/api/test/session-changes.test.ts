import { memberships, sessions } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// One lesson changed by hand, and the families told (TUI-49); an issued invoice sent to the
// family (TUI-70).

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;
const nextMonday = () => addDays(today(), 8 - weekday(today()));

type Row = { id: string; updatedAt: string };
type Session = Row & {
  classId: string;
  date: string;
  startTime: string;
  endTime: string;
  roomId: string | null;
  teacherId: string | null;
  status: string;
  movedFrom: { date: string; startTime: string } | null;
};
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

/**
 * A class with a lesson every Monday 16:00–17:00 for four weeks from next Monday, in room 1 with
 * `teacher`. Aroha is enrolled; her family has Mere, with an email address.
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
  const room1 = await make(`/branches/${main.id}/rooms`, { name: 'Room 1' });
  const room2 = await make(`/branches/${main.id}/rooms`, { name: 'Room 2' });
  const albanyRoom = await make(`/branches/${albany.id}/rooms`, { name: 'Albany room' });
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', { subjectId: subject.id, gradeLevelId: grade.id });
  const teacher = await member('teacher');
  const start = nextMonday();
  const klass = await make('/classes', {
    courseId: course.id,
    branchId: main.id,
    name: 'Maths A',
    startDate: start,
    endDate: addDays(start, 27),
    roomId: room1.id,
    teacherId: teacher.id,
  });
  const slots = [{ weekday: 1, startTime: '16:00', endTime: '17:00' }];
  await api('PUT', `/classes/${klass.id}/schedule`, { slots });
  const family = await make('/families', { name: 'Perera', branchId: main.id });
  await make(`/families/${family.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
    email: 'mere@example.com',
  });
  const aroha = await make('/students', {
    familyId: family.id,
    firstName: 'Aroha',
    lastName: 'Perera',
  });
  await make('/enrolments', { studentId: aroha.id, classId: klass.id });

  const lessons = async () =>
    (
      await api(
        'GET',
        `/sessions?classId=${klass.id}&from=${addDays(start, -7)}&to=${addDays(start, 60)}`,
      )
    ).body.data as Session[];
  const [first, second] = await lessons();
  const patch = (session: Row, body: Record<string, unknown>, as: As = api) =>
    as('PATCH', `/sessions/${session.id}`, { updatedAt: session.updatedAt, ...body });
  type Automatic = {
    id: string;
    event: string;
    subject: string;
    body: string;
    recipientCount: number;
  };
  const automatic = async () =>
    (await api('GET', '/messages?kind=automatic')).body.data as Automatic[];
  /** The automatic message with this id, once the email queue's consumer has written it. */
  const sent = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const found = (await automatic()).find((m) => m.id === id);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`message ${id} was never written`);
  };
  /** Waits long enough for the queue to have written a message, had it been going to. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
  /** The automatic messages, once the queue has written at least one. */
  const someSent = async () => {
    for (let i = 0; i < 200; i++) {
      const found = await automatic();
      if (found.length > 0) return found;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('no message was written');
  };
  const lastAudit = async () => (await api('GET', '/audit-log?limit=1')).body.data[0];

  return {
    org,
    base,
    api,
    make,
    member,
    main,
    albany,
    room1,
    room2,
    albanyRoom,
    teacher,
    start,
    klass,
    slots,
    family,
    aroha,
    first: first!,
    second: second!,
    lessons,
    patch,
    automatic,
    sent,
    settle,
    someSent,
    lastAudit,
  };
}

describe('PATCH /sessions/{id}', () => {
  it('moves a lesson, keeps where it was first, and tells the family', async () => {
    const { patch, first, start, sent, api } = await setup();
    const tuesday = addDays(start, 1);
    const res = await patch(first, { date: tuesday, startTime: '15:30', endTime: '16:30' });
    expect(res.status).toBe(200);
    expect(res.body.session).toMatchObject({
      id: first.id,
      date: tuesday,
      startTime: '15:30',
      endTime: '16:30',
      status: 'scheduled',
      movedFrom: { date: start, startTime: '16:00' },
    });
    expect(res.body.messageId).toEqual(expect.stringMatching(/^msg_/));
    // The request only queues the message: it costs no database call of its own.
    expect(res.db.stages).toBeLessThanOrEqual(3);
    const message = await sent(res.body.messageId);
    expect(message).toMatchObject({
      event: 'session_changed',
      subject: expect.stringContaining('Maths A: lesson moved to'),
      recipientCount: 1,
    });
    expect(message.body).toContain('has moved to');
    const audits = (await api('GET', '/audit-log?limit=2')).body.data;
    expect(audits.map((a: { action: string }) => a.action)).toEqual([
      'message.sent',
      'session.moved',
    ]);
    // The message's row names who made the change.
    expect(audits[0].actorUserId).toBe(audits[1].actorUserId);
    expect(audits[1]).toMatchObject({
      before: { date: start, startTime: '16:00', originalDate: null },
      after: { date: tuesday, startTime: '15:30', originalDate: start },
    });
  });

  it('keeps a moved lesson when the schedule is saved again, and clears movedFrom when moved back', async () => {
    const { patch, first, start, api, klass, slots, lessons } = await setup();
    const moved = (await patch(first, { date: addDays(start, 2) })).body.session as Session;
    const saved = await api('PUT', `/classes/${klass.id}/schedule`, { slots });
    expect(saved.body.sessions).toMatchObject({ added: 0, removed: 0 });
    const dates = (await lessons()).map((s) => s.date);
    expect(dates).toEqual([
      addDays(start, 2),
      addDays(start, 7),
      addDays(start, 14),
      addDays(start, 21),
    ]);

    const home = await patch(moved, { date: start });
    expect(home.body.session).toMatchObject({ date: start, movedFrom: null });
  });

  it('cancels a lesson and puts it back on, telling the family each time', async () => {
    const { patch, second, sent } = await setup();
    const cancelled = await patch(second, { status: 'cancelled', note: 'The teacher is unwell.' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.session.status).toBe('cancelled');
    const message = await sent(cancelled.body.messageId);
    expect(message.subject).toContain('cancelled');
    expect(message.body).toContain('The teacher is unwell.');

    const restored = await patch(cancelled.body.session, { status: 'scheduled' });
    expect((await sent(restored.body.messageId)).subject).toContain('is back on');
  });

  it('tells nobody about a new room or teacher, or when asked not to or turned off', async () => {
    const { patch, first, second, room2, member, api, automatic, settle } = await setup();
    const other = await member('teacher');
    const roomOnly = await patch(first, { roomId: room2.id, teacherId: other.id });
    expect(roomOnly.status).toBe(200);
    expect(roomOnly.body).toMatchObject({
      session: { roomId: room2.id, teacherId: other.id },
      messageId: null,
    });
    const quiet = await patch(second, { status: 'cancelled', notify: false });
    expect(quiet.body.messageId).toBe(null);

    await api('PUT', '/notification-settings', {
      sessionChanges: false,
      invoiceIssued: true,
      overdueReminders: true,
      overdueReminderDays: [1],
      reminderHour: 9,
      replyToEmail: null,
    });
    // Turned off, the notice is still queued, and its consumer sends nothing.
    const off = await patch(quiet.body.session, { status: 'scheduled' });
    expect(off.status).toBe(200);
    await settle();
    expect(await automatic()).toEqual([]);
  });

  it('changes nothing for only updatedAt, and is 409 when stale or the slot is taken', async () => {
    const { patch, first, second } = await setup();
    const same = await patch(first, {});
    expect(same.status).toBe(200);
    expect(same.body).toEqual({ session: first, messageId: null });
    const moved = await patch(first, { startTime: '18:00', endTime: '19:00' });
    expect(moved.status).toBe(200);
    expect((await patch(first, { startTime: '15:00', endTime: '16:00' })).status).toBe(409);
    // Another of the class's lessons is already at that date and time.
    const taken = await patch(second, { date: first.date, startTime: '18:00', endTime: '19:00' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.fields).toEqual({ startTime: ['Taken'] });
  });

  it('refuses a lesson that has started, a time that has passed, and bad times or rooms', async () => {
    const { patch, first, org, klass, room1, albanyRoom, member } = await setup();
    const yesterday = addDays(today(), -1);
    const pastId = newId('session');
    await db().insert(sessions).values({
      id: pastId,
      orgId: org.id,
      classId: klass.id,
      roomId: room1.id,
      date: yesterday,
      startTime: '16:00',
      endTime: '17:00',
    });
    const past = (await db().query.sessions.findFirst({ where: (s, { eq }) => eq(s.id, pastId) }))!;
    const started = await patch(past, { status: 'cancelled' });
    expect(started.status).toBe(422);
    expect(started.body.error.fields).toEqual({ date: ['Started'] });

    const backwards = await patch(first, { date: yesterday });
    expect(backwards.status).toBe(422);
    expect(backwards.body.error.fields).toEqual({ date: ['In the past'] });
    expect((await patch(first, { startTime: '18:00', endTime: '17:30' })).status).toBe(400);
    const endBefore = await patch(first, { endTime: '15:00' });
    expect(endBefore.status).toBe(400);
    expect(endBefore.body.error.fields).toEqual({ endTime: ['Must be after startTime'] });
    const otherBranch = await patch(first, { roomId: albanyRoom.id });
    expect(otherBranch.status).toBe(422);
    expect((await patch(first, { roomId: 'rm_missing' })).status).toBe(404);
    const parent = await member('parent');
    const notStaff = await patch(first, { teacherId: parent.id });
    expect(notStaff.status).toBe(422);
    expect((await patch(first, { teacherId: 'mem_missing' })).status).toBe(404);
  });

  it('is for staff who write classes, in their own branches', async () => {
    const { patch, first, member, main, albany, base } = await setup();
    for (const role of ['teacher', 'parent', 'accountant'] as const) {
      expect((await patch(first, { status: 'cancelled' }, (await member(role)).as)).status).toBe(
        403,
      );
    }
    const albanyDesk = await member('front_desk', [albany.id]);
    expect((await patch(first, { status: 'cancelled' }, albanyDesk.as)).status).toBe(404);
    const mainDesk = await member('front_desk', [main.id]);
    expect((await patch(first, { status: 'cancelled' }, mainDesk.as)).status).toBe(200);

    const stranger = await newUser('owner_b');
    await newOrg(stranger.token, 'Harmony Music School');
    const res = await call('PATCH', `${base}/sessions/${first.id}`, {
      token: stranger.token,
      body: { updatedAt: first.updatedAt },
    });
    expect(res.status).toBe(404);
  });
});

describe('issuing an invoice', () => {
  it('sends it to the family', async () => {
    const { api, make, main, family, aroha, start, someSent } = await setup();
    const subject = await make('/subjects', { name: 'Science' });
    const grade = await make('/grade-levels', { name: 'Year 11' });
    const course = await make('/courses', {
      subjectId: subject.id,
      gradeLevelId: grade.id,
      defaultPrice: { amount: 45000, currency: 'NZD' },
    });
    const year = await make('/academic-years', {
      name: 'This year',
      startDate: addDays(today(), -10),
      endDate: addDays(start, 200),
    });
    const term = await make('/terms', {
      academicYearId: year.id,
      name: 'Term 1',
      startDate: start,
      endDate: addDays(start, 27),
    });
    const klass = await make('/classes', {
      courseId: course.id,
      termId: term.id,
      branchId: main.id,
      name: 'Science',
    });
    await api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [{ weekday: 3, startTime: '16:00', endTime: '17:00' }],
    });
    await make('/enrolments', { studentId: aroha.id, classId: klass.id });
    const run = await api('POST', `/terms/${term.id}/generate-invoices`, {
      dueDate: addDays(start, 14),
    });
    for (let i = 0; i < 400; i++) {
      const job = (await api('GET', `/jobs/${run.body.jobId}`)).body;
      if (job.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const [invoice] = (await api('GET', `/invoices?familyId=${family.id}`)).body.data;
    const issued = await api('POST', `/invoices/${invoice.id}/issue`);
    expect(issued.status).toBe(200);
    expect(issued.db.stages).toBeLessThanOrEqual(3);
    const [message] = await someSent();
    expect(message).toMatchObject({
      event: 'invoice_issued',
      subject: 'Invoice from Bright Minds Tuition: $450.00',
      recipientCount: 1,
    });
    expect(message!.body).toContain(invoice.bankReference);
    expect(message!.body).toContain('It is due on');
  });
});
