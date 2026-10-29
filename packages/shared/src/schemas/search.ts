import { z } from '../zod';

// Prefix search on normalised names, and exact email, phone and bank reference (D-026, TUI-43).

export const SearchQuery = z.object({
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .openapi({
      description:
        'A name or the start of one ("aroha per" finds Aroha Perera), an email, a phone number or ' +
        'a family’s bank reference. Case and accents don’t matter.',
      example: 'aroha per',
    }),
  limit: z.coerce.number().int().min(1).max(50).default(20).openapi({
    description: 'At most this many of each kind.',
    example: 20,
  }),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchFamily = z
  .object({
    id: z.string(),
    name: z.string(),
    branchId: z.string().openapi({ description: 'The family’s home branch.' }),
    bankReference: z.string().nullable(),
  })
  .openapi('SearchFamily');
export type SearchFamily = z.infer<typeof SearchFamily>;

export const SearchStudent = z
  .object({
    id: z.string(),
    familyId: z.string(),
    familyName: z.string(),
    branchId: z.string().openapi({ description: 'The family’s home branch.' }),
    firstName: z.string(),
    lastName: z.string(),
  })
  .openapi('SearchStudent');
export type SearchStudent = z.infer<typeof SearchStudent>;

export const SearchGuardian = z
  .object({
    id: z.string(),
    familyId: z.string(),
    familyName: z.string(),
    branchId: z.string().openapi({ description: 'The family’s home branch.' }),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  })
  .openapi('SearchGuardian');
export type SearchGuardian = z.infer<typeof SearchGuardian>;

export const SearchResults = z
  .object({
    families: z.array(SearchFamily),
    students: z.array(SearchStudent),
    guardians: z.array(SearchGuardian),
  })
  .openapi('SearchResults');
export type SearchResults = z.infer<typeof SearchResults>;

// ── Duplicate warnings ──────────────────────────────────────────────────────

export const DUPLICATE_KINDS = ['family', 'student', 'guardian'] as const;
export const DUPLICATE_REASONS = ['same_name', 'same_email', 'same_phone'] as const;
export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

const PersonName = z.string().trim().min(1).max(120);

export const DuplicateQuery = z
  .object({
    kind: z.enum(DUPLICATE_KINDS).openapi({ description: 'What is about to be added.' }),
    name: PersonName.optional().openapi({ description: 'A family’s name.' }),
    firstName: PersonName.optional(),
    lastName: PersonName.optional(),
    email: z.string().trim().toLowerCase().max(254).optional(),
    phone: z.string().trim().max(30).optional(),
  })
  .superRefine((q, ctx) => {
    const need = (field: 'name' | 'firstName' | 'lastName') => {
      if (!q[field]) ctx.addIssue({ code: 'custom', message: 'Required', path: [field] });
    };
    if (q.kind === 'family') need('name');
    if (q.kind === 'student') {
      need('firstName');
      need('lastName');
    }
    if (q.kind === 'guardian' && !(q.firstName && q.lastName) && !q.email && !q.phone) {
      ctx.addIssue({
        code: 'custom',
        message: 'Send firstName and lastName, email or phone',
        path: ['_'],
      });
    }
  });
export type DuplicateQuery = z.infer<typeof DuplicateQuery>;

const Reasons = z.array(z.enum(DUPLICATE_REASONS)).openapi({
  description: 'Why it may be the same: `same_name`, `same_email` or `same_phone` (a guardian).',
});

export const DuplicateMatches = z
  .object({
    families: z.array(SearchFamily.extend({ reasons: Reasons })),
    students: z.array(SearchStudent.extend({ reasons: Reasons })),
    guardians: z.array(SearchGuardian.extend({ reasons: Reasons })),
  })
  .openapi('DuplicateMatches');
export type DuplicateMatches = z.infer<typeof DuplicateMatches>;
