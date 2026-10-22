import { lessonHomework, lessonNotes, now } from '@edustrux/db';
import { and, eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { idsFrom, inIds, inOrg, writeWithAudit, type IdQuery, type OrgCtx } from '../../db/scope';

export type HomeworkRow = typeof lessonHomework.$inferSelect;
export type NoteRow = typeof lessonNotes.$inferSelect;
export type NewNoteRow = typeof lessonNotes.$inferInsert;

/** One student's note at a session. null = no note. */
export type NoteChange = { studentId: string; note: string | null };

/** A note as a write left it: `updatedAt` is when it was written, which the notes show. */
export type SavedNote = Pick<NoteRow, 'studentId' | 'note' | 'updatedAt'>;

// D1 binds at most 100 values per statement. A lesson note row binds 8.
const ROWS_PER_INSERT = 12;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** The homework set at the session, if any. */
export async function findHomework(ctx: OrgCtx, sessionId: string) {
  const [row] = await ctx.db
    .select()
    .from(lessonHomework)
    .where(inOrg(ctx, lessonHomework, eq(lessonHomework.sessionId, sessionId)));
  return row;
}

/** Every note at the session. */
export function listNotes(ctx: OrgCtx, sessionId: string) {
  return ctx.db
    .select()
    .from(lessonNotes)
    .where(inOrg(ctx, lessonNotes, eq(lessonNotes.sessionId, sessionId)));
}

/**
 * The students with a note at the session, as ids to filter another table by: their names can be
 * read in the same stage as the notes (D-104).
 */
export function studentsNotedAt(ctx: OrgCtx, sessionId: string): IdQuery {
  return idsFrom(ctx, lessonNotes, lessonNotes.studentId, eq(lessonNotes.sessionId, sessionId));
}

/**
 * Writes a session's homework and notes as one batch with one audit row. `homework` is the new
 * text, null to clear it, or undefined to leave it. `set` holds a row per note to write: a
 * student who already has one keeps their row and takes its text. `clearIds` are the rows of the
 * notes to remove. `change` is what changed, for the audit row.
 *
 * Returns the homework and the notes it wrote as they are now stored, so the caller doesn't read
 * them back.
 */
export async function saveNotes(
  ctx: OrgCtx,
  sessionId: string,
  homework: { text: string | null; before: HomeworkRow | undefined; newId: string } | undefined,
  set: (NewNoteRow & { id: string })[],
  clearIds: string[],
  change: { before: Record<string, unknown>; after: Record<string, unknown> },
) {
  const homeworkStatements = !homework
    ? []
    : homework.text === null
      ? [
          ctx.db
            .update(lessonHomework)
            .set({ deletedAt: now() })
            .where(inOrg(ctx, lessonHomework, inIds(lessonHomework.id, [homework.before!.id]))),
        ]
      : [
          ctx.db
            .insert(lessonHomework)
            .values({ id: homework.newId, orgId: ctx.orgId, sessionId, homework: homework.text })
            .onConflictDoUpdate({
              target: [lessonHomework.orgId, lessonHomework.sessionId],
              targetWhere: sql`${lessonHomework.deletedAt} is null`,
              set: { homework: sql`excluded.homework`, updatedAt: sql`excluded.updated_at` },
            })
            .returning(),
        ];
  const inserts = chunks(set, ROWS_PER_INSERT).map((rows) =>
    ctx.db
      .insert(lessonNotes)
      .values(rows)
      .onConflictDoUpdate({
        target: [lessonNotes.orgId, lessonNotes.sessionId, lessonNotes.studentId],
        targetWhere: sql`${lessonNotes.deletedAt} is null`,
        set: { note: sql`excluded.note`, updatedAt: sql`excluded.updated_at` },
      })
      .returning({
        studentId: lessonNotes.studentId,
        note: lessonNotes.note,
        updatedAt: lessonNotes.updatedAt,
      }),
  );
  const results = await writeWithAudit(
    ctx,
    [
      ...homeworkStatements,
      ...(clearIds.length
        ? [
            ctx.db
              .update(lessonNotes)
              .set({ deletedAt: now() })
              .where(inOrg(ctx, lessonNotes, inIds(lessonNotes.id, clearIds))),
          ]
        : []),
      ...inserts,
    ],
    {
      action: 'lesson_notes.updated',
      entityType: 'session',
      entityId: sessionId,
      ...change,
    },
  );
  // The batch answers in the order it was sent: the audit row, the homework, then the notes.
  const savedHomework = homework?.text != null ? (results[1] as HomeworkRow[])[0] : undefined;
  const notes = inserts.length === 0 ? [] : (results.slice(-inserts.length) as SavedNote[][]);
  return { homework: savedHomework, notes: notes.flat() };
}

/** Deletes the lesson notes on these students, when their family is erased (TUI-79). */
export function eraseStatements(ctx: OrgCtx, studentIds: string[]): BatchItem<'sqlite'>[] {
  if (studentIds.length === 0) return [];
  return [
    ctx.db
      .delete(lessonNotes)
      .where(and(eq(lessonNotes.orgId, ctx.orgId), inIds(lessonNotes.studentId, studentIds))),
  ];
}
