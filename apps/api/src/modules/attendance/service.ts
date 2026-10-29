import {
  DEFAULT_MAKEUP_POLICY,
  addDays,
  localNow,
  newId,
  normaliseName,
  type CreateMakeupBooking,
  type MakeupBooking,
  type MakeupCredit,
  type MakeupPolicy,
  type UpdateMakeupPolicy,
  type AbsenceNotice,
  type AbsenceNoticeSource,
  type AttendanceRecord,
  type ClassEmergencyContacts,
  type CreateAbsenceNotice,
  type MarkAttendance,
  type SessionAttendance,
} from '@edustrux/shared';
import type { Access, IdQuery, Ids, OrgCtx } from '../../db/scope';
import { conflict, forbidden, notFound, unprocessable, validationFailed } from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import { classOfSession, dateOfSession } from '../classes/for-attendance';
import * as classes from '../classes/service';
import { studentsExpectedIn } from '../enrolment/for-attendance';
import * as enrolment from '../enrolment/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';
import * as repo from './repository';

type StudentNames = Awaited<ReturnType<typeof people.studentNames>>;
/** What a roster shows of a mark: its status, and when it was made. */
type MarkShown = Pick<repo.AttendanceRow, 'status' | 'updatedAt'>;
/** What a roster shows of an absence notice, by student: the newest that covers the date. */
type Notices = Map<string, NonNullable<AttendanceRecord['absenceNotice']>>;

/**
 * Whose names a roster may need, asked for before the roster is known. Staff and the class's
 * teacher see everyone on it: the students enrolled in the session's class, and anyone marked
 * at it. A parent sees their own children only, so theirs are the only names read, and a
 * student with no name here is left off the roster.
 */
function namesFor(ctx: OrgCtx, access: Access, sessionId: string) {
  // Students booked in to make up a lesson they missed (TUI-55): a parent's own children only.
  const booked = (among?: Ids) =>
    people.studentNames(ctx, repo.studentsBookedInto(ctx, sessionId, among));
  if (access.scope === 'own' && access.role === 'parent') {
    const children = people.studentsOfGuardian(ctx, access.membershipId);
    return { names: [people.studentNames(ctx, children)], booked: booked(children) };
  }
  return {
    names: [
      people.studentNames(ctx, enrolment.studentsOnRollOf(ctx, classOfSession(ctx, sessionId))),
      people.studentNames(ctx, repo.studentsMarkedAt(ctx, sessionId)),
    ],
    booked: booked(),
  };
}

/**
 * Everything a session's attendance is built from, in one stage: every read goes to the
 * database together, so none waits for the session's row (D-102). The roster's reads find their
 * rows through the session's id, and know nothing of who is asking. So the session, which is
 * read as the caller may see it, answers first: outside the caller's reach it is 404, as for the
 * session itself, and nothing the other reads found is used.
 */
async function readSession(ctx: OrgCtx, access: Access, sessionId: string, marking = false) {
  const enrolled = enrolment.studentsOnRollOf(ctx, classOfSession(ctx, sessionId));
  const reads = namesFor(ctx, access, sessionId);
  const [session, roster] = await Promise.allSettled([
    classes.getSession(ctx, access, sessionId),
    Promise.all([
      repo.listMarks(ctx, sessionId),
      studentsExpectedIn(ctx, classOfSession(ctx, sessionId)),
      Promise.all(reads.names),
      repo.noticesOn(ctx, enrolled, dateOfSession(ctx, sessionId)),
      reads.booked,
      // What marking needs to earn make-up credits (TUI-55).
      marking ? repo.findPolicy(ctx) : undefined,
      marking ? repo.creditsAt(ctx, sessionId) : [],
    ]),
  ]);
  if (session.status === 'rejected') throw session.reason;
  if (roster.status === 'rejected') throw roster.reason;

  const [marks, expectedOn, names, notices, booked, policy, credits] = roster.value;
  const noticeOf: Notices = new Map();
  /** The students with a notice for the lesson given before it started. */
  const noticedBefore = new Set<string>();
  // Newest first, so the first notice found for a student is the one shown.
  for (const { studentId, createdAt, ...notice } of notices) {
    if (!noticeOf.has(studentId)) noticeOf.set(studentId, notice);
    if (createdAt < session.value.startsAt) noticedBefore.add(studentId);
  }
  return {
    session: session.value,
    marks: new Map(marks.map((mark) => [mark.studentId, mark])),
    /** Who is expected: the students whose enrolment covers the session's date. */
    expected: expectedOn(session.value.date),
    /** Who is booked in to make up a missed lesson. */
    booked: [...booked.keys()],
    names: new Map([...names.flatMap((found) => [...found]), ...booked]),
    notices: noticeOf,
    noticedBefore,
    policy: toPolicy(policy),
    credits,
  };
}

/**
 * The session's roster, by last name, then first name, then id: who is expected at it, and
 * anyone marked, who stays on it whatever became of their enrolment.
 */
function toAttendance(
  sessionId: string,
  expected: string[],
  marks: Map<string, MarkShown>,
  names: StudentNames,
  notices: Notices,
): SessionAttendance {
  const studentIds = [...new Set([...expected, ...marks.keys()])];
  const records = studentIds.flatMap((studentId): (AttendanceRecord & { key: string })[] => {
    const name = names.get(studentId);
    if (!name) return [];
    const mark = marks.get(studentId);
    return [
      {
        key: [normaliseName(name.lastName), normaliseName(name.firstName), studentId].join('\0'),
        studentId,
        studentFirstName: name.firstName,
        studentLastName: name.lastName,
        status: mark?.status ?? null,
        markedAt: mark?.updatedAt ?? null,
        absenceNotice: notices.get(studentId) ?? null,
      },
    ];
  });
  records.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { sessionId, records: records.map(({ key: _key, ...record }) => record) };
}

/**
 * The session's roster as the caller may see it. A parent sees their own children only. A
 * session outside the caller's reach is 404, as for the session itself.
 */
export async function getAttendance(
  ctx: OrgCtx,
  access: Access,
  sessionId: string,
): Promise<SessionAttendance> {
  const { marks, expected, booked, names, notices } = await readSession(ctx, access, sessionId);
  return toAttendance(sessionId, [...expected, ...booked], marks, names, notices);
}

/**
 * Marks the students in `input` and leaves everyone else as they are. A session can be marked
 * from its own day on, so not while the generator or a new holiday could still remove it days
 * ahead, and not once it is cancelled. Only the students on its roster can be marked: those
 * expected at it, and anyone already marked.
 *
 * The answer is the roster as it was read, with this request's marks as the write stored them.
 * It isn't read again, so a mark someone else made in the same moment shows on the next read.
 */
export async function markAttendance(
  ctx: OrgCtx,
  access: Access,
  sessionId: string,
  input: MarkAttendance,
): Promise<SessionAttendance> {
  const read = await readSession(ctx, access, sessionId, true);
  const { session, marks, booked, names, notices } = read;
  const expected = [...read.expected, ...booked];
  if (session.status === 'cancelled') {
    throw unprocessable("This session is cancelled, so attendance can't be marked.");
  }
  const { timezone } = await orgs.getOrg(ctx);
  if (session.date > localNow(timezone).date) {
    throw unprocessable(
      `Attendance can be marked from the day of the session, ${session.date}, not before.`,
    );
  }

  const onRoster = new Set([...expected, ...marks.keys()]);
  const fields: Record<string, string[]> = {};
  input.records.forEach((record, index) => {
    if (!onRoster.has(record.studentId)) {
      fields[`records.${index}.studentId`] = ['Not enrolled for this session'];
    }
  });
  if (Object.keys(fields).length > 0) {
    throw unprocessable(
      "Only students enrolled in the class on the session's date can be marked.",
      fields,
    );
  }

  const changed = input.records.filter(
    (record) => (marks.get(record.studentId)?.status ?? null) !== record.status,
  );
  if (changed.length === 0) return toAttendance(sessionId, expected, marks, names, notices);

  const credits = creditChanges(ctx, read, changed);
  const saved = await repo.saveMarks(
    ctx,
    sessionId,
    changed.flatMap(({ studentId, status }) =>
      status === null
        ? []
        : [{ id: newId('attendance'), orgId: ctx.orgId, sessionId, studentId, status }],
    ),
    changed.flatMap((record) => (record.status === null ? [marks.get(record.studentId)!.id] : [])),
    {
      before: changed.map(({ studentId }) => ({
        studentId,
        status: marks.get(studentId)?.status ?? null,
      })),
      after: changed.map(({ studentId, status }) => ({ studentId, status })),
    },
    credits,
  );

  const marksNow = new Map<string, MarkShown>(marks);
  for (const { studentId, status } of changed) if (status === null) marksNow.delete(studentId);
  for (const mark of saved) marksNow.set(mark.studentId, mark);
  return toAttendance(sessionId, expected, marksNow, names, notices);
}

/**
 * The emergency contacts of every student on a class's roster: those with an active enrolment in
 * it, whichever branch their family belongs to (D-112). Staff limited to the class's branch can't
 * open a child from another branch or their family, but get the guardians to call. A teacher gets
 * the classes they teach. A parent gets 403: the class's other children aren't theirs. A class
 * outside the caller's reach is 404.
 *
 * One stage: the class, and the contacts by a query for the class's students. Nothing the
 * contacts read is used when the class answers 404.
 */
export async function emergencyContacts(
  ctx: OrgCtx,
  access: Access,
  classId: string,
): Promise<ClassEmergencyContacts> {
  if (access.role === 'parent') throw forbidden();
  const [klass, students] = await Promise.allSettled([
    classes.getClass(ctx, access, classId),
    people.emergencyContactsOf(ctx, enrolment.studentsEnrolledIn(ctx, [classId])),
  ]);
  if (klass.status === 'rejected') throw klass.reason;
  if (students.status === 'rejected') throw students.reason;
  return { classId, students: students.value };
}

// ── Absence notices ─────────────────────────────────────────────────────────
// A notice says a student is, or was, away from one date to another. It flags them on the roster
// of every lesson of theirs in those dates and marks nothing: staff still set the status (D-129).
// Being by date, it holds whatever becomes of a session: moved, regenerated or closed by a holiday.

type Name = { firstName: string; lastName: string };

function toNotice(row: repo.AbsenceNoticeRow, student: Name): AbsenceNotice {
  const { orgId: _org, deletedAt: _deleted, ...notice } = row;
  return { ...notice, studentFirstName: student.firstName, studentLastName: student.lastName };
}

/**
 * The students whose notices a caller gives and reads. A parent: their own children. Staff and
 * teachers: the students they reach through enrolments, so branch staff include the children
 * from another branch on their classes' rosters. undefined = every student.
 */
function noticeReach(ctx: OrgCtx, access: Access, studentId?: string): Ids | undefined {
  if (access.scope === 'own' && access.role === 'parent') {
    return people.studentsOfGuardian(ctx, access.membershipId);
  }
  return enrolment.studentsReached(ctx, access, studentId);
}

/** The name of a student the caller reaches, or 404. One read, by a query for the student. */
async function studentInReach(ctx: OrgCtx, access: Access, studentId: string) {
  const names = await people.studentNames(ctx, noticeReach(ctx, access, studentId) ?? [studentId]);
  const student = names.get(studentId);
  if (!student) throw notFound('Student');
  return student;
}

/**
 * Oldest first. `from` and `to` keep the notices that overlap those dates. A `studentId` the
 * caller can't reach is 404. One stage: the student asked for, the page, and the names of the
 * students on it are read together.
 */
export async function listAbsenceNotices(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  filter: repo.NoticeFilter,
) {
  if (filter.from && filter.to && filter.to < filter.from) {
    throw validationFailed({ to: ['Must be on or after from'] });
  }
  const reach = noticeReach(ctx, access);
  const afterId = decodeCursor(cursor);
  const [student, rows, names] = await Promise.allSettled([
    filter.studentId ? studentInReach(ctx, access, filter.studentId) : undefined,
    repo.listNotices(ctx, limit, afterId, filter, reach),
    people.studentNames(ctx, repo.studentsOnNoticePage(ctx, limit, afterId, filter, reach)),
  ]);
  if (student.status === 'rejected') throw student.reason;
  if (rows.status === 'rejected') throw rows.reason;
  if (names.status === 'rejected') throw names.reason;

  const { data, nextCursor } = toPage(rows.value, limit);
  // A student can be deleted while they have notices (only enrolments stop it): theirs aren't shown.
  return {
    data: data.flatMap((row) => {
      const name = names.value.get(row.studentId);
      return name ? [toNotice(row, name)] : [];
    }),
    nextCursor,
  };
}

/**
 * Records that a student will be, or was, away. `source` is who gave it: staff through
 * `POST /absence-notices`, a parent through the portal. The student must be in the caller's
 * reach (404 otherwise). Nobody is told yet: messages come with the email queue (TUI-70).
 */
export async function createAbsenceNotice(
  ctx: OrgCtx,
  access: Access,
  input: CreateAbsenceNotice,
  source: AbsenceNoticeSource,
): Promise<AbsenceNotice> {
  const student = await studentInReach(ctx, access, input.studentId);
  const row = await repo.insertNotice(ctx, {
    id: newId('absenceNotice'),
    orgId: ctx.orgId,
    studentId: input.studentId,
    startDate: input.startDate,
    endDate: input.endDate ?? input.startDate,
    reason: input.reason ?? null,
    source,
  });
  return toNotice(row, student);
}

// ── Make-ups (TUI-55) ───────────────────────────────────────────────────────
// A missed lesson earns a credit when its mark does under the org's policy: an `excused` or an
// `absent` mark, and, if the policy says so, only with an absence notice given before the lesson
// started. Staff book a credit into another lesson, where the student then shows on the roster.

function toPolicy(row: repo.PolicyRow | undefined): MakeupPolicy {
  if (!row) return { ...DEFAULT_MAKEUP_POLICY, updatedAt: null };
  return {
    enabled: row.enabled,
    creditForExcused: row.creditForExcused,
    creditForAbsent: row.creditForAbsent,
    requireNotice: row.requireNotice,
    expiryDays: row.expiryDays,
    sameCourseOnly: row.sameCourseOnly,
    updatedAt: row.updatedAt,
  };
}

export async function getPolicy(ctx: OrgCtx): Promise<MakeupPolicy> {
  return toPolicy(await repo.findPolicy(ctx));
}

/** Saves the whole policy: the later save wins. Credits already earned keep their expiry. */
export async function savePolicy(ctx: OrgCtx, input: UpdateMakeupPolicy): Promise<MakeupPolicy> {
  const before = await repo.findPolicy(ctx);
  return toPolicy(await repo.savePolicy(ctx, before, input, newId('makeupPolicy')));
}

type Read = Awaited<ReturnType<typeof readSession>>;

/**
 * The credits a change of marks earns, and the unused ones it takes back: statements for the
 * attendance batch. Only students enrolled for the lesson earn one, not those making one up.
 */
function creditChanges(
  ctx: OrgCtx,
  read: Read,
  changed: { studentId: string; status: string | null }[],
) {
  const { policy, session, credits, noticedBefore } = read;
  const enrolled = new Set(read.expected);
  const earns = (studentId: string, status: string | null) =>
    policy.enabled &&
    enrolled.has(studentId) &&
    ((status === 'excused' && policy.creditForExcused) ||
      (status === 'absent' && policy.creditForAbsent)) &&
    (!policy.requireNotice || noticedBefore.has(studentId));
  const add: (repo.NewCreditRow & { id: string })[] = [];
  const withdraw: repo.CreditRow[] = [];
  for (const { studentId, status } of changed) {
    const held = credits.find((credit) => credit.studentId === studentId);
    if (earns(studentId, status)) {
      if (!held) {
        add.push({
          id: newId('makeupCredit'),
          orgId: ctx.orgId,
          studentId,
          sessionId: session.id,
          classId: session.classId,
          courseId: session.courseId,
          missedOn: session.date,
          expiresOn: policy.expiryDays === null ? null : addDays(session.date, policy.expiryDays),
          status: 'available',
        });
      }
    } else if (held && held.status === 'available') {
      withdraw.push(held);
    }
  }
  return {
    statements: repo.creditStatements(
      ctx,
      add,
      withdraw.map((credit) => credit.id),
    ),
    added: add.map((credit) => credit.studentId),
    withdrawn: withdraw.map((credit) => credit.studentId),
  };
}

/** A credit's status as read today: unused past its last day is expired. */
function statusOf(credit: repo.CreditRow, today: string): MakeupCredit['status'] {
  if (credit.status === 'available' && credit.expiresOn !== null && credit.expiresOn < today) {
    return 'expired';
  }
  return credit.status;
}

type BookingShown = MakeupBooking;

function toCredit(
  credit: repo.CreditRow,
  student: Name,
  booking: BookingShown | null,
  today: string,
): MakeupCredit {
  return {
    id: credit.id,
    studentId: credit.studentId,
    studentFirstName: student.firstName,
    studentLastName: student.lastName,
    sessionId: credit.sessionId,
    classId: credit.classId,
    courseId: credit.courseId,
    missedOn: credit.missedOn,
    expiresOn: credit.expiresOn,
    status: statusOf(credit, today),
    booking,
    createdAt: credit.createdAt,
  };
}

/** Bookings as shown, with their lessons' dates and classes. */
async function bookingsShown(ctx: OrgCtx, rows: repo.BookingRow[]) {
  const shown = new Map<string, BookingShown>();
  await Promise.all(
    rows.map(async (row) => {
      const session = await classes
        .getSession(
          ctx,
          { scope: 'all', role: 'owner', membershipId: '', branchIds: null },
          row.sessionId,
        )
        .catch(() => undefined);
      if (!session) return;
      shown.set(row.id, {
        id: row.id,
        creditId: row.creditId,
        studentId: row.studentId,
        sessionId: row.sessionId,
        date: session.date,
        startTime: session.startTime,
        classId: session.classId,
        className: session.className,
        createdAt: row.createdAt,
      });
    }),
  );
  return shown;
}

/**
 * Newest first, for the students the caller reaches, as absence notices are (D-129). A
 * `studentId` the caller can't reach is 404. The page and its students' names are read together;
 * the make-up lessons of the used ones on the page, after.
 */
export async function listCredits(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  query: { studentId?: string; status?: string },
) {
  const reach = noticeReach(ctx, access);
  const afterId = decodeCursor(cursor);
  const { timezone } = await orgs.getOrg(ctx);
  const filter = { ...query, today: localNow(timezone).date };
  const [student, rows, names, bookings] = await Promise.allSettled([
    query.studentId ? studentInReach(ctx, access, query.studentId) : undefined,
    repo.listCredits(ctx, limit, afterId, filter, reach),
    people.studentNames(ctx, repo.onCreditPage(ctx, 'studentId', limit, afterId, filter, reach)),
    repo.listBookings(ctx, repo.onCreditPage(ctx, 'bookingId', limit, afterId, filter, reach)),
  ]);
  if (student.status === 'rejected') throw student.reason;
  if (rows.status === 'rejected') throw rows.reason;
  if (names.status === 'rejected') throw names.reason;
  if (bookings.status === 'rejected') throw bookings.reason;

  const { data, nextCursor } = toPage(rows.value, limit);
  const shown = await bookingsShown(ctx, bookings.value);
  return {
    data: data.flatMap((credit) => {
      const name = names.value.get(credit.studentId);
      if (!name) return [];
      const booking = credit.bookingId ? (shown.get(credit.bookingId) ?? null) : null;
      return [toCredit(credit, name, booking, filter.today)];
    }),
    nextCursor,
  };
}

/**
 * Books a student into a lesson with one of their credits. The credit must be unused and not
 * lapsed, and the lesson scheduled, still to come, in a class the caller reaches, of the same
 * course when the policy says so, and with a place free. The student mustn't already be expected
 * at it.
 */
export async function bookMakeup(
  ctx: OrgCtx,
  access: Access,
  input: CreateMakeupBooking,
): Promise<MakeupBooking> {
  const reach = noticeReach(ctx, access);
  const [credit, sessionRead, policy, org, taken, expectedOn] = await Promise.all([
    repo.findCredit(ctx, input.creditId, reach),
    classes.getSession(ctx, access, input.sessionId).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    ),
    repo.findPolicy(ctx),
    orgs.getOrg(ctx),
    repo.bookingsInto(ctx, input.sessionId),
    studentsExpectedIn(ctx, classOfSession(ctx, input.sessionId)),
  ]);
  if (!credit) throw notFound('Make-up credit');
  if ('error' in sessionRead) throw sessionRead.error;
  const session = sessionRead.value;
  const { date: today, time } = localNow(org.timezone);
  if (statusOf(credit, today) !== 'available') {
    throw unprocessable(`This credit is ${statusOf(credit, today)}.`, {
      creditId: [statusOf(credit, today) === 'used' ? 'Used' : 'Expired'],
    });
  }
  if (session.status !== 'scheduled') {
    throw unprocessable('That lesson is cancelled.', { sessionId: ['Cancelled'] });
  }
  if (session.date < today || (session.date === today && session.startTime <= time)) {
    throw unprocessable('That lesson has started.', { sessionId: ['Started'] });
  }
  if (credit.expiresOn !== null && session.date > credit.expiresOn) {
    throw unprocessable(`The credit can be used for lessons up to ${credit.expiresOn}.`, {
      sessionId: ['After the credit expires'],
    });
  }
  if (toPolicy(policy).sameCourseOnly && session.courseId !== credit.courseId) {
    throw unprocessable('A make-up must be a lesson of the course that was missed.', {
      sessionId: ['Another course'],
    });
  }
  const expected = expectedOn(session.date);
  if (expected.includes(credit.studentId)) {
    throw unprocessable('The student is already in that lesson.', { sessionId: ['Enrolled'] });
  }
  if (taken.some((booking) => booking.studentId === credit.studentId)) {
    throw conflict('The student is already booked into that lesson.', { sessionId: ['Booked'] });
  }
  const klass = await classes.getClass(ctx, access, session.classId);
  if (klass.capacity !== null && expected.length + taken.length >= klass.capacity) {
    throw unprocessable(`That lesson is full: all ${klass.capacity} place(s) are taken.`, {
      sessionId: ['Full'],
    });
  }

  let row: repo.BookingRow;
  try {
    row = await repo.insertBooking(ctx, {
      id: newId('makeupBooking'),
      orgId: ctx.orgId,
      creditId: credit.id,
      studentId: credit.studentId,
      sessionId: session.id,
    });
  } catch (err) {
    if (repo.bookingTaken(err)) {
      throw conflict('That credit or lesson was just booked.', { creditId: ['Booked'] });
    }
    throw err;
  }
  return {
    id: row.id,
    creditId: row.creditId,
    studentId: row.studentId,
    sessionId: row.sessionId,
    date: session.date,
    startTime: session.startTime,
    classId: session.classId,
    className: session.className,
    createdAt: row.createdAt,
  };
}

/** Cancels a make-up booking before its lesson starts, and gives the credit back. */
export async function cancelMakeup(ctx: OrgCtx, access: Access, id: string) {
  const booking = await repo.findBooking(ctx, id, noticeReach(ctx, access));
  if (!booking) throw notFound('Make-up booking');
  const [session, org] = await Promise.all([
    classes
      .getSession(
        ctx,
        { scope: 'all', role: 'owner', membershipId: '', branchIds: null },
        booking.sessionId,
      )
      .catch(() => undefined),
    orgs.getOrg(ctx),
  ]);
  const { date: today, time } = localNow(org.timezone);
  if (session && (session.date < today || (session.date === today && session.startTime <= time))) {
    throw unprocessable('The make-up lesson has started, so the booking stays.', {
      sessionId: ['Started'],
    });
  }
  await repo.cancelBooking(ctx, booking);
}

/**
 * Marks the org's unused credits past their last day as expired. For the hourly cron, which
 * gives the org's local date.
 */
export async function expireCredits(ctx: OrgCtx, today?: string) {
  today ??= localNow((await orgs.getOrg(ctx)).timezone).date;
  return (await repo.expireCredits(ctx, today)).length;
}

// ── The dashboard (TUI-62) ──────────────────────────────────────────────────

/**
 * What the dashboard shows of attendance, as far as the caller reaches: which of the lessons
 * have marks, the students away today and the make-up credits waiting to be used. One stage.
 */
export async function dashboardAttendance(
  ctx: OrgCtx,
  access: Access,
  lessons: Ids,
  today: string,
) {
  const reach = noticeReach(ctx, access);
  const [marked, away, credits] = await Promise.all([
    repo.lessonsMarked(ctx, lessons),
    repo.countAwayOn(ctx, today, reach),
    repo.countCreditsAvailable(ctx, today, reach),
  ]);
  return { marked: new Set(marked.map((row) => row.sessionId)), away, credits };
}

/** This module's part of erasing a family (TUI-79), for the erasure's one batch. */
export function eraseStatements(ctx: OrgCtx, studentIds: string[]) {
  return repo.eraseStatements(ctx, studentIds);
}

/** Students marked on any of the sessions, as a query another statement filters by (D-104). */
export function studentsMarkedIn(ctx: OrgCtx, sessionIds: IdQuery) {
  return repo.studentsMarkedIn(ctx, sessionIds);
}

export function purgeStatements(ctx: OrgCtx, studentIds: string[]) {
  return repo.purgeStatements(ctx, studentIds);
}
