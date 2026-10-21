import { enrolments } from '@edustrux/db';
import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { firstIds, idsFrom, type Access, type OrgCtx } from '../src/db/scope';
import type { OrgRow } from '../src/env';
import * as attendance from '../src/modules/attendance/repository';
import * as billing from '../src/modules/billing/repository';
import * as branches from '../src/modules/branches/repository';
import { currentAcademicYear } from '../src/modules/calendar/for-people';
import { classOfSession, dateOfSession } from '../src/modules/classes/for-attendance';
import * as classes from '../src/modules/classes/repository';
import * as classesService from '../src/modules/classes/service';
import * as curriculum from '../src/modules/curriculum/repository';
import { studentsExpectedIn } from '../src/modules/enrolment/for-attendance';
import * as enrolment from '../src/modules/enrolment/repository';
import * as enrolmentService from '../src/modules/enrolment/service';
import * as learning from '../src/modules/learning/repository';
import { termDates } from '../src/modules/calendar/for-classes';
import { lessonLengths } from '../src/modules/curriculum/for-classes';
import { timetableOf } from '../src/modules/enrolment/for-classes';
import * as people from '../src/modules/people/repository';
import * as staff from '../src/modules/staff/repository';
import * as peopleService from '../src/modules/people/service';
import { classDatesOf } from '../src/modules/classes/for-enrolment';
import { planOf, READS_AN_ORG, searchBy, searchIn, SORT, type Send } from './query-plans';

// D1 counts and bills the rows a statement reads, and production has no table statistics to
// steer SQLite. These tests take the plan of the statements the repositories really send, on the
// database the migrations build, and fail when one would read a whole centre again.
//
// To cover another statement, add a row to the table it belongs in.

const IDS = ['id_a', 'id_b'];
const RANGE = { startDate: '2026-01-01', endDate: '2026-03-31' };
/** Tables in a plan, each with the column it must be reached by. */
type Reached = [table: string, column: string][];

describe('a lookup by a list of ids goes to the ids (D-100)', () => {
  // What is looked up, the table, the column the ids are in, and the call that sends it.
  const lookups: [string, string, string, Send][] = [
    ['students by id', 'students', 'id', (ctx) => people.studentNames(ctx, IDS)],
    [
      'students by id, for their families',
      'students',
      'id',
      (ctx) => people.studentFamilies(ctx, IDS),
    ],
    ['classes by id', 'classes', 'id', (ctx) => classes.classLabels(ctx, IDS)],
    ['families by id', 'families', 'id', (ctx) => people.familyLabels(ctx, IDS)],
    ['courses by id', 'courses', 'id', (ctx) => curriculum.defaultPrices(ctx, IDS)],
    [
      'sessions by id, in an update',
      'sessions',
      'id',
      (ctx) => classes.setSchedule(ctx, 'cls_a', [], null, { add: [], removeIds: IDS }),
    ],
    [
      'attendance by id, in an update',
      'attendance',
      'id',
      (ctx) => attendance.saveMarks(ctx, 'ses_a', [], IDS, { before: [], after: [] }),
    ],
    [
      'enrolments by class, to invoice',
      'enrolments',
      'class_id',
      (ctx) => enrolment.activeDuring(ctx, IDS, RANGE),
    ],
    [
      'students by family',
      'students',
      'family_id',
      (ctx) => people.studentsOfFamilies(ctx, IDS, {}),
    ],
    ['guardians by family', 'guardians', 'family_id', (ctx) => people.listGuardians(ctx, IDS)],
    ['grades by student', 'student_grades', 'student_id', (ctx) => people.listGrades(ctx, IDS)],
    ['weekly slots by class', 'class_schedules', 'class_id', (ctx) => classes.listSlots(ctx, IDS)],
    ['sessions by class', 'sessions', 'class_id', (ctx) => classes.lessonDates(ctx, IDS, RANGE)],
    [
      'invoice lines by invoice',
      'invoice_lines',
      'invoice_id',
      (ctx) => billing.listLines(ctx, IDS),
    ],
    [
      'invoice lines by enrolment',
      'invoice_lines',
      'enrolment_id',
      (ctx) => billing.linesInvoiced(ctx, IDS),
    ],
    // A caller limited to their own records: the list is their reach, and the page is read from it.
    [
      'the students a teacher reaches',
      'students',
      'id',
      (ctx) => people.listStudents(ctx, 50, undefined, {}, { studentIds: IDS }),
    ],
    [
      'the family of a student a teacher reaches',
      'students',
      'id',
      (ctx) => people.findFamily(ctx, 'fam_a', { studentIds: IDS }),
    ],
    [
      'the enrolments a teacher reaches',
      'enrolments',
      'class_id',
      (ctx) => enrolment.listEnrolments(ctx, 50, undefined, {}, { classIds: IDS }),
    ],
    [
      'the enrolments a parent reaches',
      'enrolments',
      'student_id',
      (ctx) => enrolment.listEnrolments(ctx, 50, undefined, {}, { studentIds: IDS }),
    ],
    [
      'the invoices a parent reaches',
      'invoices',
      'family_id',
      (ctx) => billing.listInvoices(ctx, 50, undefined, {}, { familyIds: IDS, issuedOnly: true }),
    ],
    [
      'the invoices of a branch',
      'invoices',
      'family_id',
      (ctx) => billing.listInvoices(ctx, 50, undefined, { familyIds: IDS }, {}),
    ],
    [
      'the classes branch staff reach',
      'classes',
      'branch_id',
      (ctx) => classes.listClasses(ctx, 50, undefined, {}, { branchIds: IDS }),
    ],
    [
      'the classes a parent reaches',
      'classes',
      'id',
      (ctx) => classes.listClasses(ctx, 50, undefined, {}, { classIds: IDS }),
    ],
  ];

  it.each(lookups)('%s', async (_what, table, column, send) => {
    expect(await planOf(send)).toMatch(searchBy(table, column));
  });

  it('reads one class’s enrolments to find who is expected at a lesson', async () => {
    const plan = await planOf((ctx) => enrolment.activeStudentIdsOn(ctx, 'cls_a', '2026-02-01'));
    expect(plan).toMatch(searchBy('enrolments', 'class_id'));
  });
});

describe('a lookup by a query for ids goes to the ids at every level (D-104)', () => {
  const MEMBER = 'mem_a';
  const taught = (ctx: OrgCtx) => enrolmentService.studentsTaughtBy(ctx, MEMBER);
  const children = (ctx: OrgCtx) => peopleService.studentsOfGuardian(ctx, MEMBER);
  const childrensClasses = (ctx: OrgCtx) => enrolmentService.classesOfChildren(ctx, MEMBER);
  const parentsOwn = (ctx: OrgCtx) => people.familiesWithin(ctx, { guardianMembershipId: MEMBER });
  const WEEK = { from: '2026-02-01', to: '2026-02-07' };

  // Each level of a reach, as the table it reads and the column it must be reached by.
  const teachersClasses: Reached = [['classes', 'teacher_membership_id']];
  const teachersStudents: Reached = [['enrolments', 'class_id'], ...teachersClasses];
  const parentsFamilies: Reached = [
    ['families', 'id'],
    ['guardians', 'membership_id'],
  ];
  const parentsStudents: Reached = [['students', 'family_id'], ...parentsFamilies];
  const parentsClasses: Reached = [['enrolments', 'student_id'], ...parentsStudents];

  // What is looked up, the call that sends it, and every table in it with its column.
  const lookups: [string, Send, Reached][] = [
    [
      'students by id, from the enrolments in some classes',
      (ctx) => people.studentNames(ctx, enrolment.activeStudents(ctx, IDS)),
      [
        ['students', 'id'],
        ['enrolments', 'class_id'],
      ],
    ],
    [
      'classes by id, from the enrolments of some students',
      (ctx) => classes.classLabels(ctx, enrolment.activeClasses(ctx, IDS)),
      [
        ['classes', 'id'],
        ['enrolments', 'student_id'],
      ],
    ],
    [
      'grades by student, from the enrolments in some classes',
      (ctx) => people.listGrades(ctx, enrolment.activeStudents(ctx, IDS)),
      [
        ['student_grades', 'student_id'],
        ['enrolments', 'class_id'],
      ],
    ],
    [
      'the names of a teacher’s students: two levels',
      (ctx) => people.studentNames(ctx, taught(ctx)),
      [['students', 'id'], ...teachersStudents],
    ],
    [
      'the students a teacher reaches',
      (ctx) => people.listStudents(ctx, 50, undefined, {}, { studentIds: taught(ctx) }),
      [['students', 'id'], ...teachersStudents],
    ],
    [
      'the families a teacher reaches',
      (ctx) => people.listFamilies(ctx, 50, undefined, {}, { studentIds: taught(ctx) }),
      [['families', 'id'], ['students', 'id'], ...teachersStudents],
    ],
    [
      'the families a parent reaches',
      (ctx) => people.listFamilies(ctx, 50, undefined, {}, { guardianMembershipId: MEMBER }),
      parentsFamilies,
    ],
    [
      'the students a parent reaches',
      (ctx) => people.listStudents(ctx, 50, undefined, {}, { guardianMembershipId: MEMBER }),
      [
        ['students', 'family_id'],
        ['guardians', 'membership_id'],
      ],
    ],
    [
      'the enrolments a teacher reaches',
      (ctx) =>
        enrolment.listEnrolments(
          ctx,
          50,
          undefined,
          {},
          { classIds: classesService.classesTaughtBy(ctx, MEMBER) },
        ),
      teachersStudents,
    ],
    [
      'the enrolments a parent reaches: three levels',
      (ctx) => enrolment.listEnrolments(ctx, 50, undefined, {}, { studentIds: children(ctx) }),
      parentsClasses,
    ],
    [
      'the classes a parent reaches: four levels',
      (ctx) => classes.listClasses(ctx, 50, undefined, {}, { classIds: childrensClasses(ctx) }),
      [['classes', 'id'], ...parentsClasses],
    ],
    [
      'the sessions a teacher reaches',
      (ctx) => classes.listSessions(ctx, 50, undefined, WEEK, { teacherMembershipId: MEMBER }),
      [['sessions', 'class_id'], ...teachersClasses],
    ],
    [
      'the sessions a parent reaches',
      (ctx) => classes.listSessions(ctx, 50, undefined, WEEK, { classIds: childrensClasses(ctx) }),
      [['sessions', 'class_id'], ['classes', 'id'], ...parentsClasses],
    ],
    [
      'the sessions on a student’s timetable',
      (ctx) =>
        classes.listSessions(
          ctx,
          50,
          undefined,
          { ...WEEK, enrolled: timetableOf(ctx, 'stu_a') },
          {},
        ),
      [
        ['sessions', 'class_id'],
        ['enrolments', 'student_id'],
        ['classes', 'id'],
      ],
    ],
    [
      'the sessions on a parent’s children’s timetable',
      (ctx) =>
        classes.listSessions(
          ctx,
          50,
          undefined,
          { ...WEEK, enrolled: timetableOf(ctx, children(ctx)) },
          { classIds: childrensClasses(ctx) },
        ),
      [['sessions', 'class_id'], ['classes', 'id'], ...parentsClasses],
    ],
    [
      'the active enrolments of a parent’s children',
      (ctx) => enrolment.activeOf(ctx, children(ctx)),
      parentsClasses,
    ],
    [
      'the students of a parent’s families',
      (ctx) => people.studentsOfFamilies(ctx, parentsOwn(ctx), {}),
      parentsStudents,
    ],
    [
      'the names of a parent’s families',
      (ctx) => people.familyLabels(ctx, parentsOwn(ctx)),
      parentsFamilies,
    ],
    [
      'the grades of a parent’s children',
      (ctx) => people.listGrades(ctx, people.studentIdsOfFamilies(ctx, parentsOwn(ctx), {})),
      [['student_grades', 'student_id'], ...parentsStudents],
    ],
    [
      'a class’s term, read with the class',
      (ctx) => termDates(ctx, classes.ofClass(ctx, 'cls_a', 'termId')),
      [
        ['terms', 'id'],
        ['classes', 'id'],
      ],
    ],
    [
      'a class’s course, read with the class',
      (ctx) => lessonLengths(ctx, classes.ofClass(ctx, 'cls_a', 'courseId')),
      [
        ['courses', 'id'],
        ['classes', 'id'],
      ],
    ],
    [
      'the invoices a parent reaches',
      (ctx) =>
        billing.listInvoices(
          ctx,
          50,
          undefined,
          {},
          { familyIds: peopleService.familiesOfGuardian(ctx, MEMBER), issuedOnly: true },
        ),
      [['invoices', 'family_id'], ...parentsFamilies],
    ],
  ];

  it.each(lookups)('%s', async (_what, send, reached) => {
    const plan = await planOf(send);
    for (const [table, column] of reached) expect(plan).toMatch(searchBy(table, column));
    expect(plan).not.toMatch(READS_AN_ORG);
  });

  it('reads the names of the students on a page from the page, in one statement', async () => {
    const page = (ctx: OrgCtx) =>
      firstIds(idsFrom(ctx, enrolments, enrolments.studentId), 51, asc(enrolments.id));
    const plan = await planOf((ctx) => people.studentNames(ctx, page(ctx)));
    expect(plan).toMatch(searchBy('students', 'id'));
    expect(plan).toMatch(searchIn('enrolments', 'enrolments_org_id_uq'));
    expect(plan).not.toContain(SORT);
  });
});

describe('what families and students are shown with is read by a query for them (TUI-95)', () => {
  const MEMBER = 'mem_a';
  const everyone: people.Reach = {};
  const staff: people.Reach = { branchIds: IDS };
  const parent: people.Reach = { guardianMembershipId: MEMBER };
  const teacher = (ctx: OrgCtx): people.Reach => ({
    studentIds: enrolmentService.studentsTaughtBy(ctx, MEMBER),
  });
  const families = (ctx: OrgCtx, reach: people.Reach) =>
    people.familiesOnPage(ctx, 50, undefined, {}, reach);
  const students = (ctx: OrgCtx, reach: people.Reach) =>
    people.studentsOnPage(ctx, 50, undefined, {}, reach);
  const gradesOfFamilies = (ctx: OrgCtx, reach: people.Reach) =>
    people.listGrades(ctx, people.studentIdsOfFamilies(ctx, families(ctx, reach), reach));

  // A page of the whole org, or of some branches, is read along the index that holds its order.
  // What is read, the call, the table and column it is reached by, and the page's table and index.
  const inOrder: [string, Send, string, string, string, string][] = [
    [
      'guardians, of a page of families',
      (ctx) => people.listGuardians(ctx, families(ctx, everyone)),
      ...(['guardians', 'family_id', 'families', 'families_org_name_idx'] as const),
    ],
    [
      'students, of a page of families',
      (ctx) => people.studentsOfFamilies(ctx, families(ctx, everyone), everyone),
      ...(['students', 'family_id', 'families', 'families_org_name_idx'] as const),
    ],
    [
      'grades, of the students of a page of families',
      (ctx) => gradesOfFamilies(ctx, everyone),
      ...(['student_grades', 'student_id', 'families', 'families_org_name_idx'] as const),
    ],
    [
      'grades, of the students of a page of families, for staff of some branches',
      (ctx) => gradesOfFamilies(ctx, staff),
      ...(['student_grades', 'student_id', 'families', 'families_org_name_idx'] as const),
    ],
    [
      'grades, of a page of students',
      (ctx) => people.listGrades(ctx, students(ctx, everyone)),
      ...(['student_grades', 'student_id', 'students', 'students_org_name_idx'] as const),
    ],
    [
      'grades, of a page of students, for staff of some branches',
      (ctx) => people.listGrades(ctx, students(ctx, staff)),
      ...(['student_grades', 'student_id', 'students', 'students_org_name_idx'] as const),
    ],
  ];

  it.each(inOrder)('%s', async (_what, send, table, column, pageTable, pageIndex) => {
    const plan = await planOf(send);
    expect(plan).toMatch(searchBy(table, column));
    expect(plan).toMatch(searchIn(pageTable, pageIndex));
  });

  // One family or student goes to its id, and a teacher's or a parent's page to their ids, at
  // every level, as the read of the family, the student or the page itself does.
  const fromIds: [string, Send, Reached][] = [
    [
      'guardians, of one family',
      (ctx) => people.listGuardians(ctx, people.familyFound(ctx, 'fam_a', everyone)),
      [
        ['guardians', 'family_id'],
        ['families', 'id'],
      ],
    ],
    [
      'grades, of the students of one family, for staff of some branches',
      (ctx) =>
        people.listGrades(
          ctx,
          people.studentIdsOfFamilies(ctx, people.familyFound(ctx, 'fam_a', staff), staff),
        ),
      [
        ['student_grades', 'student_id'],
        ['students', 'family_id'],
        ['families', 'id'],
      ],
    ],
    [
      'grades, of one student',
      (ctx) => people.listGrades(ctx, people.studentFound(ctx, 'stu_a', everyone)),
      [
        ['student_grades', 'student_id'],
        ['students', 'id'],
        ['families', 'id'],
      ],
    ],
    [
      'grades, of one student, for staff of some branches',
      (ctx) => people.listGrades(ctx, people.studentFound(ctx, 'stu_a', staff)),
      [
        ['student_grades', 'student_id'],
        ['students', 'id'],
        ['families', 'id'],
      ],
    ],
    [
      'grades, of one of a parent’s children',
      (ctx) => people.listGrades(ctx, people.studentFound(ctx, 'stu_a', parent)),
      [
        ['student_grades', 'student_id'],
        ['students', 'id'],
        ['families', 'id'],
        ['guardians', 'membership_id'],
      ],
    ],
    [
      'grades, of one of a teacher’s students',
      (ctx) => people.listGrades(ctx, people.studentFound(ctx, 'stu_a', teacher(ctx))),
      [
        ['student_grades', 'student_id'],
        ['students', 'id'],
        ['enrolments', 'class_id'],
        ['classes', 'teacher_membership_id'],
      ],
    ],
    [
      'grades, of a page of a teacher’s students',
      (ctx) => people.listGrades(ctx, students(ctx, teacher(ctx))),
      [
        ['student_grades', 'student_id'],
        ['students', 'id'],
        ['enrolments', 'class_id'],
        ['classes', 'teacher_membership_id'],
      ],
    ],
    [
      'grades, of a page of a parent’s children',
      (ctx) => people.listGrades(ctx, students(ctx, parent)),
      [
        ['student_grades', 'student_id'],
        ['students', 'family_id'],
        ['guardians', 'membership_id'],
      ],
    ],
    [
      'guardians, of a page of a parent’s families',
      (ctx) => people.listGuardians(ctx, families(ctx, parent)),
      [
        ['guardians', 'family_id'],
        ['families', 'id'],
        ['guardians', 'membership_id'],
      ],
    ],
    [
      'grades, of the students a teacher is shown in a page of their families',
      (ctx) => gradesOfFamilies(ctx, teacher(ctx)),
      [
        ['student_grades', 'student_id'],
        ['families', 'id'],
        ['enrolments', 'class_id'],
        ['classes', 'teacher_membership_id'],
      ],
    ],
  ];

  it.each(fromIds)('%s', async (_what, send, reached) => {
    const plan = await planOf(send);
    for (const [table, column] of reached) expect(plan).toMatch(searchBy(table, column));
    expect(plan).not.toMatch(READS_AN_ORG);
  });

  it('works out the current academic year inside the page that filters by grade level', async () => {
    // The org is on the context in a request, so finding today in its timezone reads nothing.
    const org = { id: 'org_plans', timezone: 'Pacific/Auckland' } as OrgRow;
    const plan = await planOf(async (ctx) => {
      const academicYearId = await currentAcademicYear({ ...ctx, org });
      const grade = { academicYearId, gradeLevelId: 'grd_a' };
      return people.listStudents(ctx, 50, undefined, { grade }, {});
    });
    expect(plan).toMatch(searchIn('students', 'students_org_name_idx'));
    expect(plan).toMatch(searchBy('student_grades', 'student_id'));
    expect(plan).toMatch(searchBy('academic_years', 'org_id'));
  });
});

describe('a session’s roster is read through the session’s id, in the stage that reads the session (TUI-89)', () => {
  const SESSION = 'ses_a';
  const itsClass = (ctx: OrgCtx) => classOfSession(ctx, SESSION);
  const classesEnrolments: Reached = [
    ['enrolments', 'class_id'],
    ['sessions', 'id'],
  ];

  // What is read, the call that sends it, and every table in it with its column.
  const reads: [string, Send, Reached][] = [
    [
      'the enrolments in the session’s class, with their dates',
      (ctx) => studentsExpectedIn(ctx, itsClass(ctx)),
      classesEnrolments,
    ],
    [
      'the names of the students enrolled in the session’s class',
      (ctx) => people.studentNames(ctx, enrolmentService.studentsEnrolledIn(ctx, itsClass(ctx))),
      [['students', 'id'], ...classesEnrolments],
    ],
    [
      'the names of the students marked at the session',
      (ctx) => people.studentNames(ctx, attendance.studentsMarkedAt(ctx, SESSION)),
      [
        ['students', 'id'],
        ['attendance', 'session_id'],
      ],
    ],
    [
      'the marks at the session',
      (ctx) => attendance.listMarks(ctx, SESSION),
      [['attendance', 'session_id']],
    ],
  ];

  it.each(reads)('%s', async (_what, send, reached) => {
    const plan = await planOf(send);
    for (const [table, column] of reached) expect(plan).toMatch(searchBy(table, column));
    expect(plan).not.toMatch(READS_AN_ORG);
  });
});

describe('a class’s emergency contacts are read by a query for its students (TUI-102)', () => {
  const onRoster = (ctx: OrgCtx) => enrolmentService.studentsEnrolledIn(ctx, IDS);
  const classesStudents: Reached = [['enrolments', 'class_id']];

  // What is read, the call that sends it, and every table in it with its column.
  const reads: [string, Send, Reached][] = [
    [
      'the students enrolled in a class, by name',
      (ctx) => people.studentsByName(ctx, onRoster(ctx)),
      [['students', 'id'], ...classesStudents],
    ],
    [
      'the emergency contacts of their families',
      (ctx) => people.emergencyContacts(ctx, onRoster(ctx)),
      [['guardians', 'family_id'], ['students', 'id'], ...classesStudents],
    ],
  ];

  it.each(reads)('%s', async (_what, send, reached) => {
    const plan = await planOf(send);
    for (const [table, column] of reached) expect(plan).toMatch(searchBy(table, column));
    expect(plan).not.toMatch(READS_AN_ORG);
  });
});

describe('absence notices and lesson notes are read by queries for their students and sessions (TUI-54, TUI-56)', () => {
  const SESSION = 'ses_a';
  const member = (scope: Access['scope'], role: Access['role'], branchIds: string[] | null) => ({
    scope,
    role,
    membershipId: 'mem_a',
    branchIds,
  });
  const teacher = member('own', 'teacher', null);
  const branchStaff = member('branch', 'branch_manager', IDS);
  const teachersStudents: Reached = [
    ['enrolments', 'class_id'],
    ['classes', 'teacher_membership_id'],
  ];
  const parentsStudents: Reached = [
    ['students', 'family_id'],
    ['families', 'id'],
    ['guardians', 'membership_id'],
  ];
  const sessionsStudents: Reached = [
    ['enrolments', 'class_id'],
    ['sessions', 'id'],
  ];

  // What is read, the call that sends it, and every table in it with its column.
  const reads: [string, Send, Reached][] = [
    [
      'the notices of a teacher’s students',
      (ctx) =>
        attendance.listNotices(
          ctx,
          50,
          undefined,
          {},
          enrolmentService.studentsReached(ctx, teacher),
        ),
      [['absence_notices', 'student_id'], ...teachersStudents],
    ],
    [
      'the notices of a parent’s children',
      (ctx) =>
        attendance.listNotices(
          ctx,
          50,
          undefined,
          {},
          peopleService.studentsOfGuardian(ctx, 'mem_a'),
        ),
      [['absence_notices', 'student_id'], ...parentsStudents],
    ],
    [
      'one student’s notices',
      (ctx) => attendance.listNotices(ctx, 50, undefined, { studentId: 'stu_a' }, undefined),
      [['absence_notices', 'student_id']],
    ],
    [
      'the names of the students on a page of notices',
      (ctx) =>
        people.studentNames(
          ctx,
          attendance.studentsOnNoticePage(
            ctx,
            50,
            undefined,
            {},
            enrolmentService.studentsReached(ctx, teacher),
          ),
        ),
      [['students', 'id'], ['absence_notices', 'student_id'], ...teachersStudents],
    ],
    [
      'the student staff of some branches give a notice for, by their enrolments',
      (ctx) =>
        people.studentNames(ctx, enrolmentService.studentsReached(ctx, branchStaff, 'stu_a')!),
      [
        ['students', 'id'],
        ['enrolments', 'student_id'],
      ],
    ],
    [
      'the notices covering a session’s date, of the students in its class',
      (ctx) =>
        attendance.noticesOn(
          ctx,
          enrolmentService.studentsEnrolledIn(ctx, classOfSession(ctx, SESSION)),
          dateOfSession(ctx, SESSION),
        ),
      [['absence_notices', 'student_id'], ...sessionsStudents],
    ],
    [
      'a session’s homework',
      (ctx) => learning.findHomework(ctx, SESSION),
      [['lesson_homework', 'session_id']],
    ],
    [
      'a session’s notes',
      (ctx) => learning.listNotes(ctx, SESSION),
      [['lesson_notes', 'session_id']],
    ],
    [
      'the names of the students with a note at a session',
      (ctx) => people.studentNames(ctx, learning.studentsNotedAt(ctx, SESSION)),
      [
        ['students', 'id'],
        ['lesson_notes', 'session_id'],
      ],
    ],
  ];

  it.each(reads)('%s', async (_what, send, reached) => {
    const plan = await planOf(send);
    for (const [table, column] of reached) expect(plan).toMatch(searchBy(table, column));
    expect(plan).not.toMatch(READS_AN_ORG);
  });

  it('pages the notices of staff of some branches in id order, checking each student', async () => {
    const plan = await planOf((ctx) =>
      attendance.listNotices(
        ctx,
        50,
        undefined,
        {},
        enrolmentService.studentsReached(ctx, branchStaff),
      ),
    );
    expect(plan).toMatch(searchIn('absence_notices', 'absence_notices_org_id_uq'));
    expect(plan).not.toContain(SORT);
    expect(plan).toMatch(searchBy('enrolments', 'student_id'));
    for (const other of ['classes', 'students', 'families']) {
      expect(plan).toMatch(searchBy(other, 'id'));
    }
    expect(plan).not.toMatch(
      /^SEARCH \w+ USING (COVERING )?INDEX \S+ \(org_id=\? AND branch_id=\?/m,
    );
  });
});

describe('ids marked wide are checked row by row, and the page keeps its order (D-104)', () => {
  const classesInBranches = (ctx: OrgCtx) => classesService.classesInBranches(ctx, IDS);
  const studentsInBranches = (ctx: OrgCtx) => peopleService.studentsInBranches(ctx, IDS);
  const familiesInBranches = (ctx: OrgCtx) => peopleService.familiesInBranches(ctx, IDS);
  // A step that reads everything in the branches: what a wide reach must never cost a page.
  const READS_THE_BRANCHES =
    /^SEARCH \w+ USING (COVERING )?INDEX \S+ \(org_id=\? AND branch_id=\?/m;

  // The list, the index its page is read along, the call, and the tables each row is looked up in.
  const lists: [string, string, string, Send, string[]][] = [
    [
      'GET /enrolments, for staff of some branches',
      'enrolments',
      'enrolments_org_id_uq',
      (ctx) =>
        enrolment.listEnrolments(
          ctx,
          50,
          undefined,
          {},
          { classIds: classesInBranches(ctx), studentIds: studentsInBranches(ctx) },
        ),
      ['classes', 'students', 'families'],
    ],
    [
      'GET /enrolments?classId, for staff of some branches',
      'enrolments',
      'enrolments_org_class_idx',
      (ctx) =>
        enrolment.listEnrolments(
          ctx,
          50,
          'id_a',
          { classId: 'cls_a' },
          { classIds: classesInBranches(ctx), studentIds: studentsInBranches(ctx) },
        ),
      ['classes', 'students', 'families'],
    ],
    [
      'GET /invoices, for staff of some branches',
      'invoices',
      'invoices_org_id_uq',
      (ctx) => billing.listInvoices(ctx, 50, undefined, {}, { familyIds: familiesInBranches(ctx) }),
      ['families'],
    ],
    [
      'GET /payments, for staff of some branches',
      'payments',
      'payments_org_id_uq',
      (ctx) => billing.listPayments(ctx, 50, undefined, {}, { familyIds: familiesInBranches(ctx) }),
      ['families'],
    ],
    [
      'GET /invoices?status, for staff of some branches',
      'invoices',
      'invoices_org_status_idx',
      (ctx) =>
        billing.listInvoices(
          ctx,
          50,
          'id_a',
          { status: 'issued' },
          { familyIds: familiesInBranches(ctx) },
        ),
      ['families'],
    ],
  ];

  it.each(lists)('%s', async (_what, table, index, send, lookedUpIn) => {
    const plan = await planOf(send);
    expect(plan).toMatch(searchIn(table, index));
    expect(plan).not.toContain(SORT);
    for (const other of lookedUpIn) expect(plan).toMatch(searchBy(other, 'id'));
    expect(plan).not.toMatch(READS_THE_BRANCHES);
  });

  it('finds one invoice by its id, then looks its family up', async () => {
    const plan = await planOf((ctx) =>
      billing.findInvoice(ctx, 'inv_a', { familyIds: familiesInBranches(ctx) }),
    );
    expect(plan).toMatch(searchBy('invoices', 'id'));
    expect(plan).toMatch(searchBy('families', 'id'));
    expect(plan).not.toMatch(READS_THE_BRANCHES);
  });
});

describe('a list paged by id reads its page in index order (D-101)', () => {
  // The list, the table, the index its page is read along, and the call that sends it.
  const lists: [string, string, string, Send][] = [
    [
      'GET /enrolments',
      'enrolments',
      'enrolments_org_id_uq',
      (ctx) => enrolment.listEnrolments(ctx, 50, undefined, {}, {}),
    ],
    [
      'GET /enrolments, a later page',
      'enrolments',
      'enrolments_org_id_uq',
      (ctx) => enrolment.listEnrolments(ctx, 50, 'id_a', {}, {}),
    ],
    [
      'GET /enrolments?classId',
      'enrolments',
      'enrolments_org_class_idx',
      (ctx) => enrolment.listEnrolments(ctx, 50, undefined, { classId: 'cls_a' }, {}),
    ],
    [
      'GET /enrolments?studentId',
      'enrolments',
      'enrolments_org_student_idx',
      (ctx) => enrolment.listEnrolments(ctx, 50, 'id_a', { studentId: 'stu_a' }, {}),
    ],
    [
      'GET /enrolments, for staff of some branches',
      'enrolments',
      'enrolments_org_id_uq',
      (ctx) => enrolment.listEnrolments(ctx, 50, undefined, {}, { classIds: IDS, studentIds: IDS }),
    ],
    [
      'GET /invoices',
      'invoices',
      'invoices_org_id_uq',
      (ctx) => billing.listInvoices(ctx, 50, undefined, {}, {}),
    ],
    [
      'GET /invoices, a later page',
      'invoices',
      'invoices_org_id_uq',
      (ctx) => billing.listInvoices(ctx, 50, 'id_a', {}, {}),
    ],
    [
      'GET /invoices?status',
      'invoices',
      'invoices_org_status_idx',
      (ctx) => billing.listInvoices(ctx, 50, 'id_a', { status: 'issued' }, {}),
    ],
    [
      'GET /invoices?termId',
      'invoices',
      'invoices_org_term_idx',
      (ctx) => billing.listInvoices(ctx, 50, undefined, { termId: 'trm_a' }, {}),
    ],
    [
      'GET /invoices?month',
      'invoices',
      'invoices_org_month_idx',
      (ctx) => billing.listInvoices(ctx, 50, undefined, { month: '2026-02' }, {}),
    ],
    [
      'GET /invoices?familyId',
      'invoices',
      'invoices_org_family_idx',
      (ctx) => billing.listInvoices(ctx, 50, undefined, { familyId: 'fam_a' }, {}),
    ],
    [
      'GET /classes',
      'classes',
      'classes_org_id_uq',
      (ctx) => classes.listClasses(ctx, 50, undefined, {}, {}),
    ],
    [
      'GET /classes, a later page',
      'classes',
      'classes_org_id_uq',
      (ctx) => classes.listClasses(ctx, 50, 'id_a', {}, {}),
    ],
    [
      'GET /classes?branchId',
      'classes',
      'classes_org_branch_idx',
      (ctx) => classes.listClasses(ctx, 50, undefined, { branchId: 'brn_a' }, {}),
    ],
    [
      'GET /classes?termId',
      'classes',
      'classes_org_term_idx',
      (ctx) => classes.listClasses(ctx, 50, 'id_a', { termId: 'trm_a' }, {}),
    ],
    [
      'GET /classes?courseId',
      'classes',
      'classes_org_course_idx',
      (ctx) => classes.listClasses(ctx, 50, undefined, { courseId: 'crs_a' }, {}),
    ],
    [
      'GET /classes?teacherId',
      'classes',
      'classes_org_teacher_idx',
      (ctx) => classes.listClasses(ctx, 50, undefined, { teacherId: 'mem_a' }, {}),
    ],
    [
      'GET /classes, for a teacher',
      'classes',
      'classes_org_teacher_idx',
      (ctx) => classes.listClasses(ctx, 50, undefined, {}, { teacherMembershipId: 'mem_a' }),
    ],
    [
      'GET /courses',
      'courses',
      'courses_org_id_uq',
      (ctx) => curriculum.listCourses(ctx, 50, undefined, {}),
    ],
    [
      'GET /courses, a later page',
      'courses',
      'courses_org_id_uq',
      (ctx) => curriculum.listCourses(ctx, 50, 'id_a', {}),
    ],
    ['GET /subjects', 'subjects', 'subjects_org_id_uq', (ctx) => curriculum.listSubjects(ctx, 50)],
    [
      'GET /subjects, a later page',
      'subjects',
      'subjects_org_id_uq',
      (ctx) => curriculum.listSubjects(ctx, 50, 'id_a'),
    ],
    ['GET /branches', 'branches', 'branches_org_id_uq', (ctx) => branches.listBranches(ctx, 50)],
    [
      'GET /branches, a later page',
      'branches',
      'branches_org_id_uq',
      (ctx) => branches.listBranches(ctx, 50, 'id_a'),
    ],
    [
      'GET /branches/{id}/rooms',
      'rooms',
      'rooms_org_branch_idx',
      (ctx) => branches.listRooms(ctx, 'brn_a', 50),
    ],
    [
      'GET /branches/{id}/rooms, a later page',
      'rooms',
      'rooms_org_branch_idx',
      (ctx) => branches.listRooms(ctx, 'brn_a', 50, 'id_a'),
    ],
    [
      'GET /payments',
      'payments',
      'payments_org_id_uq',
      (ctx) => billing.listPayments(ctx, 50, undefined, {}, {}),
    ],
    [
      'GET /payments, a later page',
      'payments',
      'payments_org_id_uq',
      (ctx) => billing.listPayments(ctx, 50, 'id_a', {}, {}),
    ],
    [
      'GET /payments?familyId',
      'payments',
      'payments_org_family_idx',
      (ctx) => billing.listPayments(ctx, 50, undefined, { familyId: 'fam_a' }, {}),
    ],
    ['GET /tax-rates', 'tax_rates', 'tax_rates_org_id_uq', (ctx) => billing.listTaxRates(ctx, 50)],
    [
      'GET /tax-rates, a later page',
      'tax_rates',
      'tax_rates_org_id_uq',
      (ctx) => billing.listTaxRates(ctx, 50, 'id_a'),
    ],
    [
      'GET /staff',
      'memberships',
      'memberships_org_id_uq',
      (ctx) => staff.listStaff(ctx, 50, undefined, {}),
    ],
    [
      'GET /staff, a later page, for a branch manager of some branches',
      'memberships',
      'memberships_org_id_uq',
      (ctx) =>
        staff.listStaff(ctx, 50, 'id_a', {
          roles: ['branch_manager', 'front_desk', 'teacher'],
          branchIds: IDS,
        }),
    ],
  ];

  it.each(lists)('%s', async (_what, table, index, send) => {
    const plan = await planOf(send);
    expect(plan).toMatch(searchIn(table, index));
    expect(plan).not.toContain(SORT);
  });

  it('checks a class name with one lookup in the unique index', async () => {
    const key = { courseId: 'crs_a', termId: null, branchId: 'brn_a', name: 'Monday' };
    const plan = await planOf((ctx) => classes.classNameTaken(ctx, key));
    expect(plan).toMatch(searchIn('classes', 'classes_org_course_term_branch_name_uq'));
    expect(plan).toMatch(searchBy('classes', 'branch_id'));
  });

  it('checks a rename the same way, finding the class’s own course and term', async () => {
    const plan = await planOf((ctx) => classes.otherClassHasName(ctx, 'cls_a', 'Monday'));
    expect(plan).toMatch(searchBy('self', 'id'));
    expect(plan).toMatch(searchIn('classes', 'classes_org_course_term_branch_name_uq'));
    expect(plan).toMatch(searchBy('classes', 'branch_id'));
  });

  it('reads the weekly slots of a page of classes from the page, in one statement', async () => {
    const page = (ctx: OrgCtx) => classes.classesOnPage(ctx, 50, 'id_a', {}, {});
    const plan = await planOf((ctx) => classes.listSlots(ctx, page(ctx)));
    expect(plan).toMatch(searchBy('class_schedules', 'class_id'));
    expect(plan).toMatch(searchIn('classes', 'classes_org_id_uq'));
  });
});

describe('price rules are read through their org (D-101)', () => {
  const target = { classId: 'cls_a', courseId: null };
  const statements: [string, Send][] = [
    ['GET /price-rules', (ctx) => billing.listPriceRules(ctx, 50, undefined, {}, {})],
    ['GET /price-rules, a later page', (ctx) => billing.listPriceRules(ctx, 50, 'id_a', {}, {})],
    [
      'GET /price-rules?classId',
      (ctx) => billing.listPriceRules(ctx, 50, undefined, { classId: 'cls_a' }, {}),
    ],
    [
      'GET /price-rules, for staff of some branches',
      (ctx) => billing.listPriceRules(ctx, 50, undefined, {}, { branchIds: IDS }),
    ],
    ['POST /price-rules, the target is free', (ctx) => billing.priceRuleTaken(ctx, target, 'pack')],
    ['DELETE /classes/{id}', (ctx) => billing.countPriceRules(ctx, { classId: 'cls_a' })],
    ['DELETE /courses/{id}', (ctx) => billing.countPriceRules(ctx, { courseId: 'crs_a' })],
    ['DELETE /tax-rates/{id}', (ctx) => billing.countPriceRules(ctx, { taxRateId: 'tax_a' })],
    ['every rule, to price enrolments and invoices', (ctx) => billing.allPriceRules(ctx)],
  ];

  it.each(statements)('%s', async (_what, send) => {
    const plan = await planOf(send);
    expect(plan).toMatch(searchBy('price_rules', 'org_id'));
    expect(plan).not.toMatch(/^SCAN price_rules/m);
    expect(plan).not.toContain(SORT);
  });
});

describe('enrolments are read in one stage, by queries for what the stage finds (TUI-94)', () => {
  const MEMBER = 'mem_a';
  type Page = [
    after: string | undefined,
    enrolment.EnrolmentFilter,
    (ctx: OrgCtx) => enrolment.Reach,
  ];
  const everyone = () => ({});
  const staff = (ctx: OrgCtx) => ({
    classIds: classesService.classesInBranches(ctx, IDS),
    studentIds: peopleService.studentsInBranches(ctx, IDS),
  });
  /** The names of the students, or the labels of the classes, on a page: read by a query for it. */
  const names =
    ([after, filter, reach]: Page): Send =>
    (ctx) =>
      people.studentNames(ctx, enrolment.onPage(ctx, 'studentId', 50, after, filter, reach(ctx)));
  const labels =
    ([after, filter, reach]: Page): Send =>
    (ctx) =>
      classes.classLabels(ctx, enrolment.onPage(ctx, 'classId', 50, after, filter, reach(ctx)));

  // What a page shows, the table it is in, the index the page is read along, and the call.
  const shown: [string, string, string, Send][] = [
    [
      'the students on a page',
      'students',
      'enrolments_org_id_uq',
      names([undefined, {}, everyone]),
    ],
    [
      'the classes on a later page',
      'classes',
      'enrolments_org_id_uq',
      labels(['id_a', {}, everyone]),
    ],
    [
      'the students in one class',
      'students',
      'enrolments_org_class_idx',
      names([undefined, { classId: 'cls_a' }, everyone]),
    ],
    [
      'the classes of one student',
      'classes',
      'enrolments_org_student_idx',
      labels(['id_a', { studentId: 'stu_a' }, everyone]),
    ],
    [
      'the students on a page, for staff of some branches',
      'students',
      'enrolments_org_id_uq',
      names([undefined, {}, staff]),
    ],
    [
      'the classes of one student, for staff of some branches',
      'classes',
      'enrolments_org_student_idx',
      labels([undefined, { studentId: 'stu_a' }, staff]),
    ],
  ];

  it.each(shown)(
    '%s are read by id, from the page in its own order',
    async (_what, table, index, send) => {
      const plan = await planOf(send);
      expect(plan).toMatch(searchBy(table, 'id'));
      expect(plan).toMatch(searchIn('enrolments', index));
      expect(plan).not.toContain(SORT);
    },
  );

  it('reads them from a teacher’s classes and a parent’s children, as it reads the page', async () => {
    const taught = (ctx: OrgCtx) => ({ classIds: classesService.classesTaughtBy(ctx, MEMBER) });
    const children = (ctx: OrgCtx) => ({
      studentIds: peopleService.studentsOfGuardian(ctx, MEMBER),
    });

    const forTeacher = await planOf(names([undefined, {}, taught]));
    expect(forTeacher).toMatch(searchBy('students', 'id'));
    expect(forTeacher).toMatch(searchBy('enrolments', 'class_id'));
    expect(forTeacher).not.toMatch(READS_AN_ORG);

    const forParent = await planOf(labels([undefined, {}, children]));
    expect(forParent).toMatch(searchBy('classes', 'id'));
    expect(forParent).toMatch(searchBy('enrolments', 'student_id'));
    expect(forParent).not.toMatch(READS_AN_ORG);
  });

  it('counts the places taken in a class from the class’s own enrolments', async () => {
    const plan = await planOf((ctx) => enrolment.placesIn(ctx, 'cls_a', 'stu_a'));
    expect(plan).toMatch(searchBy('enrolments', 'class_id'));
  });

  it('finds a class’s term through the class’s id, before the class is read', async () => {
    const plan = await planOf((ctx) => classDatesOf(ctx, 'cls_a'));
    expect(plan).toMatch(searchBy('terms', 'id'));
    expect(plan).toMatch(searchBy('classes', 'id'));
    expect(plan).not.toMatch(READS_AN_ORG);
  });
});

describe('an invoice is read with its lines and names by a query for it (TUI-97)', () => {
  const MEMBER = 'mem_a';
  const everyone: billing.InvoiceReach = {};
  const staff = (ctx: OrgCtx): billing.InvoiceReach => ({
    familyIds: peopleService.familiesInBranches(ctx, IDS),
  });
  const parent = (ctx: OrgCtx): billing.InvoiceReach => ({
    familyIds: peopleService.familiesOfGuardian(ctx, MEMBER),
    issuedOnly: true,
  });
  const one = (ctx: OrgCtx, reach = everyone) => billing.invoiceWithin(ctx, 'inv_a', reach);
  const parentsFamilies: Reached = [
    ['families', 'id'],
    ['guardians', 'membership_id'],
  ];

  // What is looked up, the call that sends it, and every table in it with its column.
  const lookups: [string, Send, Reached][] = [
    [
      'the lines of one invoice',
      (ctx) => billing.listLines(ctx, one(ctx)),
      [
        ['invoice_lines', 'invoice_id'],
        ['invoices', 'id'],
      ],
    ],
    [
      'the lines of one invoice, for a parent',
      (ctx) => billing.listLines(ctx, one(ctx, parent(ctx))),
      [['invoice_lines', 'invoice_id'], ['invoices', 'id'], ...parentsFamilies],
    ],
    [
      'the family of one invoice',
      (ctx) => people.familyLabels(ctx, billing.familyOfInvoice(ctx, 'inv_a', everyone)),
      [
        ['families', 'id'],
        ['invoices', 'id'],
      ],
    ],
    [
      'the students on one invoice',
      (ctx) => people.studentNames(ctx, billing.studentsOnLines(ctx, one(ctx))),
      [
        ['students', 'id'],
        ['invoice_lines', 'invoice_id'],
        ['invoices', 'id'],
      ],
    ],
    [
      'the classes on one invoice',
      (ctx) => classes.classLabels(ctx, billing.classesOnLines(ctx, one(ctx))),
      [
        ['classes', 'id'],
        ['invoice_lines', 'invoice_id'],
        ['invoices', 'id'],
      ],
    ],
    [
      'the lines on the invoices a run made',
      (ctx) => billing.linesGeneratedBy(ctx, 'job_a'),
      [
        ['invoice_lines', 'invoice_id'],
        ['invoices', 'job_id'],
      ],
    ],
    // A parent's page is read from their families. A filter only narrows it: with a status it
    // read every invoice the org has with that status.
    [
      'GET /invoices?status, for a parent',
      (ctx) => billing.listInvoices(ctx, 50, undefined, { status: 'issued' }, parent(ctx)),
      [['invoices', 'family_id'], ...parentsFamilies],
    ],
    [
      'GET /invoices?termId, for a parent',
      (ctx) => billing.listInvoices(ctx, 50, 'id_a', { termId: 'trm_a' }, parent(ctx)),
      [['invoices', 'family_id'], ...parentsFamilies],
    ],
    [
      'GET /invoices?month, for a parent',
      (ctx) => billing.listInvoices(ctx, 50, undefined, { month: '2026-11' }, parent(ctx)),
      [['invoices', 'family_id'], ...parentsFamilies],
    ],
  ];

  it.each(lookups)('%s', async (_what, send, reached) => {
    const plan = await planOf(send);
    for (const [table, column] of reached) expect(plan).toMatch(searchBy(table, column));
    expect(plan).not.toMatch(READS_AN_ORG);
  });

  // What a page shows of other tables is read from the page: the first rows along the page's
  // own index, for staff of some branches too. The table, its column, and the call.
  const page = (ctx: OrgCtx, reach: billing.InvoiceReach) =>
    billing.invoicesOnPage(ctx, 50, undefined, {}, reach);
  const onAPage: [string, string, string, Send][] = [
    [
      'the lines on a page',
      'invoice_lines',
      'invoice_id',
      (ctx) => billing.listLines(ctx, page(ctx, everyone)),
    ],
    [
      'the lines on a page, for staff of some branches',
      'invoice_lines',
      'invoice_id',
      (ctx) => billing.listLines(ctx, page(ctx, staff(ctx))),
    ],
    [
      'the families on a page, for staff of some branches',
      'families',
      'id',
      (ctx) => people.familyLabels(ctx, billing.familiesOnPage(ctx, 50, undefined, {}, staff(ctx))),
    ],
    [
      'the students on a page, for staff of some branches',
      'students',
      'id',
      (ctx) => people.studentNames(ctx, billing.studentsOnLines(ctx, page(ctx, staff(ctx)))),
    ],
    [
      'the classes on a page',
      'classes',
      'id',
      (ctx) => classes.classLabels(ctx, billing.classesOnLines(ctx, page(ctx, everyone))),
    ],
  ];

  it.each(onAPage)('%s', async (_what, table, column, send) => {
    const plan = await planOf(send);
    expect(plan).toMatch(searchBy(table, column));
    expect(plan).toMatch(searchIn('invoices', 'invoices_org_id_uq'));
    expect(plan).not.toMatch(
      /^SEARCH \w+ USING (COVERING )?INDEX \S+ \(org_id=\? AND branch_id=\?/m,
    );
    // The lines are sorted by enrolment for the answer. Nothing else is: the page is in order.
    if (table !== 'invoice_lines') expect(plan).not.toContain(SORT);
  });
});

describe('a payment is read with its allocations by a query for it (TUI-38)', () => {
  const MEMBER = 'mem_a';
  const everyone: billing.PaymentReach = {};
  const staff = (ctx: OrgCtx): billing.PaymentReach => ({
    familyIds: peopleService.familiesInBranches(ctx, IDS),
  });
  const parent = (ctx: OrgCtx): billing.PaymentReach => ({
    familyIds: peopleService.familiesOfGuardian(ctx, MEMBER),
  });
  const parentsFamilies: Reached = [
    ['families', 'id'],
    ['guardians', 'membership_id'],
  ];

  // What is looked up, the call that sends it, and every table in it with its column.
  const lookups: [string, Send, Reached][] = [
    [
      'the allocations of one payment',
      (ctx) => billing.listAllocations(ctx, billing.paymentWithin(ctx, 'pay_a', everyone)),
      [
        ['payment_allocations', 'payment_id'],
        ['payments', 'id'],
      ],
    ],
    [
      'the allocations of one payment, for a parent',
      (ctx) => billing.listAllocations(ctx, billing.paymentWithin(ctx, 'pay_a', parent(ctx))),
      [['payment_allocations', 'payment_id'], ['payments', 'id'], ...parentsFamilies],
    ],
    [
      'one payment, for staff of some branches',
      (ctx) => billing.findPayment(ctx, 'pay_a', staff(ctx)),
      [
        ['payments', 'id'],
        ['families', 'id'],
      ],
    ],
    [
      'the invoices a payment pays towards',
      (ctx) => billing.findInvoices(ctx, IDS, {}),
      [['invoices', 'id']],
    ],
    [
      'GET /payments?invoiceId',
      (ctx) => billing.listPayments(ctx, 50, undefined, { invoiceId: 'inv_a' }, everyone),
      [
        ['payments', 'id'],
        ['payment_allocations', 'invoice_id'],
      ],
    ],
    [
      'GET /payments, for a parent',
      (ctx) => billing.listPayments(ctx, 50, undefined, {}, parent(ctx)),
      [['payments', 'family_id'], ...parentsFamilies],
    ],
    [
      'what the invoices a payment pays towards have been paid',
      (ctx) => billing.settleInvoices(ctx, IDS),
      [
        ['invoices', 'id'],
        ['payment_allocations', 'invoice_id'],
      ],
    ],
  ];

  it.each(lookups)('%s', async (_what, send, reached) => {
    const plan = await planOf(send);
    for (const [table, column] of reached) expect(plan).toMatch(searchBy(table, column));
    expect(plan).not.toMatch(READS_AN_ORG);
  });

  // What a page shows of other tables is read from the page, along the page's own index.
  const onAPage: [string, string, string, Send][] = [
    [
      'the allocations on a page',
      'payment_allocations',
      'payment_id',
      (ctx) =>
        billing.listAllocations(ctx, billing.paymentsOnPage(ctx, 50, undefined, {}, everyone)),
    ],
    [
      'the allocations on a page, for staff of some branches',
      'payment_allocations',
      'payment_id',
      (ctx) =>
        billing.listAllocations(ctx, billing.paymentsOnPage(ctx, 50, undefined, {}, staff(ctx))),
    ],
    [
      'the families on a page, for staff of some branches',
      'families',
      'id',
      (ctx) =>
        people.familyLabels(ctx, billing.familiesOfPaymentPage(ctx, 50, undefined, {}, staff(ctx))),
    ],
  ];

  it.each(onAPage)('%s', async (_what, table, column, send) => {
    const plan = await planOf(send);
    expect(plan).toMatch(searchBy(table, column));
    expect(plan).toMatch(searchIn('payments', 'payments_org_id_uq'));
    expect(plan).not.toMatch(
      /^SEARCH \w+ USING (COVERING )?INDEX \S+ \(org_id=\? AND branch_id=\?/m,
    );
    // The allocations are sorted by payment for the answer. Nothing else is: the page is in order.
    if (table !== 'payment_allocations') expect(plan).not.toContain(SORT);
  });
});

describe('staff and invitations (D-131)', () => {
  it('checks an invite’s email against the org’s members, looking each user up by id', async () => {
    const plan = await planOf((ctx) => staff.emailIsMember(ctx, 'x@example.com'));
    expect(plan).toMatch(searchIn('memberships', 'memberships_org_id_uq'));
    expect(plan).toMatch(searchBy('users', 'id'));
    expect(plan).not.toMatch(/^SCAN users/m);
  });

  it('finds an invite by its token’s hash in the unique index', async () => {
    const plan = await planOf((ctx) => staff.findInvitationByHash(ctx.db, 'hash'));
    expect(plan).toMatch(searchIn('invitations', 'invitations_token_hash_uq'));
  });

  it('finds a user’s membership in the (org, user) index', async () => {
    const plan = await planOf((ctx) => staff.findMembershipOfUser(ctx, 'usr_a'));
    expect(plan).toMatch(searchIn('memberships', 'memberships_org_user_uq'));
  });
});

describe('search reads name ranges and exact values from their indexes (TUI-43)', () => {
  const plan = (send: Send) => planOf(send);

  it('finds families by the start of a name or a bank reference', async () => {
    const found = await plan((ctx) =>
      people.matchFamilies(ctx, { namePrefix: 'per', bankReference: 'ABCD1234' }, 20, {}),
    );
    expect(found).toMatch(searchIn('families', 'families_org_name_idx'));
    expect(found).toMatch(searchIn('families', 'families_org_bank_reference_uq'));
    expect(found).not.toMatch(READS_AN_ORG);
  });

  it('finds students by the start of a first or last name', async () => {
    const found = await plan((ctx) =>
      people.matchStudents(ctx, { namePrefix: 'aroha per' }, 20, { branchIds: ['brn_a'] }),
    );
    expect(found).toMatch(searchIn('students', 'students_org_name_idx'));
    expect(found).toMatch(searchIn('students', 'students_org_first_name_idx'));
    expect(found).not.toMatch(READS_AN_ORG);
  });

  it('finds guardians by name, and by email or phone', async () => {
    const byName = await plan((ctx) =>
      people.matchGuardians(ctx, { namePrefix: 'mere p' }, 20, {}),
    );
    expect(byName).toMatch(searchIn('guardians', 'guardians_org_name_idx'));
    expect(byName).toMatch(searchIn('guardians', 'guardians_org_first_name_idx'));
    expect(byName).not.toMatch(READS_AN_ORG);
    const byEmail = await plan((ctx) => people.matchGuardians(ctx, { email: 'a@b.c' }, 20, {}));
    expect(byEmail).toMatch(searchBy('guardians', 'email'));
    const byPhone = await plan((ctx) => people.matchGuardians(ctx, { phone: '6421' }, 20, {}));
    expect(byPhone).toMatch(searchBy('guardians', 'phone_norm'));
    const exactName = await plan((ctx) =>
      people.matchGuardians(ctx, { name: { first: 'mere', last: 'perera' } }, 20, {}),
    );
    expect(exactName).toMatch(searchIn('guardians', 'guardians_org_name_idx'));
  });

  it('never reads a whole org for a parent', async () => {
    const found = await plan((ctx) =>
      people.matchGuardians(ctx, { namePrefix: 'mere' }, 20, { guardianMembershipId: 'mem_a' }),
    );
    expect(found).not.toMatch(READS_AN_ORG);
  });
});

describe('changing an enrolment reads it and its invoice lines by id (TUI-46)', () => {
  it('finds the enrolment by its id, and its lines by the enrolment', async () => {
    const one = await planOf((ctx) => enrolment.findEnrolment(ctx, 'enr_a', {}));
    expect(one).toMatch(searchBy('enrolments', 'id'));
    const lines = await planOf((ctx) => billing.linesOfEnrolment(ctx, 'enr_a'));
    expect(lines).toMatch(searchBy('invoice_lines', 'enrolment_id'));
    expect(lines).not.toMatch(READS_AN_ORG);
  });

  it('finds a lesson’s roll from the class’s enrolments, withdrawn ones too', async () => {
    const roll = await planOf((ctx) =>
      people.studentNames(ctx, enrolment.rollStudents(ctx, ['cls_a'])),
    );
    expect(roll).toMatch(searchBy('enrolments', 'class_id'));
  });
});
