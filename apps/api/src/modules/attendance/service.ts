import {
  localNow,
  newId,
  normaliseName,
  type AttendanceRecord,
  type MarkAttendance,
  type SessionAttendance,
} from '@edustrux/shared';
import type { Access, OrgCtx } from '../../db/scope';
import { unprocessable } from '../../lib/errors';
import { classOfSession } from '../classes/for-attendance';
import * as classes from '../classes/service';
import { studentsExpectedIn } from '../enrolment/for-attendance';
import * as enrolment from '../enrolment/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';
import * as repo from './repository';

type StudentNames = Awaited<ReturnType<typeof people.studentNames>>;
/** What a roster shows of a mark: its status, and when it was made. */
type MarkShown = Pick<repo.AttendanceRow, 'status' | 'updatedAt'>;

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
  const [session, roster] = await Promise.allSettled([
    classes.getSession(ctx, access, sessionId),
    Promise.all([
      repo.listMarks(ctx, sessionId),
      studentsExpectedIn(ctx, classOfSession(ctx, sessionId)),
      Promise.all(namesFor(ctx, access, sessionId)),
    ]),
  ]);
  if (session.status === 'rejected') throw session.reason;
  if (roster.status === 'rejected') throw roster.reason;

  const [marks, expectedOn, names] = roster.value;
  return {
    session: session.value,
    marks: new Map(marks.map((mark) => [mark.studentId, mark])),
    /** Who is expected: the students whose active enrolment covers the session's date. */
    expected: expectedOn(session.value.date),
    names: new Map(names.flatMap((found) => [...found])),
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
  const { marks, expected, names } = await readSession(ctx, access, sessionId);
  return toAttendance(sessionId, expected, marks, names);
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
  const { session, marks, expected, names } = await readSession(ctx, access, sessionId);
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
  if (changed.length === 0) return toAttendance(sessionId, expected, marks, names);

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
  return toAttendance(sessionId, expected, marksNow, names);
}
