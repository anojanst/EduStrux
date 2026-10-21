import { z } from '../zod';
import { Timestamp } from './common';

// Privacy controls (TUI-79): consents recorded per student, and erasing a family.

/**
 * The consents a centre records for each student: photos (in class, on the centre's pages) and
 * first-aid or medical treatment in an emergency.
 */
export const CONSENT_TYPES = ['photos', 'medical_treatment'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const Consent = z
  .object({
    type: z.enum(CONSENT_TYPES),
    granted: z.boolean().nullable().openapi({ description: 'null = not asked yet.' }),
    guardianId: z
      .string()
      .nullable()
      .openapi({ description: 'The guardian who gave or refused it.' }),
    note: z.string().nullable(),
    recordedByUserId: z.string().nullable(),
    updatedAt: Timestamp.nullable(),
  })
  .openapi('Consent');
export type Consent = z.infer<typeof Consent>;

export const StudentConsents = z
  .object({ studentId: z.string(), consents: z.array(Consent) })
  .openapi('StudentConsents');
export type StudentConsents = z.infer<typeof StudentConsents>;

export const SetConsent = z
  .object({
    granted: z.boolean(),
    guardianId: z.string().nullable().optional().openapi({
      description: 'One of the student’s family’s guardians. A parent gives their own.',
    }),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .openapi('SetConsent');
export type SetConsent = z.infer<typeof SetConsent>;

export const FamilyErased = z
  .object({
    familyId: z.string(),
    erasedAt: Timestamp,
    guardians: z.number().int(),
    students: z.number().int(),
  })
  .openapi('FamilyErased');
export type FamilyErased = z.infer<typeof FamilyErased>;
