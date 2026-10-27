import type { AttendanceRecord, Session, SessionNotes } from '@edustrux/shared';
import { useState } from 'react';
import { errorMessage } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Notice } from '../../components/ui/Notice';
import { Spinner } from '../../components/ui/Spinner';
import { t } from '../../i18n';
import { useFormat } from '../../lib/format';
import {
  HomeworkField,
  StudentRow,
  useAttendanceDraft,
  useLessonAttendance,
} from '../classes/attendance';

/**
 * Taking a lesson's attendance without leaving Today (TUI-57): the attendance sheet's rows in a
 * dialog, full height on phones. Saving closes it; the lesson's row then shows its marks.
 */
export function QuickAttendance({ session, onClose }: { session: Session; onClose: () => void }) {
  const format = useFormat();
  const { roster, notes } = useLessonAttendance(session.id);
  const subtitle = [format.timeRange(session.startTime, session.endTime), session.roomName]
    .filter(Boolean)
    .join(' · ');

  if (roster.isPending || roster.isError) {
    return (
      <Dialog open onClose={onClose} title={session.className} subtitle={subtitle} wide>
        {roster.isError ? (
          <Notice tone="danger">{errorMessage(roster.error)}</Notice>
        ) : (
          <div className="flex justify-center py-10 text-muted">
            <Spinner className="size-6" label={t('common.loading')} />
          </div>
        )}
      </Dialog>
    );
  }
  return (
    <Sheet
      session={session}
      subtitle={subtitle}
      records={roster.data.records}
      notes={notes.data}
      onClose={onClose}
    />
  );
}

function Sheet({
  session,
  subtitle,
  records,
  notes,
  onClose,
}: {
  session: Session;
  subtitle: string;
  records: AttendanceRecord[];
  notes: SessionNotes | undefined;
  onClose: () => void;
}) {
  const sheet = useAttendanceDraft({ session, records, notes, onSaved: onClose });
  const { canMark, draft, saved, save, dirty, marked, changes } = sheet;
  const [openNote, setOpenNote] = useState<string | null>(null);

  return (
    <Dialog
      open
      onClose={onClose}
      title={session.className}
      subtitle={subtitle}
      wide
      actions={
        canMark && records.length ? (
          <div className="flex w-full items-center justify-end gap-3.5">
            <span className="text-meta text-muted max-md:hidden">
              {save.error
                ? errorMessage(save.error)
                : dirty
                  ? t(changes === 1 ? 'today.changes.one' : 'today.changes', { n: changes })
                  : null}
            </span>
            <Button
              className="min-w-[170px] max-md:flex-1"
              loading={save.isPending}
              disabled={!dirty}
              onClick={() => save.mutate()}
            >
              {t('lesson.save')}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {sheet.cancelled ? (
          <Notice tone="danger">{t('lesson.cancelled')}</Notice>
        ) : sheet.ahead ? (
          <Notice tone="info">{t('lesson.ahead')}</Notice>
        ) : null}
        {records.length === 0 ? (
          <p className="text-body text-muted">{t('lesson.empty')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-label font-semibold text-brand" aria-live="polite">
                {t('lesson.progress', { n: marked, total: records.length })}
              </strong>
              {canMark ? (
                <Button variant="ghost" size="sm" onClick={sheet.markRest}>
                  {t('lesson.allPresent')}
                </Button>
              ) : null}
            </div>
            {save.error ? (
              <p className="text-meta text-danger md:hidden">{errorMessage(save.error)}</p>
            ) : null}
            <Card flush className="overflow-hidden">
              <ul className="divide-y divide-border">
                {records.map((record) => (
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
            </Card>
            <HomeworkField
              value={sheet.homework}
              onChange={canMark && notes ? sheet.setHomework : undefined}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
