import type { AttendanceRecord, Session, SessionNotes } from '@edustrux/shared';
import { localNow } from '@edustrux/shared/dates';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { PageError, PageLoading, errorMessage } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Notice } from '../../components/ui/Notice';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { useClassPaths } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { can } from '../../lib/roles';
import { EmptyState } from '../people/parts';
import { HomeworkField, StudentRow, useAttendanceDraft, useLessonAttendance } from './attendance';

/**
 * A lesson's attendance sheet (TUI-112): present, late, absent or excused for each student
 * expected, with a note for the family and the class's homework. Built for a teacher's phone first. It can be marked from
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

function Lesson({ sessionId }: { sessionId: string }) {
  const { membership } = useOrg();
  const session = useQuery({
    queryKey: ['session', membership.org.id, sessionId],
    queryFn: ({ signal }) =>
      api<Session>('GET', orgApiPath(membership, `/sessions/${sessionId}`), { signal }),
  });
  const { roster, notes } = useLessonAttendance(sessionId);
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

type Filter = 'all' | 'unmarked' | 'absent';

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
  const { org } = useOrg();
  const format = useFormat();
  const paths = useClassPaths();
  const sheet = useAttendanceDraft({
    session,
    records,
    notes,
    onSaved: () => onSaved(format.time(localNow(org?.timezone ?? 'UTC').time)),
  });
  const { canMark, cancelled, ahead, draft, saved, save, dirty, marked } = sheet;
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

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
                onClick={sheet.markRest}
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
                      canMark ? (status) => sheet.setStatus(record.studentId, status) : undefined
                    }
                    note={sheet.note(record.studentId)}
                    noteOpen={openNote === record.studentId}
                    onToggleNote={() =>
                      setOpenNote((open) => (open === record.studentId ? null : record.studentId))
                    }
                    onNote={
                      canMark && notes ? (note) => sheet.setNote(record.studentId, note) : undefined
                    }
                  />
                ))}
              </ul>
            )}
          </Card>

          <div className="mt-4">
            <HomeworkField
              value={sheet.homework}
              onChange={canMark && notes ? sheet.setHomework : undefined}
            />
          </div>

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
