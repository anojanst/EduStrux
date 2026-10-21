import { addDays, localNow, localToUtc, weekday, type Role } from '@edustrux/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, sampleOrg, tokenFor } from './helpers';

// End-to-end tests run a whole flow through the API, the way the web app will (D-001, D-114).
// Each step uses what the steps before it made; the module tests cover the edge cases.

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const nzd = (amount: number) => ({ amount, currency: 'NZD' }); // sampleOrg's currency
const TERM_PRICE = 45000;

type Row = { id: string; updatedAt: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

/**
 * Someone who has signed in with Clerk. Each request carries a token signed at that moment, as
 * the client's Clerk session keeps it fresh, so it still works after the test moves the clock on.
 */
async function signUp(label: string) {
  const clerkUserId = `user_test_${label}_${crypto.randomUUID().slice(0, 8)}`;
  const send: As = async (method, path, body) =>
    call(method, path, {
      token: await tokenFor(clerkUserId, { email: `${label}@example.com` }),
      body,
    });
  const me = await send('GET', '/api/v1/me');
  return { userId: me.body.id as string, me: me.body, send };
}

/**
 * Moves the clock, in the test and in the API, to a local moment in the org's timezone, and lets
 * it run on from there. Sessions are only made for lessons still to come, and attendance only
 * marked from a lesson's day, so a lesson has to come round for the flow to go on.
 */
function clockAt(date: string, time: string) {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(localToUtc(date, time, TZ)));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('end to end', () => {
  it('runs a centre’s first term: onboarding, class setup, enrolment, attendance, invoice, payment', async () => {
    // ── Onboarding: the owner signs up and creates the centre, which comes with a branch.
    const owner = await signUp('owner');
    expect(owner.me.memberships).toEqual([]);
    const created = await owner.send('POST', '/api/v1/orgs', sampleOrg());
    expect(created.status).toBe(201);
    const org = created.body as Row;
    expect((await owner.send('GET', '/api/v1/me')).body.memberships).toEqual([
      expect.objectContaining({ role: 'owner', org: expect.objectContaining({ id: org.id }) }),
    ]);

    const base = `/api/v1/orgs/${org.id}`;
    const as =
      (person: { send: As }): As =>
      (method, path, body) =>
        person.send(method, `${base}${path}`, body);
    const api = as(owner);
    const make = async <T = Row>(path: string, body: unknown, by: As = api) => {
      const res = await by('POST', path, body);
      if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
      return res.body as T;
    };
    const branches = (await api('GET', '/branches')).body.data as Row[];
    expect(branches).toHaveLength(1);
    const main = branches[0]!;

    // ── Staff: the owner invites a teacher, who signs up and accepts with the invite's token.
    const teacherInvite = await make<{ token: string }>('/staff/invitations', {
      email: 'teacher@example.com',
      role: 'teacher',
    });
    const teacher = await signUp('teacher');
    const joined = await teacher.send('POST', `/api/v1/invitations/${teacherInvite.token}/accept`);
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ role: 'teacher', org: { id: org.id } });
    const teacherId = joined.body.id as string;
    const staff = (await api('GET', '/staff')).body.data as { role: Role; email: string }[];
    expect(staff.map((m) => `${m.role} ${m.email}`)).toEqual([
      'owner owner@example.com',
      'teacher teacher@example.com',
    ]);

    // ── Class setup: a ten-week term from next Monday, and a class with a lesson every Monday.
    const today = localNow(TZ).date;
    const firstMonday = addDays(today, 8 - weekday(today));
    const lastDay = addDays(firstMonday, 69);
    const year = await make('/academic-years', {
      name: 'This year',
      startDate: today,
      endDate: addDays(firstMonday, 300),
    });
    const term = await make('/terms', {
      academicYearId: year.id,
      name: 'Term 1',
      startDate: firstMonday,
      endDate: lastDay,
    });
    const room = await make(`/branches/${main.id}/rooms`, { name: 'Room 1', capacity: 12 });
    const subject = await make('/subjects', { name: 'Mathematics' });
    const grade = await make('/grade-levels', { name: 'Year 10' });
    const gst = await make('/tax-rates', {
      name: 'GST',
      rateBps: 1500,
      inclusive: true,
      isDefault: true,
    });
    const course = await make('/courses', {
      subjectId: subject.id,
      gradeLevelId: grade.id,
      defaultPrice: nzd(TERM_PRICE),
      durationMinutes: 60,
    });
    const klass = await make('/classes', {
      courseId: course.id,
      termId: term.id,
      branchId: main.id,
      roomId: room.id,
      teacherId,
      name: 'Year 10 Maths',
      capacity: 12,
    });
    const schedule = await api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [{ weekday: 1, startTime: '16:00', endTime: '17:00' }],
    });
    expect(schedule.status).toBe(200);

    // The schedule makes the term's ten lessons, in the class's room with its teacher.
    const lessons = (
      await api('GET', `/sessions?classId=${klass.id}&from=${firstMonday}&to=${lastDay}&limit=50`)
    ).body.data as (Row & { date: string })[];
    expect(lessons.map((lesson) => lesson.date)).toEqual(
      Array.from({ length: 10 }, (_, week) => addDays(firstMonday, 7 * week)),
    );
    expect(lessons[0]).toMatchObject({
      startTime: '16:00',
      endTime: '17:00',
      roomId: room.id,
      teacherId,
      status: 'scheduled',
    });

    // ── Enrolment: the Perera family, with a parent who signs in and two children in Year 10.
    const family = await make<Row & { bankReference: string }>('/families', {
      name: 'Perera',
      branchId: main.id,
    });
    const guardian = await make(`/families/${family.id}/guardians`, {
      firstName: 'Mere',
      lastName: 'Perera',
      relationship: 'Mother',
      email: 'parent@example.com',
    });
    // The owner invites Mere to sign in; accepting links her to the family.
    const parentInvite = await make<{ token: string }>(`/guardians/${guardian.id}/invitation`, {});
    const parent = await signUp('parent');
    const parentJoined = await parent.send(
      'POST',
      `/api/v1/invitations/${parentInvite.token}/accept`,
    );
    expect(parentJoined.status).toBe(200);
    expect(parentJoined.body.role).toBe('parent');
    const child = (firstName: string) =>
      make('/students', {
        familyId: family.id,
        firstName,
        lastName: 'Perera',
        gradeLevelId: grade.id,
      });
    const aroha = await child('Aroha');
    const kai = await child('Kai');
    const enrolments = [
      await make('/enrolments', { studentId: aroha.id, classId: klass.id }),
      await make('/enrolments', { studentId: kai.id, classId: klass.id }),
    ];
    // Enrolled before the term began, so from its first day until the class ends.
    for (const enrolment of enrolments) {
      expect(enrolment).toMatchObject({ startDate: firstMonday, endDate: null, status: 'active' });
    }

    // ── Attendance: the first lesson comes round, and the teacher marks it once it's over.
    clockAt(firstMonday, '17:05');
    const asTeacher = as(teacher);
    const lesson = lessons[0]!;
    const roster = await asTeacher('GET', `/sessions/${lesson.id}/attendance`);
    expect(roster.body.records).toMatchObject([
      { studentId: aroha.id, status: null },
      { studentId: kai.id, status: null },
    ]);
    const marked = await asTeacher('PUT', `/sessions/${lesson.id}/attendance`, {
      records: [
        { studentId: aroha.id, status: 'present' },
        { studentId: kai.id, status: 'absent' },
      ],
    });
    expect(marked.status).toBe(200);
    expect(marked.body.records).toMatchObject([
      { studentFirstName: 'Aroha', status: 'present', markedAt: expect.any(String) },
      { studentFirstName: 'Kai', status: 'absent', markedAt: expect.any(String) },
    ]);

    // ── Invoices: in the term's first week the owner bills it, one invoice for the family.
    const due = addDays(firstMonday, 14);
    const started = await api('POST', `/terms/${term.id}/generate-invoices`, { dueDate: due });
    expect(started.status).toBe(202);
    let job = (await api('GET', `/jobs/${started.body.jobId}`)).body;
    for (let i = 0; i < 400 && (job.status === 'queued' || job.status === 'running'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      job = (await api('GET', `/jobs/${started.body.jobId}`)).body;
    }
    expect(job).toMatchObject({
      status: 'succeeded',
      result: { invoices: 1, lines: 2, total: nzd(2 * TERM_PRICE), skipped: [] },
    });

    const drafts = (await api('GET', '/invoices')).body.data as Row[];
    expect(drafts).toHaveLength(1);
    const invoice = drafts[0]!;
    // The whole term for each child, whatever the first lesson's attendance: $450 including
    // 15% GST is $391.30 plus $58.70.
    const line = {
      basis: 'per_term',
      unitPrice: nzd(TERM_PRICE),
      lessons: 10,
      taxRateId: gst.id,
      subtotal: nzd(39130),
      tax: nzd(5870),
      total: nzd(TERM_PRICE),
    };
    expect(invoice).toMatchObject({
      familyId: family.id,
      status: 'draft',
      termId: term.id,
      bankReference: family.bankReference,
      dueDate: due,
      subtotal: nzd(78260),
      tax: nzd(11740),
      total: nzd(2 * TERM_PRICE),
      paid: nzd(0),
      balance: nzd(2 * TERM_PRICE),
      lines: [
        { ...line, enrolmentId: enrolments[0]!.id, studentFirstName: 'Aroha' },
        { ...line, enrolmentId: enrolments[1]!.id, studentFirstName: 'Kai' },
      ],
    });
    // A draft isn't the parent's to see. Issuing it sends it to them.
    const asParent = as(parent);
    expect((await asParent('GET', '/invoices')).body.data).toEqual([]);
    const issued = await api('POST', `/invoices/${invoice.id}/issue`);
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe('issued');

    // ── Payment: the family pays by bank transfer, quoting their reference, which settles it.
    const payment = await make('/payments', {
      familyId: family.id,
      method: 'bank_transfer',
      amount: nzd(2 * TERM_PRICE),
      reference: family.bankReference,
      allocations: [{ invoiceId: invoice.id, amount: nzd(2 * TERM_PRICE) }],
    });
    expect(payment).toMatchObject({
      familyId: family.id,
      receivedOn: firstMonday,
      allocations: [{ invoiceId: invoice.id, amount: nzd(2 * TERM_PRICE) }],
    });
    const paid = (await api('GET', `/invoices/${invoice.id}`)).body;
    expect(paid).toMatchObject({
      status: 'paid',
      paid: nzd(2 * TERM_PRICE),
      balance: nzd(0),
    });

    // ── The parent sees their children's attendance, the paid invoice and their payment.
    expect((await asParent('GET', `/sessions/${lesson.id}/attendance`)).body).toEqual(marked.body);
    expect((await asParent('GET', '/invoices')).body.data).toEqual([paid]);
    expect((await asParent('GET', '/payments')).body.data).toEqual([payment]);

    // ── The parent portal shows them the same: their children, the term's lessons and the
    // invoice, its lines without the price rule that priced them (D-126).
    const children = (await asParent('GET', '/portal/children')).body.data as {
      firstName: string;
      enrolments: Row[];
    }[];
    expect(children.map((c) => [c.firstName, c.enrolments.map((e) => e.id)])).toEqual([
      ['Aroha', [enrolments[0]!.id]],
      ['Kai', [enrolments[1]!.id]],
    ]);
    const timetable = (
      await asParent('GET', `/portal/sessions?from=${firstMonday}&to=${lastDay}&limit=50`)
    ).body.data as (Row & { children: { firstName: string }[] })[];
    expect(timetable.map((session) => session.id)).toEqual(lessons.map((l) => l.id));
    for (const session of timetable) {
      expect(session.children.map((c) => c.firstName)).toEqual(['Aroha', 'Kai']);
    }
    const lines = paid.lines as Record<string, unknown>[];
    expect((await asParent('GET', '/portal/invoices')).body.data).toEqual([
      { ...paid, lines: lines.map(({ priceSource: _s, priceRuleId: _r, ...line }) => line) },
    ]);

    // ── Every write along the way left an audit row, under the person who made it.
    const name = {
      [owner.userId]: 'owner',
      [teacher.userId]: 'teacher',
      [parent.userId]: 'parent',
    };
    const audit = (await api('GET', '/audit-log?limit=100')).body.data as {
      action: string;
      actorUserId: string;
    }[];
    expect(audit.map((row) => `${row.action} by ${name[row.actorUserId]}`).sort()).toEqual(
      [
        'org.created by owner',
        'invitation.created by owner',
        'invitation.accepted by teacher',
        'invitation.created by owner',
        'invitation.accepted by parent',
        'academic_year.created by owner',
        'term.created by owner',
        'room.created by owner',
        'subject.created by owner',
        'grade_level.created by owner',
        'tax_rate.created by owner',
        'course.created by owner',
        'class.created by owner',
        'class.schedule_set by owner',
        'family.created by owner',
        'guardian.created by owner',
        'student.created by owner',
        'student.created by owner',
        'enrolment.created by owner',
        'enrolment.created by owner',
        'attendance.marked by teacher',
        'job.started by owner',
        'invoice.generated by owner',
        'invoice.issued by owner',
        'payment.created by owner',
      ].sort(),
    );
  });
});
