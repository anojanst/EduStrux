import { z } from '../zod';
import { LocalDate, LocalTime, PageQuery, Timestamp } from './common';

/** `cancelled` arrives with one-off session changes; the generator only writes `scheduled`. */
export const SESSION_STATUSES = ['scheduled', 'cancelled'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** How far ahead sessions are generated for a class with no term: 13 weeks. */
export const OPEN_ENDED_HORIZON_DAYS = 91;
/** Most weekly slots one class can have. */
export const MAX_SCHEDULE_SLOTS = 14;

const Name = z.string().trim().min(1).max(120);
const Capacity = z.number().int().min(1).max(1000).nullable().openapi({
  description: 'How many students the class takes. null = no limit.',
  example: 12,
});
const UpdatedAt = Timestamp.openapi({
  description: 'The updatedAt you last read. A newer value on the server returns 409.',
});
const RoomId = z.string().nullable().openapi({
  description: 'A room in the class’s branch. null = not set.',
  example: 'rm_01j9z3k6m2q8w4e5r6t7y8u9i0',
});
const TeacherId = z.string().nullable().openapi({
  description: 'The membership id of the staff member who teaches the class. null = not set.',
  example: 'mem_01j9z3k6m2q8w4e5r6t7y8u9i0',
});
const StartDate = LocalDate.nullable().openapi({
  description:
    'The first day the class runs. Required when the class has no term. In a term it is ' +
    'optional and must fall inside the term; null = the term’s start.',
});
const EndDate = LocalDate.nullable().openapi({
  description:
    'The last day the class runs. null = the term’s end, or until further notice for a ' +
    'class with no term.',
});
const Weekday = z.number().int().min(1).max(7).openapi({
  description: 'ISO weekday: 1 = Monday … 7 = Sunday.',
  example: 2,
});

type Dates = { startDate?: string | null; endDate?: string | null };
/** Compared only when both are real dates; a malformed one already has its own error. */
const endNotBeforeStart = (v: Dates) =>
  !LocalDate.safeParse(v.startDate).success ||
  !LocalDate.safeParse(v.endDate).success ||
  v.endDate! >= v.startDate!;
const END_BEFORE_START = { message: 'Must be on or after startDate', path: ['endDate'] };

export const ScheduleSlot = z
  .object({ weekday: Weekday, startTime: LocalTime, endTime: LocalTime })
  .openapi('ScheduleSlot');
export type ScheduleSlot = z.infer<typeof ScheduleSlot>;

export const Class = z
  .object({
    id: z.string().openapi({ example: 'cls_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    courseId: z.string(),
    gradeLevelId: z.string().openapi({ description: 'The course’s grade level.' }),
    termId: z.string().nullable().openapi({
      description: 'null = no term: the class is open-ended from its startDate.',
    }),
    branchId: z.string(),
    roomId: z.string().nullable(),
    teacherId: z.string().nullable().openapi({
      description: 'The membership id of the staff member who teaches the class.',
    }),
    name: z.string(),
    capacity: z.number().int().nullable(),
    startDate: LocalDate.nullable(),
    endDate: LocalDate.nullable(),
    schedule: z.array(ScheduleSlot).openapi({
      description: 'The weekly slots, set with PUT /classes/{classId}/schedule.',
    }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Class');
export type Class = z.infer<typeof Class>;

export const CreateClass = z
  .object({
    courseId: z.string().openapi({ example: 'crs_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    termId: z.string().nullable().optional().openapi({
      description: 'Leave out (or null) for an open-ended class, which then needs a startDate.',
      example: 'trm_01j9z3k6m2q8w4e5r6t7y8u9i0',
    }),
    branchId: z.string().openapi({ example: 'brn_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    roomId: RoomId.optional(),
    teacherId: TeacherId.optional(),
    name: Name.openapi({ example: 'Group A' }),
    capacity: Capacity.optional(),
    startDate: StartDate.optional(),
    endDate: EndDate.optional(),
  })
  .refine(endNotBeforeStart, END_BEFORE_START)
  .refine((v) => v.termId != null || v.startDate != null, {
    message: 'Required when the class has no term',
    path: ['startDate'],
  })
  .openapi('CreateClass');
export type CreateClass = z.infer<typeof CreateClass>;

/** A class keeps its course, term and branch: none of them is here. */
export const UpdateClass = z
  .object({
    updatedAt: UpdatedAt,
    roomId: RoomId,
    teacherId: TeacherId,
    name: Name,
    capacity: Capacity,
    startDate: StartDate,
    endDate: EndDate,
  })
  .partial()
  .required({ updatedAt: true })
  .refine(endNotBeforeStart, END_BEFORE_START)
  .openapi('UpdateClass');
export type UpdateClass = z.infer<typeof UpdateClass>;

export const ClassQuery = PageQuery.extend({
  branchId: z.string().optional().openapi({ description: 'Only this branch’s classes' }),
  termId: z.string().optional().openapi({ description: 'Only this term’s classes' }),
  courseId: z.string().optional().openapi({ description: 'Only this course’s classes' }),
  gradeLevelId: z.string().optional().openapi({ description: 'Only this grade level’s classes' }),
  teacherId: z.string().optional().openapi({ description: 'Only classes this person teaches' }),
});

export const SetSchedule = z
  .object({
    slots: z
      .array(
        z
          .object({
            weekday: Weekday,
            startTime: LocalTime,
            endTime: LocalTime.optional().openapi({
              description: 'Leave out to use the course’s durationMinutes.',
              example: '17:00',
            }),
          })
          .refine(
            // Compared only when both are real times; a malformed one already has its own error.
            (s) =>
              !LocalTime.safeParse(s.startTime).success ||
              !LocalTime.safeParse(s.endTime).success ||
              s.endTime! > s.startTime,
            { message: 'Must be after startTime', path: ['endTime'] },
          ),
      )
      .max(MAX_SCHEDULE_SLOTS)
      .openapi({
        description: 'Every weekly slot of the class. An empty list clears the schedule.',
      }),
  })
  .openapi('SetSchedule');
export type SetSchedule = z.infer<typeof SetSchedule>;

export const ScheduleResult = z
  .object({
    class: Class,
    sessions: z.object({
      added: z.number().int(),
      removed: z.number().int(),
      kept: z.number().int().openapi({
        description: 'Upcoming sessions that already matched the schedule and were left alone.',
      }),
      through: LocalDate.nullable().openapi({
        description: 'The last date sessions are generated up to. null = nothing to generate.',
      }),
    }),
  })
  .openapi('ScheduleResult');
export type ScheduleResult = z.infer<typeof ScheduleResult>;

export const Session = z
  .object({
    id: z.string().openapi({ example: 'ses_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    classId: z.string(),
    className: z.string(),
    courseId: z.string(),
    branchId: z.string(),
    roomId: z.string().nullable(),
    teacherId: z.string().nullable(),
    date: LocalDate,
    startTime: LocalTime,
    endTime: LocalTime,
    startsAt: Timestamp.openapi({
      description: 'The local date and startTime as a UTC instant, in the organisation’s timezone.',
      example: '2026-10-14T03:00:00.000Z',
    }),
    endsAt: Timestamp.openapi({ example: '2026-10-14T04:00:00.000Z' }),
    status: z.enum(SESSION_STATUSES),
    movedFrom: z
      .object({ date: LocalDate, startTime: LocalTime })
      .nullable()
      .openapi({
        description:
          'Where the lesson was first scheduled, if it was moved by hand. A moved lesson is ' +
          'left alone when the weekly schedule is saved again.',
      }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Session');
export type Session = z.infer<typeof Session>;

export const UpdateSession = z
  .object({
    updatedAt: Timestamp.openapi({
      description: 'The updatedAt you last read. A newer value on the server returns 409.',
    }),
    date: LocalDate.openapi({ description: 'Move the lesson to this date.' }),
    startTime: LocalTime,
    endTime: LocalTime,
    roomId: z.string().nullable().openapi({ description: 'A room in the class’s branch.' }),
    teacherId: z.string().nullable().openapi({ description: 'An active member of staff.' }),
    status: z.enum(SESSION_STATUSES).openapi({
      description: '`cancelled` cancels the lesson; `scheduled` puts a cancelled one back on.',
    }),
    note: z.string().trim().min(1).max(500).optional().openapi({
      description: 'Added to the message families get, e.g. why it changed.',
    }),
    notify: z
      .boolean()
      .default(true)
      .openapi({
        description:
          'Tell the families of the students expected at the lesson when it moves, changes time, ' +
          'is cancelled or is back on. The notification settings can turn this off for everyone.',
      }),
  })
  .partial()
  .required({ updatedAt: true })
  .refine(
    (v) =>
      v.startTime === undefined ||
      v.endTime === undefined ||
      !LocalTime.safeParse(v.startTime).success ||
      !LocalTime.safeParse(v.endTime).success ||
      v.endTime > v.startTime,
    { message: 'Must be after startTime', path: ['endTime'] },
  )
  .openapi('UpdateSession');
export type UpdateSession = z.infer<typeof UpdateSession>;

export const SessionUpdate = z
  .object({
    session: Session,
    messageId: z.string().nullable().openapi({
      description:
        'The id the message to families gets once the queue sends it, moments later. None is ' +
        'sent when the notification settings turn lesson changes off. null when nothing was ' +
        'queued: a change families needn’t hear of, `notify: false`, or nobody expected.',
    }),
  })
  .openapi('SessionUpdate');
export type SessionUpdate = z.infer<typeof SessionUpdate>;

export const SessionQuery = PageQuery.extend({
  from: LocalDate.openapi({ description: 'The first date to include', example: '2026-10-12' }),
  to: LocalDate.openapi({ description: 'The last date to include', example: '2026-10-18' }),
  branchId: z.string().optional().openapi({ description: 'Only this branch’s sessions' }),
  roomId: z.string().optional().openapi({ description: 'Only sessions in this room' }),
  teacherId: z.string().optional().openapi({ description: 'Only sessions this person teaches' }),
  gradeLevelId: z.string().optional().openapi({ description: 'Only this grade level’s sessions' }),
  classId: z.string().optional().openapi({ description: 'Only this class’s sessions' }),
  studentId: z.string().optional().openapi({
    description:
      'Only the sessions this student is enrolled for: their classes’, on the dates each enrolment covers',
  }),
}).refine(
  (q) =>
    !LocalDate.safeParse(q.from).success || !LocalDate.safeParse(q.to).success || q.to >= q.from,
  { message: 'Must be on or after from', path: ['to'] },
);

// ── Clashes (TUI-50) ────────────────────────────────────────────────────────

export const CLASH_KINDS = ['room', 'teacher', 'student', 'grade'] as const;
export type ClashKind = (typeof CLASH_KINDS)[number];

/** At most this many days, both ends included, in one clash check. */
export const CLASH_RANGE_DAYS = 92;

export const ClashQuery = z
  .object({
    from: LocalDate.openapi({ description: 'The first date to check', example: '2026-10-12' }),
    to: LocalDate.openapi({
      description: `The last date to check, at most ${CLASH_RANGE_DAYS} days on from \`from\``,
      example: '2026-12-20',
    }),
    branchId: z.string().optional().openapi({ description: 'Only this branch’s classes' }),
  })
  .refine(
    (q) =>
      !LocalDate.safeParse(q.from).success || !LocalDate.safeParse(q.to).success || q.to >= q.from,
    { message: 'Must be on or after from', path: ['to'] },
  );

const ClashSession = z
  .object({
    id: z.string(),
    classId: z.string(),
    className: z.string(),
    branchId: z.string(),
    startTime: LocalTime,
    endTime: LocalTime,
  })
  .openapi('ClashSession');

export const Clash = z
  .object({
    kind: z.enum(CLASH_KINDS).openapi({
      description:
        '`room`: one room, two lessons. `teacher`: one teacher, two lessons. `student`: a ' +
        'student enrolled in both on that date. `grade`: two courses of the same grade level ' +
        'at once, so a student of that grade can’t take both.',
    }),
    date: LocalDate,
    sessions: z.array(ClashSession).length(2),
    roomId: z.string().nullable(),
    teacherId: z.string().nullable(),
    gradeLevelId: z.string().nullable(),
    studentId: z.string().nullable(),
    studentFirstName: z.string().nullable(),
    studentLastName: z.string().nullable(),
  })
  .openapi('Clash');
export type Clash = z.infer<typeof Clash>;
