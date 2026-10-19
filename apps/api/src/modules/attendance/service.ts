import {
  localNow,
  newId,
  normaliseName,
  type AbsenceNotice,
  type AbsenceNoticeSource,
  type AttendanceRecord,
  type ClassEmergencyContacts,
  type CreateAbsenceNotice,
  type MarkAttendance,
  type SessionAttendance,
} from '@edustrux/shared';
import type { Access, Ids, OrgCtx } from '../../db/scope';
import { forbidden, notFound, unprocessable, validationFailed } from '../../lib/errors';
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
function namesFor(ctx: OrgCtx, access: Access, sessionId: string): Promise<StudentNames>[] {
  if (access.scope === 'own' && access.role === 'parent') {
    return [people.studentNames(ctx, people.studentsOfGuardian(ctx, access.membershipId))];
  }
  return [
    people.studentNames(ctx, enrolment.studentsEnrolledIn(ctx, classOfSession(ctx, sessionId))),
    people.studentNames(ctx, repo.studentsMarkedAt(ctx, sessionId)),
  ];
}

/**
 * Everything a session's attendance is built from, in one stage: every read goes to the
 * database together, so none waits for the session's row (D-102). The roster's reads find their
 * rows through the session's id, and know nothing of who is asking. So the session, which is
 * read as the caller may see it, answers first: outside the caller's reach it is 404, as for the
 * session itself, and nothing the other reads found is used.
 */
async function readSession(ctx: OrgCtx, access: Access, sessionId: string) {
  const enrolled = enrolment.studentsEnrolledIn(ctx, classOfSession(ctx, sessionId));
  const [session, roster] = await Promise.allSettled([
    classes.getSession(ctx, access, sessionId),
    Promise.all([
      repo.listMarks(ctx, sessionId),
      studentsExpectedIn(ctx, classOfSession(ctx, sessionId)),
      Promise.all(namesFor(ctx, access, sessionId)),
      repo.noticesOn(ctx, enrolled, dateOfSession(ctx, sessionId)),
    ]),
  ]);
  if (session.status === 'rejected') throw session.reason;
  if (roster.status === 'rejected') throw roster.reason;

  const [marks, expectedOn, names, notices] = roster.value;
  const noticeOf: Notices = new Map();
  // Newest first, so the first notice found for a student is the one shown.
  for (const { studentId, ...notice } of notices) {
    if (!noticeOf.has(studentId)) noticeOf.set(studentId, notice);
  }
  return {
    session: session.value,
    marks: new Map(marks.map((mark) => [mark.studentId, mark])),
    /** Who is expected: the students whose active enrolment covers the session's date. */
    expected: expectedOn(session.value.date),
    names: new Map(names.flatMap((found) => [...found])),
    notices: noticeOf,
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
  const { marks, expected, names, notices } = await readSession(ctx, access, sessionId);
  return toAttendance(sessionId, expected, marks, names, notices);
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
  const { session, marks, expected, names, notices } = await readSession(ctx, access, sessionId);
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
