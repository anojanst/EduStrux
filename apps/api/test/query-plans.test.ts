import { enrolments } from '@edustrux/db';
import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { firstIds, idsFrom, type OrgCtx } from '../src/db/scope';
import * as attendance from '../src/modules/attendance/repository';
import * as billing from '../src/modules/billing/repository';
import * as branches from '../src/modules/branches/repository';
import { classOfSession } from '../src/modules/classes/for-attendance';
import * as classes from '../src/modules/classes/repository';
import * as classesService from '../src/modules/classes/service';
import * as curriculum from '../src/modules/curriculum/repository';
import { studentsExpectedIn } from '../src/modules/enrolment/for-attendance';
import * as enrolment from '../src/modules/enrolment/repository';
import * as enrolmentService from '../src/modules/enrolment/service';
import * as people from '../src/modules/people/repository';
import * as peopleService from '../src/modules/people/service';
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
    ['GET /tax-rates', 'tax_rates', 'tax_rates_org_id_uq', (ctx) => billing.listTaxRates(ctx, 50)],
    [
      'GET /tax-rates, a later page',
      'tax_rates',
      'tax_rates_org_id_uq',
      (ctx) => billing.listTaxRates(ctx, 50, 'id_a'),
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
