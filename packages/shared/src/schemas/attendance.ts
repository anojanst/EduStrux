import { addDays } from '../dates';
import { z } from '../zod';
import { LocalDate, PageQuery, Timestamp } from './common';

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Most students one request can mark: a class takes at most 1000. */
export const MAX_ATTENDANCE_RECORDS = 1000;

const StudentId = z.string().openapi({ example: 'stu_01j9z3k6m2q8w4e5r6t7y8u9i0' });

/** Who gave an absence notice: a parent through the portal, or a member of staff. */
export const ABSENCE_NOTICE_SOURCES = ['parent', 'staff'] as const;
export type AbsenceNoticeSource = (typeof ABSENCE_NOTICE_SOURCES)[number];

/** The longest an absence notice can run, in days, both ends included. */
export const MAX_ABSENCE_DAYS = 366;

/** What a roster shows of an absence notice that covers the session's date. */
export const RosterAbsenceNotice = z
  .object({
    id: z.string().openapi({ example: 'abn_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    reason: z.string().nullable(),
    source: z.enum(ABSENCE_NOTICE_SOURCES),
  })
  .openapi('RosterAbsenceNotice');

export const AttendanceRecord = z
  .object({
    studentId: StudentId,
    studentFirstName: z.string(),
    studentLastName: z.string(),
    status: z.enum(ATTENDANCE_STATUSES).nullable().openapi({
      description: 'null = not marked yet.',
    }),
    // A union rather than Timestamp.nullable(), which would put the example on a null.
    markedAt: z.union([Timestamp, z.null()]).openapi({
      description: 'When the status was last set. null = not marked yet.',
    }),
    // A union rather than RosterAbsenceNotice.nullable(): the generator drops "or null" from a $ref.
    absenceNotice: z.union([RosterAbsenceNotice, z.null()]).openapi({
      description:
        'The newest absence notice covering the session’s date. It marks nothing: staff still ' +
        'set the status. null = none.',
    }),
  })
  .openapi('AttendanceRecord');
export type AttendanceRecord = z.infer<typeof AttendanceRecord>;

export const SessionAttendance = z
  .object({
    sessionId: z.string().openapi({ example: 'ses_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    records: z.array(AttendanceRecord).openapi({
      description:
        'One per student expected at the session, by last name then first name: those with an ' +
        'active enrolment in the class that covers the session’s date, plus anyone already marked.',
    }),
  })
  .openapi('SessionAttendance');
export type SessionAttendance = z.infer<typeof SessionAttendance>;

export const MarkAttendance = z
  .object({
    records: z
      .array(
        z.object({
          studentId: StudentId,
          status: z.enum(ATTENDANCE_STATUSES).nullable().openapi({
            description: 'null clears the student’s mark.',
            example: 'present',
          }),
        }),
      )
      .min(1)
      .max(MAX_ATTENDANCE_RECORDS)
      .openapi({
        description:
          'The students to mark: one, some or the whole class. Anyone left out keeps the status ' +
          'they have.',
      }),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.records.forEach((record, index) => {
      if (seen.has(record.studentId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Listed more than once',
          path: ['records', index, 'studentId'],
        });
      }
      seen.add(record.studentId);
    });
  })
  .openapi('MarkAttendance');
export type MarkAttendance = z.infer<typeof MarkAttendance>;

// ── Emergency contacts ──────────────────────────────────────────────────────

/** A guardian to call in an emergency, as a class's roster shows them: no email, no ids (D-112). */
export const EmergencyContact = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    relationship: z.string().nullable().openapi({ example: 'Mother' }),
    phone: z.string().nullable().openapi({ example: '+64 21 555 0100' }),
  })
  .openapi('EmergencyContact');
export type EmergencyContact = z.infer<typeof EmergencyContact>;

export const StudentEmergencyContacts = z
  .object({
    studentId: StudentId,
    studentFirstName: z.string(),
    studentLastName: z.string(),
    contacts: z.array(EmergencyContact).openapi({
      description:
        'The guardians of the student’s family marked as emergency contacts, oldest first. ' +
        'Empty when none is.',
    }),
  })
  .openapi('StudentEmergencyContacts');
export type StudentEmergencyContacts = z.infer<typeof StudentEmergencyContacts>;

export const ClassEmergencyContacts = z
  .object({
    classId: z.string().openapi({ example: 'cls_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    students: z.array(StudentEmergencyContacts).openapi({
      description:
        'Every student with an active enrolment in the class, by last name then first name, ' +
        'whichever branch their family belongs to.',
    }),
  })
  .openapi('ClassEmergencyContacts');
export type ClassEmergencyContacts = z.infer<typeof ClassEmergencyContacts>;

// ── Absence notices ─────────────────────────────────────────────────────────

export const AbsenceNotice = z
  .object({
    id: z.string().openapi({ example: 'abn_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    studentId: StudentId,
    studentFirstName: z.string(),
    studentLastName: z.string(),
    startDate: LocalDate.openapi({ description: 'The first day the student is away.' }),
    endDate: LocalDate.openapi({ description: 'The last day the student is away.' }),
    reason: z.string().nullable(),
    source: z.enum(ABSENCE_NOTICE_SOURCES).openapi({
      description: 'Who gave it: a parent through the portal, or a member of staff.',
    }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('AbsenceNotice');
export type AbsenceNotice = z.infer<typeof AbsenceNotice>;

export const CreateAbsenceNotice = z
  .object({
    studentId: StudentId,
    startDate: LocalDate.openapi({ description: 'The first day the student is away.' }),
    endDate: LocalDate.optional().openapi({
      description: 'The last day the student is away. Leave out for one day.',
    }),
    reason: z.string().trim().min(1).max(500).nullable().optional().openapi({
      example: 'Unwell',
    }),
  })
  // Compared only when both are real dates; a malformed one already has its own error.
  .superRefine((v, ctx) => {
    if (!v.endDate || !LocalDate.safeParse(v.startDate).success) return;
    if (!LocalDate.safeParse(v.endDate).success) return;
    if (v.endDate < v.startDate) {
      ctx.addIssue({ code: 'custom', message: 'Must be on or after startDate', path: ['endDate'] });
    } else if (v.endDate > addDays(v.startDate, MAX_ABSENCE_DAYS - 1)) {
      ctx.addIssue({
        code: 'custom',
        message: `At most ${MAX_ABSENCE_DAYS} days after startDate`,
        path: ['endDate'],
      });
    }
  })
  .openapi('CreateAbsenceNotice');
export type CreateAbsenceNotice = z.infer<typeof CreateAbsenceNotice>;

export const AbsenceNoticeQuery = PageQuery.extend({
  studentId: z.string().optional().openapi({ description: 'Only this student’s notices' }),
  from: LocalDate.optional().openapi({ description: 'Only notices that end on or after this day' }),
  to: LocalDate.optional().openapi({
    description: 'Only notices that start on or before this day',
  }),
});

// ── Make-ups (TUI-55) ───────────────────────────────────────────────────────

/**
 * `available` until used or lapsed. `used`: booked into a make-up lesson. `expired`: past its
 * last day unused. A credit whose mark changes while unused is withdrawn and no longer listed.
 */
export const MAKEUP_CREDIT_STATUSES = ['available', 'used', 'expired'] as const;
export type MakeupCreditStatus = (typeof MAKEUP_CREDIT_STATUSES)[number];

export const MakeupPolicy = z
  .object({
    enabled: z.boolean().openapi({ description: 'Whether missed lessons earn make-up credits.' }),
    creditForExcused: z.boolean().openapi({ description: 'An `excused` mark earns a credit.' }),
    creditForAbsent: z.boolean().openapi({ description: 'An `absent` mark earns a credit.' }),
    requireNotice: z.boolean().openapi({
      description:
        'Only when an absence notice covering the lesson was given before it started (D-129).',
    }),
    expiryDays: z.number().int().min(1).max(730).nullable().openapi({
      description: 'A credit lapses this many days after the missed lesson. null = never.',
      example: 60,
    }),
    sameCourseOnly: z.boolean().openapi({
      description: 'A make-up must be a lesson of the same course as the one missed.',
    }),
    updatedAt: Timestamp.nullable().openapi({ description: 'null while the defaults apply.' }),
  })
  .openapi('MakeupPolicy');
export type MakeupPolicy = z.infer<typeof MakeupPolicy>;

export const UpdateMakeupPolicy = MakeupPolicy.omit({ updatedAt: true }).openapi(
  'UpdateMakeupPolicy',
);
export type UpdateMakeupPolicy = z.infer<typeof UpdateMakeupPolicy>;

export const DEFAULT_MAKEUP_POLICY: Omit<MakeupPolicy, 'updatedAt'> = {
  enabled: false,
  creditForExcused: true,
  creditForAbsent: false,
  requireNotice: true,
  expiryDays: 60,
  sameCourseOnly: true,
};

export const MakeupBooking = z
  .object({
    id: z.string().openapi({ example: 'mkb_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    creditId: z.string(),
    studentId: z.string(),
    sessionId: z.string().openapi({ description: 'The make-up lesson.' }),
    date: LocalDate,
    startTime: z.string(),
    classId: z.string(),
    className: z.string(),
    createdAt: Timestamp,
  })
  .openapi('MakeupBooking');
export type MakeupBooking = z.infer<typeof MakeupBooking>;

export const MakeupCredit = z
  .object({
    id: z.string().openapi({ example: 'mkc_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    studentId: z.string(),
    studentFirstName: z.string(),
    studentLastName: z.string(),
    sessionId: z.string().openapi({ description: 'The lesson missed.' }),
    classId: z.string(),
    courseId: z.string(),
    missedOn: LocalDate,
    expiresOn: LocalDate.nullable(),
    status: z.enum(MAKEUP_CREDIT_STATUSES).openapi({
      description: 'An unused credit past `expiresOn` is `expired`, even before the hourly sweep.',
    }),
    booking: z.union([MakeupBooking, z.null()]).openapi({
      description: 'The make-up booked with it. null while unused.',
    }),
    createdAt: Timestamp,
  })
  .openapi('MakeupCredit');
export type MakeupCredit = z.infer<typeof MakeupCredit>;

export const MakeupCreditQuery = PageQuery.extend({
  studentId: z.string().optional().openapi({ description: 'Only this student’s credits' }),
  status: z.enum(MAKEUP_CREDIT_STATUSES).optional(),
});

export const CreateMakeupBooking = z
  .object({
    creditId: z.string().openapi({ example: 'mkc_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    sessionId: z.string().openapi({ description: 'The lesson to make up in.' }),
  })
  .openapi('CreateMakeupBooking');
export type CreateMakeupBooking = z.infer<typeof CreateMakeupBooking>;
