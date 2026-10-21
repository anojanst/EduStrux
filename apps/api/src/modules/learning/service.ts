import {
  newId,
  normaliseName,
  type LessonNote,
  type SessionNotes,
  type UpdateSessionNotes,
} from '@edustrux/shared';
import type { Access, OrgCtx } from '../../db/scope';
import { unprocessable } from '../../lib/errors';
import { classOfSession } from '../classes/for-attendance';
import * as classes from '../classes/service';
import { studentsExpectedIn } from '../enrolment/for-attendance';
import * as enrolment from '../enrolment/service';
import * as people from '../people/service';
import * as repo from './repository';

// A lesson's notes (D-130): the homework set for the whole class, and a note on any student. They
// are reached through the session like its attendance (D-073): staff and the class's teacher read
// and write them, and a parent reads the homework and their own children's notes.

type StudentNames = Awaited<ReturnType<typeof people.studentNames>>;
/** What the notes show of a student's note: its text, and when it was written. */
type NoteShown = Pick<repo.NoteRow, 'note' | 'updatedAt'>;

/**
 * Whose names the notes may need, asked for before the roster is known. Staff and the class's
 * teacher see everyone on it: the students enrolled in the session's class, and anyone with a
 * note. A parent sees their own children only, so theirs are the only names read, and a student
 * with no name here is left out.
 */
function namesFor(ctx: OrgCtx, access: Access, sessionId: string): Promise<StudentNames>[] {
  if (access.scope === 'own' && access.role === 'parent') {
    return [people.studentNames(ctx, people.studentsOfGuardian(ctx, access.membershipId))];
  }
  return [
    people.studentNames(ctx, enrolment.studentsOnRollOf(ctx, classOfSession(ctx, sessionId))),
    people.studentNames(ctx, repo.studentsNotedAt(ctx, sessionId)),
  ];
}

/**
 * Everything a session's notes are built from, in one stage (D-102). The session, read as the
 * caller may see it, answers first: outside the caller's reach it is 404, and nothing the other
 * reads found is used.
 */
async function readNotes(ctx: OrgCtx, access: Access, sessionId: string) {
  const [session, found] = await Promise.allSettled([
    classes.getSession(ctx, access, sessionId),
    Promise.all([
      repo.findHomework(ctx, sessionId),
      repo.listNotes(ctx, sessionId),
      studentsExpectedIn(ctx, classOfSession(ctx, sessionId)),
      Promise.all(namesFor(ctx, access, sessionId)),
    ]),
  ]);
  if (session.status === 'rejected') throw session.reason;
  if (found.status === 'rejected') throw found.reason;

  const [homework, notes, expectedOn, names] = found.value;
  return {
    session: session.value,
    homework,
    notes: new Map(notes.map((note) => [note.studentId, note])),
    /** Who is expected: the students whose active enrolment covers the session's date. */
    expected: expectedOn(session.value.date),
    names: new Map(names.flatMap((answer) => [...answer])),
  };
}

/** The notes as the API returns them: one per student on the roster, by last then first name. */
function toSessionNotes(
  sessionId: string,
  homework: Pick<repo.HomeworkRow, 'homework' | 'updatedAt'> | undefined,
  expected: string[],
  notes: Map<string, NoteShown>,
  names: StudentNames,
): SessionNotes {
  const studentIds = [...new Set([...expected, ...notes.keys()])];
  const rows = studentIds.flatMap((studentId): (LessonNote & { key: string })[] => {
    const name = names.get(studentId);
    if (!name) return [];
    const note = notes.get(studentId);
    return [
      {
        key: [normaliseName(name.lastName), normaliseName(name.firstName), studentId].join('\0'),
        studentId,
        studentFirstName: name.firstName,
        studentLastName: name.lastName,
        note: note?.note ?? null,
        updatedAt: note?.updatedAt ?? null,
      },
    ];
  });
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    sessionId,
    homework: homework?.homework ?? null,
    homeworkUpdatedAt: homework?.updatedAt ?? null,
    notes: rows.map(({ key: _key, ...row }) => row),
  };
}

/** A session's notes as the caller may see them. A parent sees their own children's only. */
export async function getNotes(
  ctx: OrgCtx,
  access: Access,
  sessionId: string,
): Promise<SessionNotes> {
  const { homework, notes, expected, names } = await readNotes(ctx, access, sessionId);
  return toSessionNotes(sessionId, homework, expected, notes, names);
}

/**
 * Writes the homework, some students' notes, or both, and leaves the rest as they are. Notes can
 * be written before, on or after the lesson's day, not on a cancelled session (422), and only for
 * students on its roster (422).
 *
 * The answer is the notes as they were read, with this request's changes as the write stored
 * them. It isn't read again.
 */
export async function updateNotes(
  ctx: OrgCtx,
  access: Access,
  sessionId: string,
  input: UpdateSessionNotes,
): Promise<SessionNotes> {
  const { session, homework, notes, expected, names } = await readNotes(ctx, access, sessionId);
  if (session.status === 'cancelled') {
    throw unprocessable("This session is cancelled, so its notes can't be written.");
  }

  const onRoster = new Set([...expected, ...notes.keys()]);
  const fields: Record<string, string[]> = {};
  input.notes?.forEach((entry, index) => {
    if (!onRoster.has(entry.studentId)) {
      fields[`notes.${index}.studentId`] = ['Not enrolled for this session'];
    }
  });
  if (Object.keys(fields).length > 0) {
    throw unprocessable(
      "Only students enrolled in the class on the session's date get notes.",
      fields,
    );
  }

  const homeworkChanges =
    input.homework !== undefined && input.homework !== (homework?.homework ?? null);
  const changed = (input.notes ?? []).filter(
    (entry) => (notes.get(entry.studentId)?.note ?? null) !== entry.note,
  );
  if (!homeworkChanges && changed.length === 0) {
    return toSessionNotes(sessionId, homework, expected, notes, names);
  }

  // The audit row keeps only what changed (D-113).
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if (homeworkChanges) {
    before.homework = homework?.homework ?? null;
    after.homework = input.homework;
  }
  if (changed.length > 0) {
    before.notes = changed.map(({ studentId }) => ({
      studentId,
      note: notes.get(studentId)?.note ?? null,
    }));
    after.notes = changed.map(({ studentId, note }) => ({ studentId, note }));
  }

  const saved = await repo.saveNotes(
    ctx,
    sessionId,
    homeworkChanges
      ? { text: input.homework ?? null, before: homework, newId: newId('lessonHomework') }
      : undefined,
    changed.flatMap(({ studentId, note }) =>
      note === null
        ? []
        : [{ id: newId('lessonNote'), orgId: ctx.orgId, sessionId, studentId, note }],
    ),
    changed.flatMap((entry) => (entry.note === null ? [notes.get(entry.studentId)!.id] : [])),
    { before, after },
  );

  const notesNow = new Map<string, NoteShown>(notes);
  for (const { studentId, note } of changed) if (note === null) notesNow.delete(studentId);
  for (const note of saved.notes) notesNow.set(note.studentId, note);
  const homeworkNow = homeworkChanges ? saved.homework : homework;
  return toSessionNotes(sessionId, homeworkNow, expected, notesNow, names);
}
