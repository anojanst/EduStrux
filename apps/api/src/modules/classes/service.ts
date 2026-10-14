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
import { closedFrom, termDates } from '../calendar/for-classes';
import * as calendar from '../calendar/service';
import { lessonLengths } from '../curriculum/for-classes';
import * as curriculum from '../curriculum/service';
import { timetableOf } from '../enrolment/for-classes';
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

// Every request here reads in one stage (D-102): what it needs goes to D1 together, and the
// checks run afterwards on what came back. Three things make that possible.
// - A read that needs something from a class's row gets it as a query, such as "this class's
//   term", written into its own statement (D-104).
// - A read of another module that answers 404 by throwing is sent with `hold`, and `take`
//   reports it later, in the order the checks have always run in. So the same error still wins
//   when several apply.
// - A write answers with the row its own statement returned, so nothing is read back.

type Held<T> = { value: T } | { error: unknown };

/** Sends a read now and keeps its answer, or the error it threw, for `take`. */
async function hold<T>(read: T): Promise<Held<Awaited<T>>> {
  try {
    return { value: await read };
  } catch (error) {
    return { error };
  }
}

/** The answer of a read sent with `hold`. Throws the error if that is what it got. */
function take<T>(held: Held<T>): T {
  if ('error' in held) throw held.error;
  return held.value;
}

const toSlot = (slot: ScheduleSlot): ScheduleSlot => ({
  weekday: slot.weekday,
  startTime: slot.startTime,
  endTime: slot.endTime,
});

export function toClass(row: repo.ClassRow, slots: ScheduleSlot[]): Class {
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

/** The org's timezone and the local date and time there right now. No trip in a request. */
async function orgClock(ctx: OrgCtx): Promise<{ now: LocalMoment; timezone: string }> {
  const { timezone } = await orgs.getOrg(ctx);
  const { date, time } = localNow(timezone);
  return { now: { date, time }, timezone };
}

const nameTaken = () =>
  conflict('This course already has a class with that name in this term and branch', {
    name: ['Taken'],
  });

/** The room must be in the class's branch. */
function checkRoom(room: { branchId: string }, branchId: string) {
  if (room.branchId !== branchId) {
    throw unprocessable("The room isn't in the class's branch.", { roomId: ['In another branch'] });
  }
}

/** Any active member of staff can teach, whatever their role: a solo tutor is the owner. */
function checkTeacher(member: Awaited<ReturnType<typeof orgs.findMember>>) {
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
  const reach = reachOf(ctx, access);
  const afterId = decodeCursor(cursor);
  // The page's weekly slots are read by a query for the ids on the page, not by the ids.
  const [branch, term, course, grade, teacher, rows, slots] = await Promise.all([
    hold(filter.branchId ? branches.getBranch(ctx, filter.branchId) : null),
    hold(filter.termId ? calendar.getTerm(ctx, filter.termId) : null),
    hold(filter.courseId ? curriculum.getCourse(ctx, filter.courseId) : null),
    hold(filter.gradeLevelId ? curriculum.getGradeLevel(ctx, filter.gradeLevelId) : null),
    filter.teacherId ? orgs.findMember(ctx, filter.teacherId) : null,
    repo.listClasses(ctx, limit, afterId, filter, reach),
    repo.listSlots(ctx, repo.classesOnPage(ctx, limit, afterId, filter, reach)),
  ]);
  take(branch);
  take(term);
  take(course);
  take(grade);
  if (filter.teacherId && !teacher) throw notFound('Teacher');

  const { data, nextCursor } = toPage(rows, limit);
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

/** One stage: the weekly slots are read by the id asked for, together with the class. */
export async function getClass(ctx: OrgCtx, access: Access, id: string): Promise<Class> {
  const [row, slots] = await Promise.all([
    repo.findClass(ctx, id, reachOf(ctx, access)),
    repo.listSlots(ctx, [id]),
  ]);
  if (!row) throw notFound('Class');
  return toClass(row, slots);
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
  const key = {
    courseId: input.courseId,
    termId: input.termId || null,
    branchId: input.branchId,
    name: input.name,
  };
  // Nothing here needs another's answer: the name check is on ids the request already gives.
  const [heldCourse, heldTerm, branch, room, teacher, taken] = await Promise.all([
    hold(curriculum.getCourse(ctx, input.courseId)),
    hold(key.termId ? calendar.getTerm(ctx, key.termId) : null),
    hold(branches.getBranch(ctx, input.branchId)),
    hold(input.roomId ? branches.getRoom(ctx, input.roomId) : null),
    input.teacherId ? orgs.findMember(ctx, input.teacherId) : undefined,
    repo.classNameTaken(ctx, key),
  ]);
  const course = take(heldCourse);
  const term = take(heldTerm);
  take(branch);
  if (access.scope !== 'all' && access.branchIds && !access.branchIds.includes(input.branchId)) {
    throw forbidden();
  }
  if (input.roomId) checkRoom(take(room)!, input.branchId);
  if (input.teacherId) checkTeacher(teacher);

  const dates = { startDate: input.startDate ?? null, endDate: input.endDate ?? null };
  checkDates(dates, term);
  if (taken) throw nameTaken();

  const row = await repo.insertClass(ctx, {
    id: newId('class'),
    orgId: ctx.orgId,
    ...key,
    gradeLevelId: course.gradeLevelId,
    roomId: input.roomId ?? null,
    teacherMembershipId: input.teacherId ?? null,
    capacity: input.capacity ?? null,
    ...dates,
  });
  return toClass(row, []);
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
  const { updatedAt, teacherId, ...rest } = input;
  const changes: repo.ClassChanges = { ...rest };
  if (teacherId !== undefined) changes.teacherMembershipId = teacherId;
  const { now } = await orgClock(ctx);

  // Dates in the request may move the class's sessions, so what that needs is read now, with
  // the class. Whether they differ from the stored dates is only known once the class is back.
  const datesGiven = 'startDate' in changes || 'endDate' in changes;
  const [before, slots, room, teacher, taken, generation] = await Promise.all([
    repo.findClass(ctx, id, reachOf(ctx, access)),
    repo.listSlots(ctx, [id]),
    hold(changes.roomId ? branches.getRoom(ctx, changes.roomId) : null),
    changes.teacherMembershipId ? orgs.findMember(ctx, changes.teacherMembershipId) : undefined,
    changes.name !== undefined ? repo.otherClassHasName(ctx, id, changes.name) : false,
    datesGiven ? readGeneration(ctx, id, now) : null,
  ]);
  if (!before) throw notFound('Class');
  if (before.updatedAt !== updatedAt) throw staleData();
  if (Object.keys(changes).length === 0) return toClass(before, slots);

  const after = { ...before, ...changes };
  if (changes.roomId) checkRoom(take(room)!, before.branchId);
  if (changes.teacherMembershipId) checkTeacher(teacher);
  const datesChanged = after.startDate !== before.startDate || after.endDate !== before.endDate;
  // Dates can only differ when the request gave some, so what moving sessions needs was read.
  const sessionsToPlan = datesChanged ? generation! : null;
  if (sessionsToPlan) checkDates(after, termOf(before, sessionsToPlan.terms));
  if (taken) throw nameTaken();

  const restaffed =
    after.roomId !== before.roomId || after.teacherMembershipId !== before.teacherMembershipId;
  const updated = await repo.updateClass(
    ctx,
    before,
    changes,
    sessionsToPlan || restaffed
      ? {
          from: now,
          restaff: restaffed
            ? { roomId: after.roomId, teacherMembershipId: after.teacherMembershipId }
            : undefined,
          plan: sessionsToPlan
            ? planSessions(ctx, after, slots.map(toSlot), now, sessionsToPlan).plan
            : undefined,
        }
      : undefined,
  );
  if (!updated) throw notFound('Class');
  return toClass(updated, slots);
}

/**
 * Deletes the class with its schedule and all its sessions. Refused while it has enrolments or
 * a price rule of its own.
 */
export async function deleteClass(ctx: OrgCtx, access: Access, id: string): Promise<void> {
  const [before, enrolmentCount, priceRuleCount] = await Promise.all([
    repo.findClass(ctx, id, reachOf(ctx, access)),
    enrolment.countEnrolments(ctx, { classId: id }),
    billing.countPriceRules(ctx, { classId: id }),
  ]);
  if (!before) throw notFound('Class');
  if (enrolmentCount > 0) {
    throw unprocessable(`This class has ${enrolmentCount} enrolment(s), so it can't be deleted.`);
  }
  if (priceRuleCount > 0) {
    throw unprocessable("Delete this class's price rule first.");
  }
  await repo.softDeleteClass(ctx, before);
}

// ── Schedule and session generation ─────────────────────────────────────────

/**
 * What working out a class's upcoming sessions reads: the dates of its term, the holidays that
 * close its branch from today on, and the sessions it has that haven't started.
 */
type Generation = {
  terms: (DateRange & { id: string })[];
  closed: DateRange[];
  existing: repo.SessionRow[];
};

/**
 * Reads them by the class's id alone, so they go to D1 together with the read of the class. The
 * class's term and branch are queries inside the calendar's statements (D-104).
 */
async function readGeneration(ctx: OrgCtx, classId: string, now: LocalMoment): Promise<Generation> {
  const [terms, closed, existing] = await Promise.all([
    termDates(ctx, repo.ofClass(ctx, classId, 'termId')),
    closedFrom(ctx, repo.ofClass(ctx, classId, 'branchId'), now.date),
    repo.upcomingSessions(ctx, classId, now),
  ]);
  return { terms, closed, existing };
}

/** The class's term among the terms read for it. A class whose term is gone is 404. */
function termOf(klass: Pick<repo.ClassRow, 'termId'>, terms: Generation['terms']) {
  if (!klass.termId) return null;
  const term = terms.find((t) => t.id === klass.termId);
  if (!term) throw notFound('Term');
  return term;
}

/**
 * The dates to generate sessions for, from today on: the class's term, narrowed by the class's
 * own dates, or the next OPEN_ENDED_HORIZON_DAYS for a class with no term. null = nothing left.
 */
function generationRange(klass: repo.ClassRow, term: DateRange | null, today: string) {
  const later = (a: string, b: string | null) => (b !== null && b > a ? b : a);
  const earlier = (a: string, b: string | null) => (b !== null && b < a ? b : a);
  let start: string;
  let end: string;
  if (term) {
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
function planSessions(
  ctx: OrgCtx,
  klass: repo.ClassRow,
  slots: ScheduleSlot[],
  now: LocalMoment,
  { terms, closed, existing }: Generation,
) {
  const range = generationRange(klass, termOf(klass, terms), now.date);
  // `closed` has every holiday from today on. One past the range closes no date inside it.
  const wanted = range
    ? occurrences(slots, range.from, range.to, closed).filter((lesson) => notStarted(lesson, now))
    : [];

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
  const { now } = await orgClock(ctx);
  const [klass, before, lengths, generation] = await Promise.all([
    repo.findClass(ctx, classId, reachOf(ctx, access)),
    repo.listSlots(ctx, [classId]),
    lessonLengths(ctx, repo.ofClass(ctx, classId, 'courseId')),
    readGeneration(ctx, classId, now),
  ]);
  if (!klass) throw notFound('Class');
  const course = lengths.find((c) => c.id === klass.courseId);
  if (!course) throw notFound('Course');
  const resolved = resolveSlots(input.slots, course.durationMinutes);
  if ('errors' in resolved) throw validationFailed(resolved.errors);
  const { slots } = resolved;

  const slotsChanged = JSON.stringify(before.map(toSlot)) !== JSON.stringify(slots);
  const { plan, kept, through } = planSessions(ctx, klass, slots, now, generation);

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
  // The write leaves the class's own row as it was read, and its slots are now the ones saved.
  return {
    class: toClass(klass, slotsChanged ? slots : before),
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
  query: Omit<repo.SessionFilter, 'enrolled'> & { studentId?: string; enrolledStudents?: Ids },
) {
  const reach = reachOf(ctx, access);
  const { studentId, enrolledStudents, ...filter } = query;
  const { timezone } = await orgClock(ctx);
  // A student's timetable is their classes' sessions, on the dates each enrolment covers. Some
  // students' (a parent's children, D-126) is the sessions any of them is enrolled for, and a
  // `studentId` among them picks theirs. The enrolments are a query inside the read of the
  // sessions, so that read doesn't wait for them.
  const timetableFor = studentId ?? enrolledStudents;
  const enrolled = timetableFor ? timetableOf(ctx, timetableFor) : undefined;
  const [branch, room, grade, klass, teacher, student, rows] = await Promise.all([
    hold(filter.branchId ? branches.getBranch(ctx, filter.branchId) : null),
    hold(filter.roomId ? branches.getRoom(ctx, filter.roomId) : null),
    hold(filter.gradeLevelId ? curriculum.getGradeLevel(ctx, filter.gradeLevelId) : null),
    filter.classId ? repo.findClass(ctx, filter.classId, reach) : null,
    filter.teacherId ? orgs.findMember(ctx, filter.teacherId) : null,
    hold(studentId ? people.getStudent(ctx, access, studentId) : null),
    repo.listSessions(ctx, limit, decodeDateTimeCursor(cursor), { ...filter, enrolled }, reach),
  ]);
  take(branch);
  take(room);
  take(grade);
  if (filter.classId && !klass) throw notFound('Class');
  if (filter.teacherId && !teacher) throw notFound('Teacher');
  take(student);

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
