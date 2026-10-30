import type {
  AttendanceRecord,
  AttendanceStatus,
  Session,
  SessionAttendance,
  SessionNotes,
} from '@edustrux/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Minus, NotebookPen, X, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api } from '../../lib/api';
import { useRefreshClasses } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { can } from '../../lib/roles';

// A lesson's attendance, shared by the attendance sheet (TUI-112) and the teacher's quick
// attendance on Today (TUI-57): the roster, the marks and notes being drafted, and saving them.

export const attendanceKey = (orgId: string, sessionId: string) => ['attendance', orgId, sessionId];
export const notesKey = (orgId: string, sessionId: string) => [
  'attendance',
  orgId,
  sessionId,
  'notes',
];

/** Who is expected at a lesson and how each is marked, then their notes and the homework. */
export function useLessonAttendance(sessionId: string, enabled = true) {
  const { membership } = useOrg();
  const path = (rest: string) => orgApiPath(membership, `/sessions/${sessionId}${rest}`);
  const roster = useQuery({
    queryKey: attendanceKey(membership.org.id, sessionId),
    queryFn: ({ signal }) => api<SessionAttendance>('GET', path('/attendance'), { signal }),
    enabled,
  });
  const notes = useQuery({
    queryKey: notesKey(membership.org.id, sessionId),
    queryFn: ({ signal }) => api<SessionNotes>('GET', path('/notes'), { signal }),
    enabled,
  });
  return { roster, notes };
}

type Draft = Record<string, AttendanceStatus | null>;

/**
 * The marks, notes and homework on screen against what is stored, and saving the difference.
 * A student with a notice from home and no mark yet starts as excused, for staff to confirm by
 * saving. Marking opens on the lesson's day, and not once it is cancelled.
 */
export function useAttendanceDraft({
  session,
  records,
  notes,
  onSaved,
}: {
  session: Session;
  records: AttendanceRecord[];
  notes: SessionNotes | undefined;
  onSaved?: () => void;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const toast = useToast();
  const queryClient = useQueryClient();
  const refresh = useRefreshClasses();

  const cancelled = session.status === 'cancelled';
  const ahead = session.date > format.today;
  const canMark = can(membership.role, 'attendance:write') && !cancelled && !ahead;

  const [saved, setSaved] = useState<Draft>(() =>
    Object.fromEntries(records.map((r) => [r.studentId, r.status])),
  );
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(
      records.map((r) => [
        r.studentId,
        r.status ?? (canMark && r.absenceNotice ? 'excused' : null),
      ]),
    ),
  );
  const savedNotes = useMemo(
    () => Object.fromEntries((notes?.notes ?? []).map((n) => [n.studentId, n.note ?? ''])),
    [notes],
  );
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const savedHomework = notes?.homework ?? '';
  const [homework, setHomework] = useState<string | null>(null);

  const changedMarks = records.filter((r) => draft[r.studentId] !== saved[r.studentId]);
  const changedNotes = Object.entries(noteDraft).filter(
    ([id, note]) => note.trim() !== (savedNotes[id] ?? '').trim(),
  );
  const homeworkChanged = homework !== null && homework.trim() !== savedHomework.trim();
  const changes = changedMarks.length + changedNotes.length + (homeworkChanged ? 1 : 0);
  const marked = records.filter((r) => draft[r.studentId]).length;

  const save = useMutation({
    mutationFn: async () => {
      if (changedMarks.length) {
        await api('PUT', orgApiPath(membership, `/sessions/${session.id}/attendance`), {
          body: {
            records: changedMarks.map((r) => ({
              studentId: r.studentId,
              status: draft[r.studentId] ?? null,
            })),
          },
        });
      }
      if (changedNotes.length || homeworkChanged) {
        await api('PUT', orgApiPath(membership, `/sessions/${session.id}/notes`), {
          body: {
            ...(homeworkChanged && { homework: homework!.trim() || null }),
            ...(changedNotes.length && {
              notes: changedNotes.map(([studentId, note]) => ({
                studentId,
                note: note.trim() || null,
              })),
            }),
          },
        });
      }
    },
    onSuccess: async () => {
      setSaved({ ...draft });
      onSaved?.();
      toast(t('lesson.saved'));
      // The roster stays as drafted here; the lists that count marks read again.
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: notesKey(membership.org.id, session.id) }),
      ]);
    },
  });

  return {
    canMark,
    cancelled,
    ahead,
    draft,
    saved,
    marked,
    changes,
    dirty: changes > 0,
    save,
    setStatus: (studentId: string, status: AttendanceStatus | null) =>
      setDraft((d) => ({ ...d, [studentId]: status })),
    /** Everyone not marked yet, present. */
    markRest: () =>
      setDraft((d) =>
        Object.fromEntries(records.map((r) => [r.studentId, d[r.studentId] ?? 'present'])),
      ),
    note: (studentId: string) => noteDraft[studentId] ?? savedNotes[studentId] ?? '',
    setNote: (studentId: string, note: string) =>
      setNoteDraft((d) => ({ ...d, [studentId]: note })),
    homework: homework ?? savedHomework,
    setHomework,
  };
}

const STATUSES: { status: AttendanceStatus; Icon: LucideIcon; on: string }[] = [
  { status: 'present', Icon: Check, on: 'border-success bg-success-soft text-success' },
  { status: 'late', Icon: Clock, on: 'border-warning bg-warning-soft text-warning' },
  { status: 'absent', Icon: X, on: 'border-danger bg-danger-soft text-danger' },
  { status: 'excused', Icon: Minus, on: 'border-border-strong bg-canvas text-text' },
];

/** One student: their name, any notice from home, the four statuses, and a note for the family. */
export function StudentRow({
  record,
  status,
  suggested,
  onStatus,
  note,
  noteOpen,
  onToggleNote,
  onNote,
}: {
  record: AttendanceRecord;
  status: AttendanceStatus | null;
  suggested: boolean;
  onStatus?: (status: AttendanceStatus | null) => void;
  note: string;
  noteOpen: boolean;
  onToggleNote: () => void;
  onNote?: (note: string) => void;
}) {
  const name = `${record.studentFirstName} ${record.studentLastName}`;
  const notice = record.absenceNotice;
  const noteId = `note-${record.studentId}`;

  return (
    <li className="flex flex-col gap-3 px-4 py-3 md:flex-row md:flex-wrap md:items-center md:gap-4">
      {/* The name keeps room for itself: where the row is too narrow for it and the four
          buttons (a dialog), the buttons wrap onto a line of their own. */}
      <div className="flex min-w-0 flex-1 items-center gap-3 md:min-w-[14rem]">
        <Avatar name={name} className="size-9 text-meta" />
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-body font-semibold text-text">{name}</b>
          {notice ? (
            <span className="mt-0.5">
              <Badge tone="info">
                {notice.reason
                  ? t(notice.source === 'parent' ? 'lesson.awayParent' : 'lesson.awayStaff', {
                      reason: t(`absence.reason.${notice.reason}`),
                    })
                  : t(
                      notice.source === 'parent'
                        ? 'lesson.awayParentNoReason'
                        : 'lesson.awayStaffNoReason',
                    )}
              </Badge>
            </span>
          ) : !status ? (
            <small className="text-meta text-subtle">{t('lesson.notMarked')}</small>
          ) : null}
          {suggested ? (
            <small className="text-meta text-muted">{t('lesson.suggested')}</small>
          ) : null}
        </span>
        {onNote || note ? (
          <button
            type="button"
            aria-expanded={noteOpen}
            aria-controls={noteId}
            aria-label={t('lesson.noteFor', { name })}
            onClick={onToggleNote}
            className={cn(
              'grid size-11 shrink-0 place-items-center rounded-lg hover:bg-canvas md:size-9',
              note ? 'text-brand' : 'text-muted',
            )}
          >
            <NotebookPen className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div
        role="radiogroup"
        aria-label={t('lesson.statusFor', { name })}
        className="grid grid-cols-4 gap-1.5 md:flex md:w-[400px] md:shrink-0"
      >
        {STATUSES.map(({ status: value, Icon, on }) => {
          const selected = status === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!onStatus}
              // A second tap on the chosen status clears it.
              onClick={() => onStatus?.(selected ? null : value)}
              className={cn(
                'flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg border text-meta font-semibold transition-colors duration-150 md:h-9 md:flex-1 md:flex-row md:gap-1.5 md:text-label',
                selected ? on : 'border-border-strong bg-surface text-muted',
                onStatus ? (selected ? '' : 'hover:bg-canvas hover:text-text') : 'cursor-default',
                !onStatus && !selected && 'opacity-60',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t(`lesson.status.${value}`)}
            </button>
          );
        })}
      </div>

      {noteOpen ? (
        <label id={noteId} className="flex w-full flex-col gap-1.5 md:basis-full">
          <span className="text-label font-medium text-text">{t('lesson.note')}</span>
          {onNote ? (
            <>
              <textarea
                value={note}
                maxLength={2000}
                rows={2}
                autoFocus
                onChange={(e) => onNote(e.target.value)}
                className="rounded-lg border border-border-strong px-3 py-2 text-body focus:outline-2 focus:outline-brand"
              />
              <span className="text-meta text-muted">{t('lesson.noteHelp')}</span>
            </>
          ) : (
            <p className="text-body whitespace-pre-line text-text">{note}</p>
          )}
        </label>
      ) : null}
    </li>
  );
}

/** The homework set for the whole class, which families see with the lesson. */
export function HomeworkField({
  value,
  onChange,
}: {
  value: string;
  onChange?: (value: string) => void;
}) {
  if (!onChange && !value) return null;
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label font-medium text-text">
        {t('lesson.homework')}{' '}
        {onChange ? (
          <small className="text-meta font-normal text-muted">{t('lesson.optional')}</small>
        ) : null}
      </span>
      {onChange ? (
        <textarea
          value={value}
          maxLength={2000}
          rows={3}
          placeholder={t('lesson.homeworkPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[90px] rounded-lg border border-border-strong bg-surface px-3 py-2 text-body focus:outline-2 focus:outline-brand"
        />
      ) : (
        <p className="text-body whitespace-pre-line text-text">{value}</p>
      )}
    </label>
  );
}
