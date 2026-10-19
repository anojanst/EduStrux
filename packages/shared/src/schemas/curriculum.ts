import { z } from '../zod';
import { CurrencyCode, Money, PageQuery, Timestamp } from './common';

const Name = z.string().trim().min(1).max(120);
const UpdatedAt = Timestamp.openapi({
  description: 'The updatedAt you last read. A newer value on the server returns 409.',
});

/** Most grade levels one org can have. The list endpoint returns them all, in order. */
export const MAX_GRADE_LEVELS = 100;

export const GradeLevel = z
  .object({
    id: z.string().openapi({ example: 'grd_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    name: z.string(),
    sortOrder: z.number().int().openapi({ description: 'Position in the org’s grade order.' }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('GradeLevel');
export type GradeLevel = z.infer<typeof GradeLevel>;

export const CreateGradeLevel = z
  .object({ name: Name.openapi({ example: 'Year 10' }) })
  .openapi('CreateGradeLevel');
export type CreateGradeLevel = z.infer<typeof CreateGradeLevel>;

/** The position changes only through PUT /grade-levels/order. */
export const UpdateGradeLevel = z
  .object({ updatedAt: UpdatedAt, name: Name })
  .partial()
  .required({ updatedAt: true })
  .openapi('UpdateGradeLevel');
export type UpdateGradeLevel = z.infer<typeof UpdateGradeLevel>;

export const GradeLevelOrder = z
  .object({
    ids: z
      .array(z.string())
      .min(1)
      .max(MAX_GRADE_LEVELS)
      .refine((ids) => new Set(ids).size === ids.length, 'Each grade level can appear only once')
      .openapi({
        description: 'Every grade level id in the org, in the new order.',
        example: ['grd_01j9z3k6m2q8w4e5r6t7y8u9i0', 'grd_01j9z3k6m2q8w4e5r6t7y8u9i1'],
      }),
  })
  .openapi('GradeLevelOrder');
export type GradeLevelOrder = z.infer<typeof GradeLevelOrder>;

export const GradeLevelList = z
  .object({
    data: z.array(GradeLevel),
    nextCursor: z.null().openapi({ description: 'Always null: the whole list is returned.' }),
  })
  .openapi('GradeLevelList');

export const Subject = z
  .object({
    id: z.string().openapi({ example: 'sbj_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    name: z.string(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Subject');
export type Subject = z.infer<typeof Subject>;

export const CreateSubject = z
  .object({ name: Name.openapi({ example: 'Mathematics' }) })
  .openapi('CreateSubject');
export type CreateSubject = z.infer<typeof CreateSubject>;

export const UpdateSubject = z
  .object({ updatedAt: UpdatedAt, name: Name })
  .partial()
  .required({ updatedAt: true })
  .openapi('UpdateSubject');
export type UpdateSubject = z.infer<typeof UpdateSubject>;

// ── Courses ─────────────────────────────────────────────────────────────────

/** A short free-text label, e.g. a curriculum ("Cambridge") or a teaching medium ("English"). */
const Label = z.string().trim().min(1).max(60).nullable();
const Curriculum = Label.openapi({
  example: 'Cambridge',
  description: 'The curriculum the course follows. null = not set.',
});
const TeachingMedium = Label.openapi({
  example: 'English',
  description: 'The language the course is taught in. null = not set.',
});
/** A price can't be negative; 0 is free. The currency must be the organisation's. */
const DefaultPrice = z
  .object({
    amount: z.number().int().min(0).openapi({ example: 4500 }),
    currency: CurrencyCode,
  })
  .nullable()
  .openapi({
    description:
      'The course’s price for one billing period of a class: a term, or a month for a class ' +
      'with no term. In the organisation’s currency. null = not set. A price rule for the ' +
      'course or the class replaces it.',
  });
const DurationMinutes = z.number().int().min(5).max(600).nullable().openapi({
  example: 60,
  description: 'How long a lesson usually runs, in minutes. null = not set.',
});

export const Course = z
  .object({
    id: z.string().openapi({ example: 'crs_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    subjectId: z.string(),
    gradeLevelId: z.string(),
    curriculum: z.string().nullable(),
    teachingMedium: z.string().nullable(),
    // A union rather than Money.nullable(): the OpenAPI generator drops "or null" from a $ref.
    // Left out, not null, for the roles that don't see it, since null means no price is set.
    defaultPrice: z
      .union([Money, z.null()])
      .optional()
      .openapi({ description: 'null = not set. Left out for teachers and parents (D-110).' }),
    durationMinutes: z.number().int().nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Course');
export type Course = z.infer<typeof Course>;

export const CreateCourse = z
  .object({
    subjectId: z.string().openapi({ example: 'sbj_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    gradeLevelId: z.string().openapi({ example: 'grd_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    curriculum: Curriculum.optional(),
    teachingMedium: TeachingMedium.optional(),
    defaultPrice: DefaultPrice.optional(),
    durationMinutes: DurationMinutes.optional(),
  })
  .openapi('CreateCourse');
export type CreateCourse = z.infer<typeof CreateCourse>;

/** A course keeps its subject and grade level: there's no subjectId or gradeLevelId here. */
export const UpdateCourse = z
  .object({
    updatedAt: UpdatedAt,
    curriculum: Curriculum,
    teachingMedium: TeachingMedium,
    defaultPrice: DefaultPrice,
    durationMinutes: DurationMinutes,
  })
  .partial()
  .required({ updatedAt: true })
  .openapi('UpdateCourse');
export type UpdateCourse = z.infer<typeof UpdateCourse>;

export const CourseQuery = PageQuery.extend({
  subjectId: z.string().optional().openapi({ description: 'Only this subject’s courses' }),
  gradeLevelId: z.string().optional().openapi({ description: 'Only this grade level’s courses' }),
});
