import { describe, expect, it } from 'vitest';
import * as attendance from '../src/modules/attendance/repository';
import * as billing from '../src/modules/billing/repository';
import * as classes from '../src/modules/classes/repository';
import * as curriculum from '../src/modules/curriculum/repository';
import * as enrolment from '../src/modules/enrolment/repository';
import * as people from '../src/modules/people/repository';
import { planOf, searchBy, type Send } from './query-plans';

// D1 counts and bills the rows a statement reads, and production has no table statistics to
// steer SQLite. These tests take the plan of the statements the repositories really send, on the
// database the migrations build, and fail when one would read a whole centre again.
//
// To cover another statement, add a row to the table it belongs in.

const IDS = ['id_a', 'id_b'];
const RANGE = { startDate: '2026-01-01', endDate: '2026-03-31' };

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
      'enrolments by student',
      'enrolments',
      'student_id',
      (ctx) => enrolment.activeClassIds(ctx, IDS),
    ],
    [
      'enrolments by class',
      'enrolments',
      'class_id',
      (ctx) => enrolment.activeStudentIds(ctx, IDS),
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
