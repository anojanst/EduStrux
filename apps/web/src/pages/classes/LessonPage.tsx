import type {
  AttendanceRecord,
  AttendanceStatus,
  Session,
  SessionAttendance,
  SessionNotes,
} from '@edustrux/shared';
import { localNow } from '@edustrux/shared/dates';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, Clock, Minus, NotebookPen, X, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { PageError, PageLoading, errorMessage } from '../../components/PageState';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { useClassPaths, useRefreshClasses } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { can } from '../../lib/roles';
import { EmptyState } from '../people/parts';

/**
 * A lesson's attendance sheet (TUI-111): present, late, absent or excused for each student
 * expected, with a note for the family. Built for a teacher's phone first. It can be marked from
 * the lesson's own day on, and not once it is cancelled.
 */
export function LessonPage() {
  const { membership } = useOrg();
  const { sessionId = '' } = useParams();
  if (!can(membership.role, 'attendance:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <Lesson key={sessionId} sessionId={sessionId} />;
}

const attendanceKey = (orgId: string, sessionId: string) => ['attendance', orgId, sessionId];
const notesKey = (orgId: string, sessionId: string) => ['attendance', orgId, sessionId, 'notes'];

function Lesson({ sessionId }: { sessionId: string }) {
  const { membership } = useOrg();
  const path = (rest = '') => orgApiPath(membership, `/sessions/${sessionId}${rest}`);
  const session = useQuery({
    queryKey: ['session', membership.org.id, sessionId],
    queryFn: ({ signal }) => api<Session>('GET', path(), { signal }),
  });
  const roster = useQuery({
    queryKey: attendanceKey(membership.org.id, sessionId),
    queryFn: ({ signal }) => api<SessionAttendance>('GET', path('/attendance'), { signal }),
  });
  const notes = useQuery({
    queryKey: notesKey(membership.org.id, sessionId),
    queryFn: ({ signal }) => api<SessionNotes>('GET', path('/notes'), { signal }),
  });
  // Kept here: a save reads the roster again, which starts a fresh sheet.
  const [savedAt, setSavedAt] = useState<string | null>(null);

  if (session.isPending || roster.isPending) return <PageLoading />;
  if (session.isError)
    return <PageError error={session.error} onRetry={() => void session.refetch()} />;
  if (roster.isError)
    return <PageError error={roster.error} onRetry={() => void roster.refetch()} />;
  return (
    <Sheet
      // A fresh sheet when the lesson or its roster is read again, so drafts start from it.
      key={`${roster.dataUpdatedAt}`}
      session={session.data}
      records={roster.data.records}
      notes={notes.data}
      savedAt={savedAt}
      onSaved={setSavedAt}
    />
  );
}

const STATUSES: { status: AttendanceStatus; Icon: LucideIcon; on: string }[] = [
  { status: 'present', Icon: Check, on: 'border-success bg-success-soft text-success' },
  { status: 'late', Icon: Clock, on: 'border-warning bg-warning-soft text-warning' },
  { status: 'absent', Icon: X, on: 'border-danger bg-danger-soft text-danger' },
  { status: 'excused', Icon: Minus, on: 'border-border-strong bg-canvas text-text' },
];

type Filter = 'all' | 'unmarked' | 'absent';
type Draft = Record<string, AttendanceStatus | null>;

function Sheet({
  session,
  records,
  notes,
  savedAt,
  onSaved,
}: {
  session: Session;
  records: AttendanceRecord[];
  notes: SessionNotes | undefined;
  savedAt: string | null;
  onSaved: (time: string) => void;
}) {
  const { membership, org } = useOrg();
  const format = useFormat();
  const paths = useClassPaths();
  const toast = useToast();
  const queryClient = useQueryClient();
  const refresh = useRefreshClasses();

  const cancelled = session.status === 'cancelled';
  const ahead = session.date > format.today;
  const canMark = can(membership.role, 'attendance:write') && !cancelled && !ahead;

  // What is stored, and what is on screen. A student with a notice from home and no mark yet
  // starts as excused, for staff to confirm by saving.
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
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const changedMarks = records.filter((r) => draft[r.studentId] !== saved[r.studentId]);
  const changedNotes = Object.entries(noteDraft).filter(
    ([id, note]) => note.trim() !== (savedNotes[id] ?? '').trim(),
  );
  const dirty = changedMarks.length + changedNotes.length > 0;
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
      if (changedNotes.length) {
        await api('PUT', orgApiPath(membership, `/sessions/${session.id}/notes`), {
          body: {
            notes: changedNotes.map(([studentId, note]) => ({
              studentId,
              note: note.trim() || null,
            })),
          },
        });
      }
    },
    onSuccess: async () => {
      setSaved({ ...draft });
      onSaved(format.time(localNow(org?.timezone ?? 'UTC').time));
      toast(t('lesson.saved'));
      // The roster stays as drafted here; the lists that count marks read again.
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: notesKey(membership.org.id, session.id) }),
      ]);
    },
  });

  const shown = records.filter((r) =>
    filter === 'unmarked'
      ? !draft[r.studentId]
      : filter === 'absent'
        ? draft[r.studentId] === 'absent'
        : true,
  );
  const meta = [
    format.dayLong(session.date),
    format.timeRange(session.startTime, session.endTime),
    session.roomName,
    session.teacherName,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex min-h-full flex-col">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link
            to={paths.class(session.classId, 'lessons')}
            className="inline-flex items-center gap-1 text-meta font-semibold tracking-[0.05em] text-brand uppercase hover:underline"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            {t('lesson.back')}
          </Link>
          <h1 className="mt-1 text-title font-normal break-words text-text">{session.className}</h1>
          <p className="mt-1 text-body text-muted">{meta}</p>
        </div>
        {records.length ? (
          <p className="text-label font-semibold text-brand" aria-live="polite">
            {t('lesson.progress', { n: marked, total: records.length })}
            {savedAt && !dirty ? (
              <span className="ml-2 font-medium text-success">
                {t('lesson.savedAt', { time: savedAt })}
              </span>
            ) : null}
          </p>
        ) : null}
      </header>

      {cancelled ? (
        <Notice tone="danger" className="mb-4">
          {t('lesson.cancelled')}
        </Notice>
      ) : ahead ? (
        <Notice tone="info" className="mb-4">
          {t('lesson.ahead')}
        </Notice>
      ) : null}

      {records.length === 0 ? (
        <Card flush>
          <EmptyState Icon={Check} title={t('lesson.empty')} body={t('lesson.emptyBody')} />
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {canMark ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<Check className="size-4" />}
                onClick={() =>
                  setDraft((d) =>
                    Object.fromEntries(
                      records.map((r) => [r.studentId, d[r.studentId] ?? 'present']),
                    ),
                  )
                }
              >
                {t('lesson.allPresent')}
              </Button>
            ) : (
              <span />
            )}
            <div role="group" aria-label={t('lesson.filter')} className="flex gap-1.5">
              {(['all', 'unmarked', 'absent'] as const).map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={filter === name}
                  onClick={() => setFilter(name)}
                  className={cn(
                    'h-9 rounded-full border px-3 text-label font-medium',
                    filter === name
                      ? 'border-brand bg-brand-soft text-brand'
                      : 'border-border-strong bg-surface text-muted hover:text-text',
                  )}
                >
                  {t(`lesson.filter.${name}`)}
                </button>
              ))}
            </div>
          </div>

          <Card flush className="overflow-hidden">
            {shown.length === 0 ? (
              <p className="px-4 py-6 text-body text-muted">{t('lesson.filterEmpty')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {shown.map((record) => (
                  <StudentRow
                    key={record.studentId}
                    record={record}
                    status={draft[record.studentId] ?? null}
                    suggested={
                      !saved[record.studentId] &&
                      Boolean(record.absenceNotice) &&
                      draft[record.studentId] === 'excused'
                    }
                    onStatus={
                      canMark
                        ? (status) => setDraft((d) => ({ ...d, [record.studentId]: status }))
                        : undefined
                    }
                    note={noteDraft[record.studentId] ?? savedNotes[record.studentId] ?? ''}
                    noteOpen={openNote === record.studentId}
                    onToggleNote={() =>
                      setOpenNote((open) => (open === record.studentId ? null : record.studentId))
                    }
                    onNote={
                      canMark && notes
                        ? (note) => setNoteDraft((d) => ({ ...d, [record.studentId]: note }))
                        : undefined
                    }
                  />
                ))}
              </ul>
            )}
          </Card>

          {canMark ? (
            <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-border bg-surface/95 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur sm:-mx-8 sm:px-8">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                {save.error ? (
                  <p className="text-meta text-danger sm:mr-auto">{errorMessage(save.error)}</p>
                ) : dirty ? (
                  <p className="text-meta text-muted sm:mr-auto">{t('lesson.unsaved')}</p>
                ) : null}
                <Button
                  className="w-full sm:w-auto"
                  loading={save.isPending}
                  disabled={!dirty}
                  onClick={() => save.mutate()}
                >
                  {t('lesson.save')}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function StudentRow({
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
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={name} className="size-9 text-meta" />
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-body font-semibold text-text">{name}</b>
          {notice ? (
            <span className="mt-0.5">
              <Badge tone="info">
                {notice.reason
                  ? t(notice.source === 'parent' ? 'lesson.awayParent' : 'lesson.awayStaff', {
                      reason: notice.reason,
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
