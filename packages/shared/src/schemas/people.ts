import { z } from '../zod';
import { LocalDate, PageQuery, Timestamp } from './common';

/** How a guardian prefers to hear from the centre. Only email is sent so far. */
export const CONTACT_CHANNELS = ['email', 'sms', 'whatsapp'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

const Name = z.string().trim().min(1).max(120);
const PersonName = z.string().trim().min(1).max(80);
const UpdatedAt = Timestamp.openapi({
  description: 'The updatedAt you last read. A newer value on the server returns 409.',
});
const Address = z.string().trim().max(500).nullable();
const Relationship = z.string().trim().min(1).max(60).nullable().openapi({
  description: 'How this person is related to the students. null = not set.',
  example: 'Mother',
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
const Language = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'A language tag like en, mi or si')
  .nullable()
  .openapi({
    description: 'The guardian’s preferred language. Stored only; nothing uses it yet.',
    example: 'en',
  });
const EmergencyContact = z.boolean().openapi({
  description: 'Whether to call this person in an emergency.',
});
const Notes = z.string().trim().max(2000).nullable().openapi({
  description: 'Anything staff should know about the student. null = not set.',
});
const DateOfBirth = LocalDate.nullable().openapi({
  description: 'Can’t be in the future. null = not set.',
  example: '2012-05-17',
});

// ── Guardians ───────────────────────────────────────────────────────────────

export const Guardian = z
  .object({
    id: z.string().openapi({ example: 'gdn_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    familyId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    relationship: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    preferredChannel: z.enum(CONTACT_CHANNELS),
    language: z.string().nullable(),
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
    relationship: Relationship.optional(),
    email: Email.optional(),
    phone: Phone.optional(),
    preferredChannel: PreferredChannel.default('email'),
    language: Language.optional(),
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
    relationship: Relationship,
    email: Email,
    phone: Phone,
    preferredChannel: PreferredChannel,
    language: Language,
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
    branchId: z.string().openapi({ description: 'The family’s home branch.' }),
    firstName: z.string(),
    lastName: z.string(),
    dateOfBirth: LocalDate.nullable(),
    notes: z.string().nullable(),
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
    dateOfBirth: DateOfBirth.optional(),
    notes: Notes.optional(),
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
    dateOfBirth: DateOfBirth,
    notes: Notes,
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
    address: z.string().nullable(),
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
    address: Address.optional().openapi({ example: '4 Kowhai Street, Albany, Auckland' }),
  })
  .openapi('CreateFamily');
export type CreateFamily = z.infer<typeof CreateFamily>;

export const UpdateFamily = z
  .object({
    updatedAt: UpdatedAt,
    name: Name,
    branchId: z.string(),
    address: Address,
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
