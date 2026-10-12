import {
  localNow,
  newId,
  normaliseName,
  type AttendanceRecord,
  type MarkAttendance,
  type Session,
  type SessionAttendance,
} from '@edustrux/shared';
import type { Access, OrgCtx } from '../../db/scope';
import { unprocessable } from '../../lib/errors';
import * as classes from '../classes/service';
import * as enrolment from '../enrolment/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';
import * as repo from './repository';

/**
 * The session's roster as the caller may see it, by last name, then first name, then id. Who is
 * expected is the students whose active enrolment covers the session's date; anyone already
 * marked stays on it whatever became of their enrolment. A parent sees their own children only.
 */
async function loadAttendance(
  ctx: OrgCtx,
  access: Access,
  session: Session,
): Promise<SessionAttendance> {
  const [expected, marks] = await Promise.all([
    enrolment.studentIdsExpected(ctx, session.classId, session.date),
    repo.listMarks(ctx, session.id),
  ]);
  const marked = new Map(marks.map((mark) => [mark.studentId, mark]));
  let studentIds = [...new Set([...expected, ...marked.keys()])];
  if (access.scope === 'own' && access.role === 'parent') {
    const children = new Set(await people.studentIdsOfGuardian(ctx, access.membershipId));
    studentIds = studentIds.filter((id) => children.has(id));
  }

  const names = await people.studentNames(ctx, studentIds);
  const records = studentIds.flatMap((studentId): (AttendanceRecord & { key: string })[] => {
    const name = names.get(studentId);
    if (!name) return [];
    const mark = marked.get(studentId);
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
  return { sessionId: session.id, records: records.map(({ key: _key, ...record }) => record) };
}

/** A session outside the caller's reach is 404, as for the session itself. */
export async function getAttendance(
  ctx: OrgCtx,
  access: Access,
  sessionId: string,
): Promise<SessionAttendance> {
  return loadAttendance(ctx, access, await classes.getSession(ctx, access, sessionId));
}

/**
 * Marks the students in `input` and leaves everyone else as they are. A session can be marked
 * from its own day on, so not while the generator or a new holiday could still remove it days
 * ahead, and not once it is cancelled. Only the students on its roster can be marked: those
 * expected at it, and anyone already marked.
 */
export async function markAttendance(
  ctx: OrgCtx,
  access: Access,
  sessionId: string,
  input: MarkAttendance,
): Promise<SessionAttendance> {
  const session = await classes.getSession(ctx, access, sessionId);
  if (session.status === 'cancelled') {
    throw unprocessable("This session is cancelled, so attendance can't be marked.");
  }
  const { timezone } = await orgs.getOrg(ctx);
  if (session.date > localNow(timezone).date) {
    throw unprocessable(
      `Attendance can be marked from the day of the session, ${session.date}, not before.`,
    );
  }

  const [expected, marks] = await Promise.all([
    enrolment.studentIdsExpected(ctx, session.classId, session.date),
    repo.listMarks(ctx, sessionId),
  ]);
  const marked = new Map(marks.map((mark) => [mark.studentId, mark]));
  const onRoster = new Set([...expected, ...marked.keys()]);
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
    (record) => (marked.get(record.studentId)?.status ?? null) !== record.status,
  );
  if (changed.length > 0) {
    await repo.saveMarks(
      ctx,
      sessionId,
      changed.flatMap(({ studentId, status }) =>
        status === null
          ? []
          : [{ id: newId('attendance'), orgId: ctx.orgId, sessionId, studentId, status }],
      ),
      changed.flatMap((record) =>
        record.status === null ? [marked.get(record.studentId)!.id] : [],
      ),
      {
        before: changed.map(({ studentId }) => ({
          studentId,
          status: marked.get(studentId)?.status ?? null,
        })),
        after: changed.map(({ studentId, status }) => ({ studentId, status })),
      },
    );
  }
  return loadAttendance(ctx, access, session);
}
