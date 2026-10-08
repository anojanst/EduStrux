import { z } from '../zod';
import { Timestamp } from './common';

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
