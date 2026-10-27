import type { PortalSession } from '@edustrux/shared';
import { addDays, localNow } from '@edustrux/shared/dates';
import { ArrowRight, CalendarDays, Clock, GraduationCap, MapPin } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageError } from '../../components/PageState';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { t } from '../../i18n';
import { useFormat } from '../../lib/format';
import { useOrg } from '../../lib/org';
import { classColour } from '../../lib/people';
import {
  familyBalance,
  useLessonNotes,
  usePortalChildren,
  usePortalInvoices,
  usePortalPaths,
  usePortalSessions,
} from '../../lib/portal';
import { SkeletonRows } from '../people/parts';
import { PortalHeading, useGradeName } from './parts';
import { ReportAbsence } from './ReportAbsence';

/** How far ahead the next lesson is looked for, and back for homework. */
const LOOK_AHEAD_DAYS = 14;
const HOMEWORK_DAYS = 21;
/** Past lessons whose notes are read for homework, and how many pieces are shown. */
const HOMEWORK_LESSONS = 6;
const HOMEWORK_LINES = 3;

/**
 * The parent portal's Home (TUI-126, Figma "Parent portal"): the next lesson, reporting an
 * absence, the children, the latest homework and the family's balance.
 */
export function PortalHome({ greeting }: { greeting: string }) {
  const { membership, org } = useOrg();
  const format = useFormat();
  const paths = usePortalPaths();
  const gradeName = useGradeName();
  const [reporting, setReporting] = useState(false);
  const today = format.today;
  const now = localNow(org?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone).time;

  const children = usePortalChildren();
  const upcoming = usePortalSessions({ from: today, to: addDays(today, LOOK_AHEAD_DAYS) });
  const kids = children.data?.data ?? [];
  const next = upcoming.data?.data.find(
    (s) => s.status !== 'cancelled' && (s.date > today || s.endTime > now),
  );

  return (
    <div>
      <PortalHeading
        overline={membership.org.name}
        title={greeting}
        subtitle={t('portal.home.subtitle')}
      />

      {children.isError ? (
        <PageError error={children.error} onRetry={() => void children.refetch()} />
      ) : (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.7fr)] lg:items-start lg:gap-5">
          <div className="flex flex-col">
            {upcoming.isPending ? (
              <Card flush className="overflow-hidden">
                <SkeletonRows rows={2} />
              </Card>
            ) : next ? (
              <NextLesson session={next} grade={gradeName(gradeOf(kids, next))} />
            ) : (
              <Card className="flex items-center gap-3 text-body text-muted">
                <CalendarDays className="size-5 text-brand" aria-hidden />
                {t('portal.home.noNext')}
              </Card>
            )}
            {kids.length ? (
              <Button className="mt-3 h-11 w-full" onClick={() => setReporting(true)}>
                {t('portal.absence.title')}
              </Button>
            ) : null}

            <h2 className="mt-6 mb-2.5 text-[17px] font-medium text-text">
              {t('portal.home.children')}
            </h2>
            <Card flush className="overflow-hidden">
              {children.isPending ? (
                <SkeletonRows rows={2} />
              ) : kids.length === 0 ? (
                <p className="flex items-center gap-3 px-4 py-5 text-body text-muted">
                  <GraduationCap className="size-5" aria-hidden />
                  {t('portal.noChildren')}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {kids.map((kid) => {
                    const name = `${kid.firstName} ${kid.lastName}`;
                    const meta = [
                      gradeName(kid.gradeLevelId),
                      ...kid.enrolments.map((e) => e.className),
                    ].filter(Boolean);
                    return (
                      <li key={kid.id}>
                        <Link
                          to={`${paths.timetable}?child=${kid.id}`}
                          className="grid min-h-[68px] grid-cols-[38px_1fr_20px] items-center gap-2.5 px-3.5 py-2.5 hover:bg-canvas"
                        >
                          <Avatar name={name} className="size-[38px] text-meta" />
                          <span className="flex min-w-0 flex-col">
                            <b className="truncate text-label font-semibold text-text">{name}</b>
                            <small className="mt-1 truncate text-meta text-muted">
                              {meta.length ? meta.join(' · ') : t('portal.home.noClasses')}
                            </small>
                          </span>
                          <ArrowRight className="size-4 text-text" aria-hidden />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <LatestHomework now={now} />
          </div>

          <aside>
            <Balance />
          </aside>
        </div>
      )}

      {reporting ? <ReportAbsence kids={kids} onClose={() => setReporting(false)} /> : null}
    </div>
  );
}

/** The grade of the lesson's child, when it's for one child. */
function gradeOf(kids: { id: string; gradeLevelId: string | null }[], session: PortalSession) {
  if (session.children.length !== 1) return null;
  return kids.find((k) => k.id === session.children[0]!.id)?.gradeLevelId ?? null;
}

/** The next lesson (Figma `pp-next`): whose it is, the class, when and where, and if it moved. */
function NextLesson({ session, grade }: { session: PortalSession; grade: string }) {
  const format = useFormat();
  const who = session.children.map((c) => `${c.firstName} ${c.lastName}`).join(', ');
  const moved = session.movedFrom;
  return (
    <Card
      className="border-l-4 p-4 sm:p-5"
      style={{ borderLeftColor: classColour(session.classId) }}
    >
      <p className="mb-3 text-meta font-semibold tracking-[0.05em] text-brand uppercase">
        {t('portal.home.next')}
      </p>
      <div className="flex items-center gap-2.5">
        <Avatar name={who} className="size-[38px] text-meta" />
        <span className="flex min-w-0 flex-col">
          <b className="truncate text-label font-semibold text-text">{who}</b>
          {grade ? <small className="text-meta text-muted">{grade}</small> : null}
        </span>
        {moved ? (
          <span className="ml-auto">
            <Badge tone="warning">{t('portal.moved')}</Badge>
          </span>
        ) : null}
      </div>
      <h2 className="mt-4 mb-2.5 text-[18px] font-semibold text-text">{session.className}</h2>
      <div className="grid gap-3.5 text-label text-text sm:flex sm:flex-wrap">
        <span className="flex items-center gap-1.5">
          <CalendarDays className="size-4 text-muted" aria-hidden />
          {session.date === format.today ? t('portal.today') : format.dayLong(session.date)}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="size-4 text-muted" aria-hidden />
          {format.timeRange(session.startTime, session.endTime)}
          {moved ? (
            <del className="text-muted">
              {moved.date === session.date
                ? format.time(moved.startTime)
                : `${format.day(moved.date)} ${format.time(moved.startTime)}`}
            </del>
          ) : null}
        </span>
        {session.roomName || session.teacherName ? (
          <span className="flex items-center gap-1.5">
            <MapPin className="size-4 text-muted" aria-hidden />
            {[session.roomName, session.teacherName].filter(Boolean).join(' · ')}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * The homework set at the last few lessons, newest first. There's no homework list, so it reads
 * the notes of the most recent lessons, a handful at most.
 */
function LatestHomework({ now }: { now: string }) {
  const format = useFormat();
  const today = format.today;
  const past = usePortalSessions({ from: addDays(today, -HOMEWORK_DAYS), to: today });
  // Lessons that have started: homework is set at the lesson.
  const recent = (past.data?.data ?? [])
    .filter((s) => s.status !== 'cancelled' && (s.date < today || s.startTime <= now))
    .slice(-HOMEWORK_LESSONS)
    .reverse();
  const notes = useLessonNotes(recent.map((s) => s.id));
  const set = recent
    .map((session, i) => ({ session, homework: notes[i]?.data?.homework }))
    .filter((h): h is { session: PortalSession; homework: string } => Boolean(h.homework))
    .slice(0, HOMEWORK_LINES);
  if (set.length === 0) return null;

  return (
    <>
      <h2 className="mt-6 mb-2.5 text-[17px] font-medium text-text">{t('portal.home.homework')}</h2>
      <Card flush className="overflow-hidden">
        <ul className="divide-y divide-border">
          {set.map(({ session, homework }) => (
            <li key={session.id} className="px-4 py-3">
              <b className="text-label font-semibold text-text">
                {session.className}{' '}
                <small className="ml-1.5 text-meta font-normal text-muted">
                  {format.day(session.date)}
                </small>
              </b>
              <p className="mt-1 line-clamp-2 text-label text-muted">{homework}</p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/** The family's balance (Figma `pp-balance`): what's owed, what's overdue, and the invoices. */
function Balance() {
  const format = useFormat();
  const paths = usePortalPaths();
  const { org } = useOrg();
  const invoices = usePortalInvoices();
  if (invoices.isPending || invoices.isError) return null;
  const list = invoices.data.data;
  const { owing, overdue } = familyBalance(list, format.today);
  const currency = list[0]?.total.currency ?? org?.currency ?? 'NZD';
  return (
    <Card className="flex flex-col items-start gap-2.5 p-[18px]">
      <span className="text-label text-muted">{t('portal.balance.title')}</span>
      <strong className="text-[26px] leading-8 font-medium text-text tabular-nums">
        {format.money({ amount: owing, currency })}
      </strong>
      {overdue ? (
        <Badge tone="danger">
          {t('portal.balance.overdue', { amount: format.money({ amount: overdue, currency }) })}
        </Badge>
      ) : owing === 0 ? (
        <Badge tone="success">{t('portal.balance.paid')}</Badge>
      ) : null}
      <Link
        to={paths.invoices}
        className="flex min-h-11 items-center gap-1.5 text-label font-semibold text-brand hover:underline md:min-h-0 md:py-1"
      >
        {t('portal.balance.view')}
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </Card>
  );
}
