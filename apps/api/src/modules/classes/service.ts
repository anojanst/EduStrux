import {
  OPEN_ENDED_HORIZON_DAYS,
  addDays,
  localNow,
  localToUtc,
  newId,
  type Class,
  type CreateClass,
  type ScheduleResult,
  type ScheduleSlot,
  type Session,
  type SetSchedule,
  type UpdateClass,
} from '@edustrux/shared';
import type { Access, IdQuery, Ids, OrgCtx } from '../../db/scope';
import {
  conflict,
  forbidden,
  notFound,
  staleData,
  unprocessable,
  validationFailed,
} from '../../lib/errors';
import { byDateTime, decodeCursor, decodeDateTimeCursor, toPage } from '../../lib/pagination';
import * as billing from '../billing/service';
import * as branches from '../branches/service';
import * as calendar from '../calendar/service';
import * as curriculum from '../curriculum/service';
import * as enrolment from '../enrolment/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';
import * as repo from './repository';
import {
  notStarted,
  occurrences,
  resolveSlots,
  type DateRange,
  type LocalMoment,
} from './schedule';

const toSlot = (row: repo.SlotRow): ScheduleSlot => ({
  weekday: row.weekday,
  startTime: row.startTime,
  endTime: row.endTime,
});

export function toClass(row: repo.ClassRow, slots: repo.SlotRow[]): Class {
  const { orgId: _org, deletedAt: _deleted, teacherMembershipId, ...klass } = row;
  return { ...klass, teacherId: teacherMembershipId, schedule: slots.map(toSlot) };
}

type SessionWithClass = NonNullable<Awaited<ReturnType<typeof repo.findSession>>>;

/** The UTC instants come from the local date and times in the org's timezone, at read time. */
export function toSession(row: SessionWithClass, timezone: string): Session {
  const { orgId: _org, deletedAt: _deleted, teacherMembershipId, ...session } = row.session;
  return {
    ...session,
    className: row.className,
    courseId: row.courseId,
    branchId: row.branchId,
    teacherId: teacherMembershipId,
    startsAt: localToUtc(session.date, session.startTime, timezone),
    endsAt: localToUtc(session.date, session.endTime, timezone),
  };
}

/**
 * A role's scope as a filter on classes. Branch staff reach the classes in their branches, a
 * teacher the classes they teach, and a parent the classes their children are enrolled in. It
 * costs no database trip: a parent's classes are a query, not a list read first (D-104).
 */
function reachOf(ctx: OrgCtx, access: Access): repo.Reach {
  switch (access.scope) {
    case 'all':
      return {};
    case 'branch':
      return access.branchIds ? { branchIds: access.branchIds } : {};
    case 'own':
      return access.role === 'teacher'
        ? { teacherMembershipId: access.membershipId }
        : { classIds: enrolment.classesOfChildren(ctx, access.membershipId) };
  }
}

async function findClassOr404(ctx: OrgCtx, id: string, reach: repo.Reach) {
  const row = await repo.findClass(ctx, id, reach);
  if (!row) throw notFound('Class');
  return row;
}

/** The org's timezone and the local date and time there right now. */
async function orgClock(ctx: OrgCtx): Promise<{ now: LocalMoment; timezone: string }> {
  const { timezone } = await orgs.getOrg(ctx);
  const { date, time } = localNow(timezone);
  return { now: { date, time }, timezone };
}

const nameTaken = () =>
  conflict('This course already has a class with that name in this term and branch', {
    name: ['Taken'],
  });

/** The room must exist and be in the class's branch. */
async function checkRoom(ctx: OrgCtx, roomId: string, branchId: string) {
  const room = await branches.getRoom(ctx, roomId);
  if (room.branchId !== branchId) {
    throw unprocessable("The room isn't in the class's branch.", { roomId: ['In another branch'] });
  }
}

/** Any active member of staff can teach, whatever their role: a solo tutor is the owner. */
async function checkTeacher(ctx: OrgCtx, teacherId: string) {
  const member = await orgs.findMember(ctx, teacherId);
  if (!member) throw notFound('Teacher');
  if (member.role === 'parent' || member.status !== 'active') {
    throw unprocessable('Only active staff can teach a class.', {
      teacherId: ['Not active staff'],
    });
  }
}

/**
 * In a term, the class's own dates are optional and must fall inside it. Without a term the
 * class needs a start date. An end date can't be before the start date.
 */
function checkDates(
  dates: { startDate: string | null; endDate: string | null },
  term: DateRange | null,
) {
  const { startDate, endDate } = dates;
  if (!term && startDate === null) {
    throw validationFailed({ startDate: ['Required when the class has no term'] });
  }
  if (startDate !== null && endDate !== null && endDate < startDate) {
    throw validationFailed({ endDate: ['Must be on or after startDate'] });
  }
  if (!term) return;
  const outside = (date: string | null) =>
    date !== null && (date < term.startDate || date > term.endDate);
  const fields: Record<string, string[]> = {};
  if (outside(startDate)) fields.startDate = ['Outside the term'];
  if (outside(endDate)) fields.endDate = ['Outside the term'];
  if (Object.keys(fields).length > 0) {
    throw unprocessable(
      `A class's dates must fall inside its term, ${term.startDate} to ${term.endDate}.`,
      fields,
    );
  }
}

// ── Classes ─────────────────────────────────────────────────────────────────

export async function listClasses(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  filter: repo.ClassFilter,
) {
  if (filter.branchId) await branches.getBranch(ctx, filter.branchId);
  if (filter.termId) await calendar.getTerm(ctx, filter.termId);
  if (filter.courseId) await curriculum.getCourse(ctx, filter.courseId);
  if (filter.gradeLevelId) await curriculum.getGradeLevel(ctx, filter.gradeLevelId);
  if (filter.teacherId && !(await orgs.findMember(ctx, filter.teacherId))) {
    throw notFound('Teacher');
  }

  const rows = await repo.listClasses(
    ctx,
    limit,
    decodeCursor(cursor),
    filter,
    reachOf(ctx, access),
  );
  const { data, nextCursor } = toPage(rows, limit);
  const slots = data.length
    ? await repo.listSlots(
        ctx,
        data.map((c) => c.id),
      )
    : [];
  return {
    data: data.map((c) =>
      toClass(
        c,
        slots.filter((s) => s.classId === c.id),
      ),
    ),
    nextCursor,
  };
}

export async function getClass(ctx: OrgCtx, access: Access, id: string): Promise<Class> {
  const row = await findClassOr404(ctx, id, reachOf(ctx, access));
  return toClass(row, await repo.listSlots(ctx, [id]));
}

// Who a caller reaches, for other modules to filter by. Each is a query for ids, written into
// the statement it filters: no database trip (D-104).

/** The classes in these branches. Wide: a share of the org. */
export function classesInBranches(ctx: OrgCtx, branchIds: string[]): IdQuery {
  return repo.classesWithin(ctx, { branchIds });
}

/** The classes this member teaches. */
export function classesTaughtBy(ctx: OrgCtx, teacherMembershipId: string): IdQuery {
  return repo.classesWithin(ctx, { teacherMembershipId });
}

/**
 * What a record that points at a class shows of it, by class id, whoever is asking. `ids` can
 * be a query: the labels of whatever another read returns, in the same stage.
 */
export async function classLabels(ctx: OrgCtx, ids: Ids) {
  return new Map((await repo.classLabels(ctx, ids)).map(({ id, ...label }) => [id, label]));
}

/**
 * The classes one invoice run bills: a term's classes, or the classes with no term that run at
 * some point in the dates given.
 */
export function classesBilledIn(ctx: OrgCtx, period: { termId: string } | DateRange) {
  return repo.classesBilledIn(ctx, period);
}

/**
 * Each class's lesson dates in the range, in order, by class id: the lessons it holds, so not
 * the cancelled ones. A class with no lessons there isn't in the map.
 */
export async function lessonDates(ctx: OrgCtx, classIds: Ids, range: DateRange) {
  const dates = new Map<string, string[]>();
  for (const { classId, date } of await repo.lessonDates(ctx, classIds, range)) {
    const list = dates.get(classId);
    if (list) list.push(date);
    else dates.set(classId, [date]);
  }
  return dates;
}

/**
 * The first and last day a class runs: its own dates, else its term's. A null end means until
 * further notice, which only a class with no term can have.
 */
export async function classDates(
  ctx: OrgCtx,
  klass: Pick<Class, 'termId' | 'startDate' | 'endDate'>,
) {
  const term = klass.termId ? await calendar.getTerm(ctx, klass.termId) : null;
  return {
    startDate: klass.startDate ?? term?.startDate ?? null,
    endDate: klass.endDate ?? term?.endDate ?? null,
  };
}

/** How many classes use a course, term, branch or room. None can be deleted while any do. */
export function countClasses(
  ctx: OrgCtx,
  filter: Pick<repo.ClassFilter, 'courseId' | 'termId' | 'branchId' | 'roomId'>,
) {
  return repo.countClasses(ctx, filter);
}

/** Branch staff can only add a class in one of their own branches. */
export async function createClass(ctx: OrgCtx, access: Access, input: CreateClass): Promise<Class> {
  const course = await curriculum.getCourse(ctx, input.courseId);
  const term = input.termId ? await calendar.getTerm(ctx, input.termId) : null;
  await branches.getBranch(ctx, input.branchId);
  if (access.scope !== 'all' && access.branchIds && !access.branchIds.includes(input.branchId)) {
    throw forbidden();
  }
  if (input.roomId) await checkRoom(ctx, input.roomId, input.branchId);
  if (input.teacherId) await checkTeacher(ctx, input.teacherId);

  const dates = { startDate: input.startDate ?? null, endDate: input.endDate ?? null };
  checkDates(dates, term);
  const key = {
    courseId: course.id,
    termId: term?.id ?? null,
    branchId: input.branchId,
    name: input.name,
  };
  if (await repo.classNameTaken(ctx, key)) throw nameTaken();

  const id = newId('class');
  await repo.insertClass(ctx, {
    id,
    orgId: ctx.orgId,
    ...key,
    gradeLevelId: course.gradeLevelId,
    roomId: input.roomId ?? null,
    teacherMembershipId: input.teacherId ?? null,
    capacity: input.capacity ?? null,
    ...dates,
  });
  return getClass(ctx, access, id);
}

/**
 * A class keeps its course, term and branch. A new room or teacher also goes onto its upcoming
 * sessions, and new dates add and remove upcoming sessions; ones that have started never change.
 */
export async function updateClass(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdateClass,
): Promise<Class> {
  const before = await findClassOr404(ctx, id, reachOf(ctx, access));
  if (before.updatedAt !== input.updatedAt) throw staleData();

  const { updatedAt: _ignored, teacherId, ...rest } = input;
  const changes: repo.ClassChanges = { ...rest };
  if (teacherId !== undefined) changes.teacherMembershipId = teacherId;
  if (Object.keys(changes).length === 0) return getClass(ctx, access, id);

  const after = { ...before, ...changes };
  if (changes.roomId) await checkRoom(ctx, changes.roomId, before.branchId);
  if (changes.teacherMembershipId) await checkTeacher(ctx, changes.teacherMembershipId);
  const datesChanged = after.startDate !== before.startDate || after.endDate !== before.endDate;
  if (datesChanged) {
    checkDates(after, before.termId ? await calendar.getTerm(ctx, before.termId) : null);
  }
  if (changes.name !== undefined && (await repo.classNameTaken(ctx, after, id))) throw nameTaken();

  const restaffed =
    after.roomId !== before.roomId || after.teacherMembershipId !== before.teacherMembershipId;
  if (!datesChanged && !restaffed) {
    await repo.updateClass(ctx, before, changes);
    return getClass(ctx, access, id);
  }

  const { now } = await orgClock(ctx);
  const slots = datesChanged ? (await repo.listSlots(ctx, [id])).map(toSlot) : [];
  await repo.updateClass(ctx, before, changes, {
    from: now,
    restaff: restaffed
      ? { roomId: after.roomId, teacherMembershipId: after.teacherMembershipId }
      : undefined,
    plan: datesChanged ? (await planSessions(ctx, after, slots, now)).plan : undefined,
  });
  return getClass(ctx, access, id);
}

/**
 * Deletes the class with its schedule and all its sessions. Refused while it has enrolments or
 * a price rule of its own.
 */
export async function deleteClass(ctx: OrgCtx, access: Access, id: string): Promise<void> {
  const before = await findClassOr404(ctx, id, reachOf(ctx, access));
  const enrolmentCount = await enrolment.countEnrolments(ctx, { classId: id });
  if (enrolmentCount > 0) {
    throw unprocessable(`This class has ${enrolmentCount} enrolment(s), so it can't be deleted.`);
  }
  if ((await billing.countPriceRules(ctx, { classId: id })) > 0) {
    throw unprocessable("Delete this class's price rule first.");
  }
  await repo.softDeleteClass(ctx, before);
}

// ── Schedule and session generation ─────────────────────────────────────────

/**
 * The dates to generate sessions for, from today on: the class's term, narrowed by the class's
 * own dates, or the next OPEN_ENDED_HORIZON_DAYS for a class with no term. null = nothing left.
 */
async function generationRange(ctx: OrgCtx, klass: repo.ClassRow, today: string) {
  const later = (a: string, b: string | null) => (b !== null && b > a ? b : a);
  const earlier = (a: string, b: string | null) => (b !== null && b < a ? b : a);
  let start: string;
  let end: string;
  if (klass.termId) {
    const term = await calendar.getTerm(ctx, klass.termId);
    start = later(term.startDate, klass.startDate);
    end = earlier(term.endDate, klass.endDate);
  } else {
    if (klass.startDate === null) return null;
    start = klass.startDate;
    end = earlier(addDays(today, OPEN_ENDED_HORIZON_DAYS), klass.endDate);
  }
  const from = later(start, today);
  return from <= end ? { from, to: end } : null;
}

/**
 * Works out which upcoming sessions to add and remove so they match the weekly slots. Only
 * sessions that haven't started are considered, and only ones still `scheduled` are removed. A
 * session that already matches is kept, so saving the same schedule twice changes nothing, and
 * so does anything attached to it. Dates closed by a holiday get no session.
 */
async function planSessions(
  ctx: OrgCtx,
  klass: repo.ClassRow,
  slots: ScheduleSlot[],
  now: LocalMoment,
) {
  const range = await generationRange(ctx, klass, now.date);
  const closed =
    range && slots.length
      ? await calendar.closedRanges(ctx, klass.branchId, range.from, range.to)
      : [];
  const wanted = range
    ? occurrences(slots, range.from, range.to, closed).filter((lesson) => notStarted(lesson, now))
    : [];
  const existing = await repo.upcomingSessions(ctx, klass.id, now);

  const key = (s: { date: string; startTime: string }) => `${s.date} ${s.startTime}`;
  const current = new Map(existing.map((s) => [key(s), s]));
  const wantedKeys = new Set(wanted.map(key));
  const plan: repo.SessionPlan = { add: [], removeIds: [] };
  let kept = 0;

  for (const lesson of wanted) {
    const match = current.get(key(lesson));
    if (match && match.status !== 'scheduled') continue;
    if (match && match.endTime === lesson.endTime) {
      kept++;
      continue;
    }
    if (match) plan.removeIds.push(match.id);
    plan.add.push({
      id: newId('session'),
      orgId: ctx.orgId,
      classId: klass.id,
      roomId: klass.roomId,
      teacherMembershipId: klass.teacherMembershipId,
      ...lesson,
      status: 'scheduled',
    });
  }
  for (const session of existing) {
    if (session.status === 'scheduled' && !wantedKeys.has(key(session))) {
      plan.removeIds.push(session.id);
    }
  }
  return { plan, kept, through: range?.to ?? null };
}

/**
 * Replaces the class's weekly slots and brings its upcoming sessions in line with them. Saving
 * the same slots again is how staff pick up a deleted holiday or extend an open-ended class.
 */
export async function setSchedule(
  ctx: OrgCtx,
  access: Access,
  classId: string,
  input: SetSchedule,
): Promise<ScheduleResult> {
  const klass = await findClassOr404(ctx, classId, reachOf(ctx, access));
  const course = await curriculum.getCourse(ctx, klass.courseId);
  const resolved = resolveSlots(input.slots, course.durationMinutes);
  if ('errors' in resolved) throw validationFailed(resolved.errors);
  const { slots } = resolved;

  const before = await repo.listSlots(ctx, [classId]);
  const slotsChanged = JSON.stringify(before.map(toSlot)) !== JSON.stringify(slots);
  const { now } = await orgClock(ctx);
  const { plan, kept, through } = await planSessions(ctx, klass, slots, now);

  if (slotsChanged || plan.add.length > 0 || plan.removeIds.length > 0) {
    await repo.setSchedule(
      ctx,
      classId,
      before,
      slotsChanged
        ? slots.map((slot) => ({
            id: newId('classSchedule'),
            orgId: ctx.orgId,
            classId,
            ...slot,
          }))
        : null,
      plan,
    );
  }
  return {
    class: await getClass(ctx, access, classId),
    sessions: { added: plan.add.length, removed: plan.removeIds.length, kept, through },
  };
}

/**
 * What a new holiday does to sessions already generated: the count of scheduled sessions it
 * closes that haven't started, and the statement that removes them, for the holiday's own batch.
 */
export async function sessionsClosedBy(
  ctx: OrgCtx,
  holiday: DateRange & { branchId: string | null },
) {
  const { now } = await orgClock(ctx);
  const count = await repo.countSessionsClosedBy(ctx, holiday, now);
  return { count, statements: count > 0 ? [repo.removeSessionsClosedBy(ctx, holiday, now)] : [] };
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function listSessions(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  query: Omit<repo.SessionFilter, 'spans'> & { studentId?: string },
) {
  const reach = reachOf(ctx, access);
  const { studentId, ...filter } = query;
  if (filter.branchId) await branches.getBranch(ctx, filter.branchId);
  if (filter.roomId) await branches.getRoom(ctx, filter.roomId);
  if (filter.gradeLevelId) await curriculum.getGradeLevel(ctx, filter.gradeLevelId);
  if (filter.classId) await findClassOr404(ctx, filter.classId, reach);
  if (filter.teacherId && !(await orgs.findMember(ctx, filter.teacherId))) {
    throw notFound('Teacher');
  }
  // A student's timetable: their classes' sessions, on the dates each enrolment covers.
  let spans: repo.EnrolledSpan[] | undefined;
  if (studentId) {
    await people.getStudent(ctx, access, studentId);
    spans = await enrolment.spansOf(ctx, studentId);
  }

  const { timezone } = await orgClock(ctx);
  const rows = await repo.listSessions(
    ctx,
    limit,
    decodeDateTimeCursor(cursor),
    { ...filter, spans },
    reach,
  );
  const { data, nextCursor } = toPage(
    rows.map((row) => ({ ...row, id: row.session.id })),
    limit,
    (row) => byDateTime(row.session),
  );
  return { data: data.map((row) => toSession(row, timezone)), nextCursor };
}

export async function getSession(ctx: OrgCtx, access: Access, id: string): Promise<Session> {
  const row = await repo.findSession(ctx, id, reachOf(ctx, access));
  if (!row) throw notFound('Session');
  const { timezone } = await orgClock(ctx);
  return toSession(row, timezone);
}
