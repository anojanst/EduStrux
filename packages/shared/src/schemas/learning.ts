import { z } from '../zod';
import { Timestamp } from './common';

/** Most students one request can write notes for: a class takes at most 1000. */
export const MAX_LESSON_NOTES = 1000;

const Text = z.string().trim().min(1).max(2000);
const StudentId = z.string().openapi({ example: 'stu_01j9z3k6m2q8w4e5r6t7y8u9i0' });

export const LessonNote = z
  .object({
    studentId: StudentId,
    studentFirstName: z.string(),
    studentLastName: z.string(),
    note: z.string().nullable().openapi({ description: 'null = no note.' }),
    // A union rather than Timestamp.nullable(), which would put the example on a null.
    updatedAt: z.union([Timestamp, z.null()]).openapi({
      description: 'When the note was last written. null = no note.',
    }),
  })
  .openapi('LessonNote');
export type LessonNote = z.infer<typeof LessonNote>;

export const SessionNotes = z
  .object({
    sessionId: z.string().openapi({ example: 'ses_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    homework: z.string().nullable().openapi({
      description: 'The homework set at the lesson, for the whole class. null = none.',
    }),
    homeworkUpdatedAt: z.union([Timestamp, z.null()]).openapi({
      description: 'When the homework was last written. null = none.',
    }),
    notes: z.array(LessonNote).openapi({
      description:
        'One per student expected at the session, by last name then first name: those with an ' +
        'active enrolment in the class that covers the session’s date, plus anyone with a note.',
    }),
  })
  .openapi('SessionNotes');
export type SessionNotes = z.infer<typeof SessionNotes>;

export const UpdateSessionNotes = z
  .object({
    homework: Text.nullable().optional().openapi({
      description: 'The homework for the whole class. null clears it; leave out to keep it.',
      example: 'Textbook p.42, questions 1–10',
    }),
    notes: z
      .array(
        z.object({
          studentId: StudentId,
          note: Text.nullable().openapi({
            description: 'null clears the student’s note.',
            example: 'Struggled with fractions; practise at home.',
          }),
        }),
      )
      .min(1)
      .max(MAX_LESSON_NOTES)
      .optional()
      .openapi({
        description: 'The students to write a note for. Anyone left out keeps the note they have.',
      }),
  })
  .superRefine((v, ctx) => {
    if (v.homework === undefined && v.notes === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Send homework, notes or both' });
    }
    const seen = new Set<string>();
    v.notes?.forEach((entry, index) => {
      if (seen.has(entry.studentId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Listed more than once',
          path: ['notes', index, 'studentId'],
        });
      }
      seen.add(entry.studentId);
    });
  })
  .openapi('UpdateSessionNotes');
export type UpdateSessionNotes = z.infer<typeof UpdateSessionNotes>;
