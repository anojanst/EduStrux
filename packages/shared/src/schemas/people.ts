import { z } from '../zod';
import { PageQuery, Timestamp } from './common';

/** How a guardian prefers to hear from the centre. Only email is sent so far. */
export const CONTACT_CHANNELS = ['email', 'sms', 'whatsapp'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

const Name = z.string().trim().min(1).max(120);
const PersonName = z.string().trim().min(1).max(80);
const UpdatedAt = Timestamp.openapi({
  description: 'The updatedAt you last read. A newer value on the server returns 409.',
});
const Email = z.string().trim().toLowerCase().max(254).email().nullable().openapi({
  description: 'Stored in lower case. null = not set.',
  example: 'mere.perera@example.com',
});
const Phone = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(/^[0-9+() .-]+$/, 'Digits, spaces and + ( ) . - only')
  .nullable()
  .openapi({ example: '+64 21 555 0100' });
const PreferredChannel = z.enum(CONTACT_CHANNELS).openapi({
  description: 'How this guardian prefers to be contacted. Only email is sent so far.',
});
const EmergencyContact = z.boolean().openapi({
  description: 'Whether to call this person in an emergency.',
});

// ── Guardians ───────────────────────────────────────────────────────────────

export const Guardian = z
  .object({
    id: z.string().openapi({ example: 'gdn_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    familyId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    preferredChannel: z.enum(CONTACT_CHANNELS),
    emergencyContact: z.boolean(),
    membershipId: z.string().nullable().openapi({
      description:
        'The parent membership this guardian signs in with. null until they accept an invite.',
    }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Guardian');
export type Guardian = z.infer<typeof Guardian>;

export const CreateGuardian = z
  .object({
    firstName: PersonName.openapi({ example: 'Mere' }),
    lastName: PersonName.openapi({ example: 'Perera' }),
    email: Email.optional(),
    phone: Phone.optional(),
    preferredChannel: PreferredChannel.default('email'),
    emergencyContact: EmergencyContact.default(true),
  })
  .openapi('CreateGuardian');
export type CreateGuardian = z.infer<typeof CreateGuardian>;

/** A guardian stays in their family: there's no familyId here. */
export const UpdateGuardian = z
  .object({
    updatedAt: UpdatedAt,
    firstName: PersonName,
    lastName: PersonName,
    email: Email,
    phone: Phone,
    preferredChannel: PreferredChannel,
    emergencyContact: EmergencyContact,
  })
  .partial()
  .required({ updatedAt: true })
  .openapi('UpdateGuardian');
export type UpdateGuardian = z.infer<typeof UpdateGuardian>;

// ── Students ────────────────────────────────────────────────────────────────

export const StudentGrade = z
  .object({ academicYearId: z.string(), gradeLevelId: z.string() })
  .openapi('StudentGrade');
export type StudentGrade = z.infer<typeof StudentGrade>;

export const Student = z
  .object({
    id: z.string().openapi({ example: 'stu_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    familyId: z.string(),
    familyName: z.string().openapi({ description: 'The family’s name.', example: 'Perera' }),
    branchId: z.string().openapi({ description: 'The family’s home branch.' }),
    firstName: z.string(),
    lastName: z.string(),
    gradeLevelId: z
      .string()
      .nullable()
      .openapi({
        description:
          'The student’s grade level in the current academic year: the one today falls in, ' +
          'else the last one to end, else the first to start. null = none recorded for it.',
      }),
    grades: z.array(StudentGrade).openapi({
      description: 'The grade level for every academic year on record, earliest year first.',
    }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Student');
export type Student = z.infer<typeof Student>;

const GradeLevelId = z.string().openapi({
  description: 'The student’s grade level for `academicYearId`, or for the current academic year.',
  example: 'grd_01j9z3k6m2q8w4e5r6t7y8u9i0',
});
const AcademicYearId = z.string().openapi({
  description: 'The year `gradeLevelId` is for. Leave out for the current academic year.',
  example: 'acy_01j9z3k6m2q8w4e5r6t7y8u9i0',
});
const YEAR_NEEDS_GRADE = { message: 'Only with gradeLevelId', path: ['academicYearId'] };

export const CreateStudent = z
  .object({
    familyId: z.string().openapi({ example: 'fam_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    firstName: PersonName.openapi({ example: 'Aroha' }),
    lastName: PersonName.openapi({ example: 'Perera' }),
    gradeLevelId: GradeLevelId.optional(),
    academicYearId: AcademicYearId.optional(),
  })
  .refine((v) => v.academicYearId === undefined || v.gradeLevelId !== undefined, YEAR_NEEDS_GRADE)
  .openapi('CreateStudent');
export type CreateStudent = z.infer<typeof CreateStudent>;

/** A student stays in their family: there's no familyId here. */
export const UpdateStudent = z
  .object({
    updatedAt: UpdatedAt,
    firstName: PersonName,
    lastName: PersonName,
    gradeLevelId: GradeLevelId.nullable().openapi({
      description:
        'Sets the grade level for `academicYearId`, or for the current academic year. null ' +
        'removes it.',
    }),
    academicYearId: AcademicYearId,
  })
  .partial()
  .required({ updatedAt: true })
  .refine((v) => v.academicYearId === undefined || v.gradeLevelId !== undefined, YEAR_NEEDS_GRADE)
  .openapi('UpdateStudent');
export type UpdateStudent = z.infer<typeof UpdateStudent>;

export const StudentQuery = PageQuery.extend({
  familyId: z.string().optional().openapi({ description: 'Only this family’s students' }),
  branchId: z.string().optional().openapi({
    description: 'Only students of families whose home branch this is',
  }),
  gradeLevelId: z.string().optional().openapi({
    description: 'Only students in this grade level in `academicYearId` (or the current year)',
  }),
  academicYearId: z.string().optional().openapi({
    description: 'The year `gradeLevelId` is checked in. Leave out for the current academic year.',
  }),
}).refine((q) => q.academicYearId === undefined || q.gradeLevelId !== undefined, YEAR_NEEDS_GRADE);

// ── Families ────────────────────────────────────────────────────────────────

export const Family = z
  .object({
    id: z.string().openapi({ example: 'fam_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    name: z.string(),
    branchId: z.string().openapi({ description: 'The family’s home branch.' }),
    billingGuardianId: z
      .string()
      .nullable()
      .openapi({
        description:
          'The guardian invoices are addressed to: the first one added, until another is chosen. ' +
          'null while the family has no guardians.',
      }),
    bankReference: z
      .string()
      .nullable()
      .openapi({
        description:
          'What the family quotes on a bank transfer, so a payment can be matched to them. Set ' +
          'when the family is added, unique in the organisation, and shown on their invoices.',
        example: '7K2M9QXA',
      }),
    guardians: z.array(Guardian),
    students: z.array(Student),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Family');
export type Family = z.infer<typeof Family>;

export const CreateFamily = z
  .object({
    name: Name.openapi({ example: 'Perera' }),
    branchId: z.string().openapi({
      description: 'The family’s home branch.',
      example: 'brn_01j9z3k6m2q8w4e5r6t7y8u9i0',
    }),
  })
  .openapi('CreateFamily');
export type CreateFamily = z.infer<typeof CreateFamily>;

export const UpdateFamily = z
  .object({
    updatedAt: UpdatedAt,
    name: Name,
    branchId: z.string(),
    billingGuardianId: z.string().openapi({
      description: 'One of this family’s guardians.',
    }),
  })
  .partial()
  .required({ updatedAt: true })
  .openapi('UpdateFamily');
export type UpdateFamily = z.infer<typeof UpdateFamily>;

export const FamilyQuery = PageQuery.extend({
  branchId: z.string().optional().openapi({ description: 'Only families of this home branch' }),
});

// ── Year-end promotion (TUI-45) ─────────────────────────────────────────────

export const PromoteStudents = z
  .object({
    fromAcademicYearId: z.string().openapi({ description: 'The year whose grades move up.' }),
    toAcademicYearId: z.string().openapi({ description: 'The year that starts after it.' }),
    exceptions: z
      .array(
        z.object({
          studentId: z.string(),
          gradeLevelId: z
            .string()
            .nullable()
            .openapi({
              description:
                'The grade for the new year instead of the next one: the same grade to repeat ' +
                'it, any other, or null for none (the student has left).',
            }),
        }),
      )
      .max(1000)
      .default([])
      .refine((list) => new Set(list.map((e) => e.studentId)).size === list.length, {
        message: 'Each student once',
      }),
  })
  .refine((v) => v.fromAcademicYearId !== v.toAcademicYearId, {
    message: 'Must be another year',
    path: ['toAcademicYearId'],
  })
  .openapi('PromoteStudents');
export type PromoteStudents = z.infer<typeof PromoteStudents>;

export const PromotionResult = z
  .object({
    fromAcademicYearId: z.string(),
    toAcademicYearId: z.string(),
    promoted: z.number().int().openapi({ description: 'Moved up to the next grade.' }),
    exceptions: z.number().int().openapi({ description: 'Given the grade an exception named.' }),
    finished: z.number().int().openapi({
      description: 'In the last grade, or given none by an exception: no grade in the new year.',
    }),
    alreadySet: z.number().int().openapi({
      description: 'Already had a grade in the new year, which was left as it was.',
    }),
  })
  .openapi('PromotionResult');
export type PromotionResult = z.infer<typeof PromotionResult>;
