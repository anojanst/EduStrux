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
