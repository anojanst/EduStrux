import type { PortalChild, PortalSession } from '@edustrux/shared';
import { CalendarDays, Clock, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { t } from '../../i18n';
import { useFormat } from '../../lib/format';
import { namesOf, useGradeLevels } from '../../lib/people';
import { useLessonNotes } from '../../lib/portal';

/** The portal's page heading: a brand overline, the title and a muted line (Figma `pp-heading`). */
export function PortalHeading({
  overline,
  title,
  subtitle,
  action,
}: {
  overline: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3.5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="mb-1 text-meta font-semibold tracking-[0.05em] text-brand uppercase">
          {overline}
        </p>
        <h1 className="text-[24px] leading-[30px] font-normal tracking-[-0.02em] text-text sm:text-title">
          {title}
        </h1>
        {subtitle ? <p className="mt-1 text-label text-muted sm:text-body">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

/** "Year 9", the child's grade this year, or nothing while the grades load. */
export function useGradeName() {
  const grades = useGradeLevels();
  return namesOf(grades.data?.data);
}

/** "Aria" or "Aria, Kavi": who a lesson is for. */
export function childNames(session: PortalSession) {
  return session.children.map((c) => c.firstName).join(', ');
}

/** "Kavi · Room 3 · Ms Perera": a lesson's meta line in the portal. */
export function lessonMeta(session: PortalSession) {
  return [childNames(session), session.roomName, session.teacherName].filter(Boolean).join(' · ');
}

/**
 * One lesson (Figma `pp-lesson`): when and where, the homework set, the teacher's note about each
 * of the parent's children, and reporting an absence for it while it's still to come.
 */
export function LessonSheet({
  session,
  onClose,
  onReportAbsence,
}: {
  session: PortalSession;
  onClose: () => void;
  onReportAbsence: (session: PortalSession) => void;
}) {
  const format = useFormat();
  const [notes] = useLessonNotes([session.id]);
  const cancelled = session.status === 'cancelled';
  const ahead = session.date >= format.today && !cancelled;
  const mine = new Map(session.children.map((c) => [c.id, c.firstName]));
  const childNotes = (notes?.data?.notes ?? []).filter((n) => mine.has(n.studentId) && n.note);

  return (
    <Dialog
      open
      onClose={onClose}
      title={session.className}
      subtitle={session.children.map((c) => `${c.firstName} ${c.lastName}`).join(', ')}
      actions={
        ahead ? (
          <Button onClick={() => onReportAbsence(session)}>
            {t('portal.lesson.reportAbsence')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2.5 text-label text-text">
        {cancelled ? (
          <span>
            <Badge tone="danger">{t('people.lesson.cancelled')}</Badge>
          </span>
        ) : null}
        <span className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted" aria-hidden />
          {session.date === format.today ? t('portal.today') : format.dayLong(session.date)}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Clock className="size-4 text-muted" aria-hidden />
          {format.timeRange(session.startTime, session.endTime)}
          {session.movedFrom ? (
            <del className="text-muted">
              {session.movedFrom.date === session.date
                ? format.time(session.movedFrom.startTime)
                : `${format.day(session.movedFrom.date)} ${format.time(session.movedFrom.startTime)}`}
            </del>
          ) : null}
        </span>
        {session.roomName || session.teacherName ? (
          <span className="flex items-center gap-2">
            <MapPin className="size-4 text-muted" aria-hidden />
            {[session.roomName, session.teacherName].filter(Boolean).join(' · ')}
          </span>
        ) : null}
      </div>

      {notes?.data?.homework ? (
        <>
          <h3 className="mt-5 text-label font-semibold text-text">{t('portal.lesson.homework')}</h3>
          <p className="mt-1 text-label whitespace-pre-line text-muted">{notes.data.homework}</p>
        </>
      ) : null}
      {childNotes.map((note) => (
        <div key={note.studentId}>
          <h3 className="mt-5 text-label font-semibold text-text">
            {t('portal.lesson.note', { name: mine.get(note.studentId) ?? '' })}
          </h3>
          <p className="mt-1 text-label whitespace-pre-line text-muted">{note.note}</p>
        </div>
      ))}
    </Dialog>
  );
}

/** The children a parent picks between, for the timetable's chips and an absence. */
export type Child = Pick<PortalChild, 'id' | 'firstName' | 'lastName' | 'branchId'>;
