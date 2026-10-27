import type { PortalSession } from '@edustrux/shared';
import { addDays, eachDate } from '@edustrux/shared/dates';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageError } from '../../components/PageState';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { usePortalChildren, usePortalHolidays, usePortalSessions } from '../../lib/portal';
import { holidayOn, stepDate, viewRange } from '../../lib/timetable';
import { SkeletonRows } from '../people/parts';
import { LessonSheet, lessonMeta, PortalHeading } from './parts';
import { ReportAbsence } from './ReportAbsence';

/**
 * The parent's timetable (TUI-126, Figma "Timetable"): a week of the children's lessons by day,
 * filtered to one child with chips, with moved, cancelled and holiday days marked. A lesson opens
 * its sheet, with the homework and the teacher's note.
 */
export function PortalTimetable() {
  const format = useFormat();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<PortalSession | null>(null);
  const [reporting, setReporting] = useState<{ studentId?: string; date: string } | null>(null);
  const date = params.get('date') ?? format.today;
  const childId = params.get('child') ?? '';
  const { from, to } = viewRange('week', date);
  const thisWeek = from === viewRange('week', format.today).from;

  const children = usePortalChildren();
  const kids = children.data?.data ?? [];
  const child = kids.find((k) => k.id === childId);
  const sessions = usePortalSessions({ from, to, studentId: child?.id });
  const holidays = usePortalHolidays(
    child ? [child.branchId] : [...new Set(kids.map((k) => k.branchId))],
  );

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  const byDay = new Map<string, PortalSession[]>();
  for (const s of sessions.data?.data ?? []) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  const days = eachDate(from, to).filter((d) => byDay.has(d) || holidayOn(holidays, d));

  const dayLabel = (d: string) =>
    d === format.today
      ? t('portal.timetable.today', { date: format.dayMonth(d) })
      : d === addDays(format.today, 1)
        ? t('portal.timetable.tomorrow', { date: format.dayMonth(d) })
        : format.day(d);

  const weekBar = (
    <div className="flex">
      <button
        type="button"
        aria-label={t('portal.timetable.previous')}
        onClick={() => set({ date: stepDate('week', date, -1) })}
        className="grid h-11 w-11 place-items-center rounded-l-lg border border-border-strong bg-surface hover:bg-canvas sm:h-10"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-pressed={thisWeek}
        onClick={() => set({ date: null })}
        className="h-11 flex-1 border-y border-border-strong bg-surface px-3.5 text-label font-medium text-text hover:bg-canvas sm:h-10 sm:flex-none"
      >
        {thisWeek
          ? t('portal.timetable.thisWeek')
          : t('portal.timetable.weekOf', { date: format.dayMonth(from) })}
      </button>
      <button
        type="button"
        aria-label={t('portal.timetable.next')}
        onClick={() => set({ date: stepDate('week', date, 1) })}
        className="grid h-11 w-11 place-items-center rounded-r-lg border border-border-strong bg-surface hover:bg-canvas sm:h-10"
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );

  return (
    <div className="max-w-[880px]">
      <PortalHeading
        overline={t('portal.timetable.overline')}
        title={t('nav.timetable')}
        action={weekBar}
      />

      {kids.length > 1 ? (
        <div className="-mx-4 mb-[18px] flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {[{ id: '', firstName: t('portal.timetable.all') }, ...kids].map((kid) => {
            const on = kid.id === (child?.id ?? '');
            return (
              <button
                key={kid.id || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => set({ child: kid.id || null })}
                className={cn(
                  'h-9 shrink-0 rounded-full border border-border-strong px-3.5 text-label',
                  on ? 'bg-brand-soft font-semibold text-brand' : 'bg-surface text-text',
                )}
              >
                {kid.firstName}
              </button>
            );
          })}
        </div>
      ) : null}

      {sessions.isError ? (
        <PageError error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : sessions.isPending ? (
        <Card flush className="overflow-hidden">
          <SkeletonRows rows={4} />
        </Card>
      ) : days.length === 0 ? (
        <Card className="flex flex-col items-center py-10 text-center text-body text-muted">
          <CalendarDays className="mb-2 size-5 text-brand" aria-hidden />
          {t('portal.timetable.empty')}
        </Card>
      ) : (
        <div className="flex flex-col gap-1">
          {days.map((d) => {
            const holiday = holidayOn(holidays, d);
            const lessons = byDay.get(d) ?? [];
            return (
              <section key={d}>
                <h2 className="my-3 text-meta font-semibold tracking-[0.05em] text-muted uppercase">
                  {dayLabel(d)}
                </h2>
                <Card flush className="overflow-hidden">
                  <ul className="divide-y divide-border">
                    {holiday && lessons.length === 0 ? (
                      <li className="grid min-h-[70px] grid-cols-[58px_1fr_auto] items-center gap-2.5 px-3.5 py-2.5 sm:grid-cols-[75px_1fr_auto]">
                        <span />
                        <b className="text-label font-semibold text-text">
                          {t('portal.timetable.holiday', { name: holiday.name })}
                        </b>
                        <Badge tone="warning">{t('portal.timetable.holidayBadge')}</Badge>
                      </li>
                    ) : null}
                    {lessons.map((s) => (
                      <li key={s.id}>
                        <LessonButton session={s} onOpen={() => setOpen(s)} />
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            );
          })}
        </div>
      )}

      {open ? (
        <LessonSheet
          session={open}
          onClose={() => setOpen(null)}
          onReportAbsence={(s) => {
            setOpen(null);
            setReporting({
              studentId: child?.id ?? (s.children.length === 1 ? s.children[0]!.id : undefined),
              date: s.date,
            });
          }}
        />
      ) : null}
      {reporting ? (
        <ReportAbsence kids={kids} initial={reporting} onClose={() => setReporting(null)} />
      ) : null}
    </div>
  );
}

/** A lesson in the day's card: its start, class and who it's for, and if it moved or is off. */
function LessonButton({ session, onOpen }: { session: PortalSession; onOpen: () => void }) {
  const format = useFormat();
  const cancelled = session.status === 'cancelled';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid min-h-[70px] w-full grid-cols-[58px_1fr_auto] items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-canvas sm:grid-cols-[75px_1fr_auto]"
    >
      <time className="text-label font-semibold text-text tabular-nums">
        {format.time(session.startTime)}
      </time>
      <span className="flex min-w-0 flex-col">
        <b
          className={cn(
            'truncate text-label font-semibold text-text',
            cancelled && 'text-muted line-through',
          )}
        >
          {session.className}
        </b>
        <small className="mt-1 truncate text-meta text-muted">{lessonMeta(session)}</small>
      </span>
      {cancelled ? (
        <Badge tone="danger">{t('people.lesson.cancelled')}</Badge>
      ) : session.movedFrom ? (
        <Badge tone="warning">{t('portal.moved')}</Badge>
      ) : (
        <span />
      )}
    </button>
  );
}
