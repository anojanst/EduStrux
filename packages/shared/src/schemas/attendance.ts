import { z } from '../zod';
import { Timestamp } from './common';

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Most students one request can mark: a class takes at most 1000. */
export const MAX_ATTENDANCE_RECORDS = 1000;

const StudentId = z.string().openapi({ example: 'stu_01j9z3k6m2q8w4e5r6t7y8u9i0' });

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
