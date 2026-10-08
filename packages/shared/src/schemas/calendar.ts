import { z } from '../zod';
import { LocalDate, PageQuery, Timestamp } from './common';

const Name = z.string().trim().min(1).max(120);
const UpdatedAt = Timestamp.openapi({
  description: 'The updatedAt you last read. A newer value on the server returns 409.',
});
const END_BEFORE_START = 'Must be on or after startDate';

/** Adds the "end isn't before start" check to a schema with optional start and end dates. */
function datesInOrder<T extends z.ZodType<{ startDate?: string; endDate?: string }>>(schema: T) {
  return schema.refine(
    (v) =>
      !LocalDate.safeParse(v.startDate).success ||
      !LocalDate.safeParse(v.endDate).success ||
      v.endDate! >= v.startDate!,
    // Compared only when both are real dates; a malformed one already has its own error.
    { message: END_BEFORE_START, path: ['endDate'] },
  );
}

export const AcademicYear = z
  .object({
    id: z.string().openapi({ example: 'acy_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    name: z.string(),
    startDate: LocalDate,
    endDate: LocalDate,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('AcademicYear');
export type AcademicYear = z.infer<typeof AcademicYear>;

export const CreateAcademicYear = datesInOrder(
  z.object({
    name: Name.openapi({ example: '2027' }),
    startDate: LocalDate.openapi({ example: '2027-01-25' }),
    endDate: LocalDate.openapi({ example: '2027-12-17' }),
  }),
).openapi('CreateAcademicYear');
export type CreateAcademicYear = z.infer<typeof CreateAcademicYear>;

export const UpdateAcademicYear = datesInOrder(
  z
    .object({ updatedAt: UpdatedAt, name: Name, startDate: LocalDate, endDate: LocalDate })
    .partial()
    .required({ updatedAt: true }),
).openapi('UpdateAcademicYear');
export type UpdateAcademicYear = z.infer<typeof UpdateAcademicYear>;

export const Term = z
  .object({
    id: z.string().openapi({ example: 'trm_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    academicYearId: z.string(),
    name: z.string(),
    startDate: LocalDate,
    endDate: LocalDate,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Term');
export type Term = z.infer<typeof Term>;

export const CreateTerm = datesInOrder(
  z.object({
    academicYearId: z.string().openapi({ example: 'acy_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    name: Name.openapi({ example: 'Term 1' }),
    startDate: LocalDate.openapi({ example: '2027-02-01' }),
    endDate: LocalDate.openapi({ example: '2027-04-16' }),
  }),
).openapi('CreateTerm');
export type CreateTerm = z.infer<typeof CreateTerm>;

/** A term stays in its academic year: there's no academicYearId here. */
export const UpdateTerm = datesInOrder(
  z
    .object({ updatedAt: UpdatedAt, name: Name, startDate: LocalDate, endDate: LocalDate })
    .partial()
    .required({ updatedAt: true }),
).openapi('UpdateTerm');
export type UpdateTerm = z.infer<typeof UpdateTerm>;

export const TermQuery = PageQuery.extend({
  academicYearId: z.string().optional().openapi({ description: 'Only this academic year’s terms' }),
});

export const Holiday = z
  .object({
    id: z.string().openapi({ example: 'hol_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    name: z.string(),
    startDate: LocalDate,
    endDate: LocalDate,
    branchId: z.string().nullable().openapi({
      description: 'null = the whole organisation is closed; otherwise only this branch.',
    }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Holiday');
export type Holiday = z.infer<typeof Holiday>;

export const CreateHoliday = datesInOrder(
  z.object({
    name: Name.openapi({ example: 'Easter break' }),
    startDate: LocalDate.openapi({ example: '2027-03-26' }),
    endDate: LocalDate.openapi({
      example: '2027-04-05',
      description: 'The last closed day. For a single day, the same as startDate.',
    }),
    branchId: z.string().nullable().optional().openapi({
      description: 'Close only this branch. Leave out (or null) to close the whole organisation.',
    }),
  }),
).openapi('CreateHoliday');
export type CreateHoliday = z.infer<typeof CreateHoliday>;

export const HolidayQuery = PageQuery.extend({
  from: LocalDate.optional().openapi({
    description: 'Only holidays that end on or after this date',
  }),
  to: LocalDate.optional().openapi({
    description: 'Only holidays that start on or before this date',
  }),
  branchId: z.string().optional().openapi({
    description: 'Only holidays that close this branch: its own plus the organisation-wide ones',
  }),
});
