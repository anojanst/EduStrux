import { z } from '../zod';
import { LocalDate, LocalTime, PageQuery, Timestamp } from './common';

// Public enquiry and enrolment forms, and staff approving what they bring in (TUI-47). The
// public routes are under `/api/v1/public/{orgSlug}` and need no sign-in (D-020).

export const ENQUIRY_STATUSES = ['new', 'handled'] as const;
export const ENROLMENT_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;

const Name = z.string().trim().min(1).max(80);
const Email = z.string().trim().toLowerCase().max(254).email();
const Phone = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(/^[0-9+() .-]+$/, 'Digits, spaces and + ( ) . - only');

/** What every public form also carries, against bots. */
const Guarded = {
  website: z.string().max(200).optional().openapi({
    description: 'Leave empty. A hidden field: a form that fills it in is taken for a bot.',
  }),
  turnstileToken: z.string().max(2048).optional().openapi({
    description: 'The Cloudflare Turnstile token, once the organisation turns Turnstile on.',
  }),
};

export const PublicForm = z
  .object({
    orgName: z.string(),
    branches: z.array(z.object({ id: z.string(), name: z.string() })),
    classes: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        branchId: z.string(),
        courseId: z.string(),
        gradeLevelId: z.string(),
        startDate: LocalDate.nullable(),
        endDate: LocalDate.nullable(),
        schedule: z.array(
          z.object({ weekday: z.number().int(), startTime: LocalTime, endTime: LocalTime }),
        ),
      }),
    ),
    subjects: z.array(z.object({ id: z.string(), name: z.string() })),
    gradeLevels: z.array(z.object({ id: z.string(), name: z.string() })),
    courses: z.array(z.object({ id: z.string(), subjectId: z.string(), gradeLevelId: z.string() })),
  })
  .openapi('PublicForm');
export type PublicForm = z.infer<typeof PublicForm>;

export const CreateEnquiry = z
  .object({
    name: Name.openapi({ example: 'Mere Perera' }),
    email: Email,
    phone: Phone.optional(),
    studentName: Name.optional(),
    branchId: z.string().optional(),
    message: z.string().trim().min(1).max(2000),
    ...Guarded,
  })
  .openapi('CreateEnquiry');
export type CreateEnquiry = z.infer<typeof CreateEnquiry>;

export const CreateEnrolmentRequest = z
  .object({
    guardian: z.object({
      firstName: Name,
      lastName: Name,
      email: Email,
      phone: Phone.optional(),
    }),
    students: z
      .array(
        z.object({
          firstName: Name,
          lastName: Name,
          classIds: z.array(z.string()).min(1).max(10),
        }),
      )
      .min(1)
      .max(10),
    branchId: z.string().optional().openapi({ description: 'The family’s home branch, if known.' }),
    notes: z.string().trim().max(2000).optional(),
    ...Guarded,
  })
  .openapi('CreateEnrolmentRequest');
export type CreateEnrolmentRequest = z.infer<typeof CreateEnrolmentRequest>;

/** What the public routes answer: a thank-you, with nothing about what is on record. */
export const Received = z
  .object({ received: z.literal(true), id: z.string().nullable() })
  .openapi('Received');

export const Enquiry = z
  .object({
    id: z.string(),
    branchId: z.string().nullable(),
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    studentName: z.string().nullable(),
    message: z.string(),
    status: z.enum(ENQUIRY_STATUSES),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Enquiry');
export type Enquiry = z.infer<typeof Enquiry>;

export const EnquiryQuery = PageQuery.extend({ status: z.enum(ENQUIRY_STATUSES).optional() });

export const UpdateEnquiry = z
  .object({
    updatedAt: Timestamp,
    status: z.enum(ENQUIRY_STATUSES),
  })
  .openapi('UpdateEnquiry');

export const EnrolmentRequest = z
  .object({
    id: z.string(),
    branchId: z.string().nullable(),
    status: z.enum(ENROLMENT_REQUEST_STATUSES),
    guardian: z.object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      phone: z.string().nullable(),
    }),
    students: z.array(
      z.object({
        firstName: z.string(),
        lastName: z.string(),
        classIds: z.array(z.string()),
      }),
    ),
    notes: z.string().nullable(),
    decidedAt: Timestamp.nullable(),
    reason: z.string().nullable(),
    result: z
      .object({
        familyId: z.string(),
        guardianId: z.string().nullable(),
        studentIds: z.array(z.string()),
        enrolmentIds: z.array(z.string()),
        skipped: z.array(
          z.object({ studentIndex: z.number().int(), classId: z.string(), reason: z.string() }),
        ),
      })
      .nullable()
      .openapi({ description: 'What approving it made. null until approved.' }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('EnrolmentRequest');
export type EnrolmentRequest = z.infer<typeof EnrolmentRequest>;

export const EnrolmentRequestQuery = PageQuery.extend({
  status: z.enum(ENROLMENT_REQUEST_STATUSES).optional(),
});

export const ApproveEnrolmentRequest = z
  .object({
    familyId: z
      .string()
      .optional()
      .openapi({
        description:
          'Add the children to this family, already on record, instead of a new one. Its guardian ' +
          'with the same email is used, or one is added.',
      }),
    branchId: z.string().optional().openapi({
      description:
        'The new family’s home branch. Defaults to the request’s, else the first class’s branch.',
    }),
  })
  .openapi('ApproveEnrolmentRequest');
export type ApproveEnrolmentRequest = z.infer<typeof ApproveEnrolmentRequest>;

export const RejectEnrolmentRequest = z
  .object({ reason: z.string().trim().max(500).optional() })
  .openapi('RejectEnrolmentRequest');
