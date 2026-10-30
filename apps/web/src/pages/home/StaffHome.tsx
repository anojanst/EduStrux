import type { BillingOverview, Dashboard, Session } from '@edustrux/shared';
import { addDays, localNow } from '@edustrux/shared/dates';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  FileStack,
  GraduationCap,
  MessageSquareWarning,
  ReceiptText,
  RotateCcw,
  School,
  Sparkles,
  TriangleAlert,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { PageError } from '../../components/PageState';
import { Badge } from '../../components/ui/Badge';
import { Button, buttonClass } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { t, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { markedCount } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { orgBanner, seesTrialBanner } from '../../lib/orgStatus';
import { query, type Page } from '../../lib/people';
import { can, type Role } from '../../lib/roles';
import { orgPath } from '../../lib/session';
import { RecordPaymentDialog } from '../billing/RecordPaymentDialog';
import { RunInvoicesDialog } from '../billing/RunInvoicesDialog';
import { ClassDialog } from '../classes/ClassDialog';
import { AddFamilyDialog } from '../people/AddFamilyDialog';
import { SkeletonRows } from '../people/parts';
import { useSetupProgress } from '../setup/SetupPage';
import { LessonRow } from '../today/TeacherToday';
import { QuickAttendance } from '../today/QuickAttendance';

/** How far back "Attendance to take" looks for lessons left unmarked, as the dashboard does. */
const LOOK_BACK_DAYS = 14;

/**
 * The staff Home (TUI-130, from the owner's Figma Make design) for the owner, branch managers,
 * front desk and accountants: the trial, four counts for today, today's lessons with the next
 * one picked out, money at a glance, and for the owner what's left to set up and how close the
 * plan's student limit is. Each part shows only to the roles that can read it.
 */
export function StaffHome({ overline, greeting }: { overline: string; greeting: string }) {
  const { membership, org } = useOrg();
  const format = useFormat();
  const [marking, setMarking] = useState<Session | null>(null);
  const role = membership.role;
  const orgId = membership.org.id;
  const today = format.today;
  const now = localNow(org?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone).time;
  const readsReports = can(role, 'reports:read');
  const readsLessons = can(role, 'classes:read');
  const marks = can(role, 'attendance:write');
  const owner = can(role, 'org:write');

  const dashboard = useQuery({
    queryKey: ['dashboard', orgId],
    queryFn: ({ signal }) =>
      api<Dashboard>('GET', orgApiPath(membership, '/reports/dashboard'), { signal }),
    enabled: readsReports,
  });
  const sessions = useQuery({
    queryKey: ['sessions', orgId, { from: today, to: today }],
    queryFn: ({ signal }) =>
      api<Page<Session>>(
        'GET',
        orgApiPath(membership, `/sessions${query({ from: today, to: today, limit: 200 })}`),
        { signal },
      ),
    enabled: readsLessons,
  });

  const todays = sessions.data?.data ?? [];
  const live = todays.filter((s) => s.status !== 'cancelled');
  const unmarked = (s: Session) => s.attendance !== undefined && markedCount(s) === 0;
  const unmarkedToday = live.filter(unmarked);
  const toMarkToday = unmarkedToday.filter((s) => s.startTime <= now);
  // The dashboard counts today's unmarked lessons too, even those still to start.
  const earlier =
    dashboard.data && sessions.isSuccess
      ? Math.max(0, dashboard.data.unmarkedLessons - unmarkedToday.length)
      : 0;
  const toTake = toMarkToday.length + earlier;
  const next = live.find((s) => s.endTime > now);

  // The oldest lesson left unmarked, for "Attendance to take" to open. Lessons come oldest
  // first, so the first page holds it.
  const yesterday = addDays(today, -1);
  const from = addDays(today, -LOOK_BACK_DAYS);
  const past = useQuery({
    queryKey: ['sessions', orgId, { from, to: yesterday }],
    queryFn: ({ signal }) =>
      api<Page<Session>>(
        'GET',
        orgApiPath(membership, `/sessions${query({ from, to: yesterday, limit: 200 })}`),
        { signal },
      ),
    enabled: marks && earlier > 0,
  });
  const oldest =
    past.data?.data.find((s) => s.status !== 'cancelled' && unmarked(s)) ?? toMarkToday[0];

  const base = orgPath(membership.org.slug);
  const data = dashboard.data;
  const banner = org ? orgBanner(org) : null;
  const trialDays = banner?.kind === 'trial' && seesTrialBanner(role) ? banner.daysLeft : null;
  // The right column: the owner's checklist and plan, and anyone's quick actions (TUI-134).
  const side = owner || actionsFor(role).length > 0;
  // A centre with no classes yet: other staff get the first steps; the owner has the checklist.
  const starting = !owner && data?.classes === 0 && can(role, 'classes:write');

  return (
    <div>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-meta font-semibold tracking-[0.05em] text-brand uppercase">
            {overline}
          </p>
          <h1 className="mt-1 text-title font-normal text-text">{greeting}</h1>
          <p className="mt-1 text-body text-muted">
            {t('home.happening', { org: membership.org.name })}
          </p>
        </div>
        {trialDays !== null ? (
          <span className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-full bg-[#efeafc] px-3 text-meta font-semibold text-[#5b3fb5]">
            <Sparkles className="size-3.5" aria-hidden />
            {t('home.trialPill')}
          </span>
        ) : null}
      </header>

      {trialDays !== null ? <TrialCard daysLeft={trialDays} owner={owner} /> : null}

      {dashboard.isError ? (
        <PageError error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : null}

      {readsLessons || data ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 sm:gap-4 2xl:grid-cols-4">
          {readsLessons ? (
            <HomeStat
              Icon={CalendarDays}
              tone="info"
              label={t('home.stat.today')}
              value={sessions.isSuccess ? live.length : '–'}
              note={
                next
                  ? t('home.stat.nextAt', { time: format.time(next.startTime) })
                  : t('home.stat.noneLeft')
              }
              to={`${base}/timetable`}
            />
          ) : null}
          {readsLessons ? (
            <HomeStat
              Icon={ClipboardCheck}
              tone="warning"
              label={t('home.stat.attendance')}
              value={sessions.isSuccess ? toTake : '–'}
              note={t('home.stat.attendanceNote')}
              onClick={marks && oldest ? () => setMarking(oldest) : undefined}
            />
          ) : null}
          {data ? (
            <HomeStat
              Icon={RotateCcw}
              tone="brand"
              label={t('home.stat.makeups')}
              value={data.makeupCreditsAvailable}
              note={t('home.stat.makeupsNote')}
            />
          ) : null}
          {data ? (
            <HomeStat
              Icon={MessageSquareWarning}
              tone="danger"
              label={t('home.stat.away')}
              value={data.today.absenceNotices}
              note={t('home.stat.awayNote')}
              to={`${base}/timetable`}
            />
          ) : null}
        </div>
      ) : null}

      {!readsLessons && !readsReports && can(role, 'billing:read') ? (
        // An accountant: no lessons or dashboard, so the way into the money instead.
        <div className="mb-6 grid gap-3 sm:grid-cols-2 sm:gap-4">
          <HomeStat
            Icon={ReceiptText}
            tone="info"
            label={t('nav.invoices')}
            note={t('home.links.invoices')}
            to={`${base}/invoices`}
          />
          <HomeStat
            Icon={Wallet}
            tone="brand"
            label={t('nav.payments')}
            note={t('home.links.payments')}
            to={`${base}/payments`}
          />
        </div>
      ) : null}

      {starting ? <GettingStarted /> : null}

      <div
        className={cn(
          'flex flex-col gap-5',
          side && 'lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] lg:items-start',
        )}
      >
        <div className="flex min-w-0 flex-col gap-5">
          {readsLessons ? (
            <Card flush className="overflow-hidden">
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
                <div>
                  <h2 className="text-section font-medium text-text">{t('today.title')}</h2>
                  <p className="mt-0.5 text-meta text-muted">
                    {live.length === 1
                      ? t('today.lessons.one')
                      : t('today.lessons', { n: live.length })}
                  </p>
                </div>
                <Link
                  to={`${base}/timetable`}
                  className="flex min-h-11 items-center gap-1 text-label font-semibold text-brand hover:underline md:min-h-0"
                >
                  {t('home.timetable')}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
              {sessions.isPending ? (
                <SkeletonRows rows={3} />
              ) : sessions.isError ? (
                <PageError error={sessions.error} onRetry={() => void sessions.refetch()} />
              ) : todays.length === 0 ? (
                <p className="flex flex-col items-center border-t border-border px-5 py-10 text-center text-body text-muted">
                  <CalendarDays className="mb-2 size-5 text-brand" aria-hidden />
                  {t('today.empty')}
                </p>
              ) : (
                <>
                  {next ? (
                    <NextLesson
                      session={next}
                      now={now}
                      onMark={marks && unmarked(next) ? () => setMarking(next) : undefined}
                    />
                  ) : null}
                  <ul className="divide-y divide-border border-t border-border">
                    {todays
                      .filter((s) => s.id !== next?.id)
                      .map((s) => (
                        <LessonRow
                          key={s.id}
                          session={s}
                          now={now}
                          showTeacher
                          onMark={marks ? () => setMarking(s) : undefined}
                        />
                      ))}
                  </ul>
                </>
              )}
            </Card>
          ) : null}
          {data?.money ? <MoneyAtAGlance money={data.money} base={base} /> : null}
        </div>
        {side ? (
          <aside className="flex flex-col gap-5">
            {owner ? <SetupChecklist /> : null}
            <QuickActions />
            {owner ? <PlanCard /> : null}
          </aside>
        ) : null}
      </div>

      {marking ? (
        <QuickAttendance key={marking.id} session={marking} onClose={() => setMarking(null)} />
      ) : null}
    </div>
  );
}

const tiles = {
  brand: 'bg-[#efeafc] text-[#5b3fb5]',
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const;

/** A count for today: its icon tile, label, number and note, opening where it's dealt with. */
function HomeStat({
  Icon,
  tone,
  label,
  value,
  note,
  to,
  onClick,
}: {
  Icon: LucideIcon;
  tone: keyof typeof tiles;
  label: string;
  value?: ReactNode;
  note: string;
  to?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={cn('grid size-11 place-items-center rounded-xl', tiles[tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            value === undefined ? 'text-label font-semibold text-text' : 'text-meta text-muted',
          )}
        >
          {label}
        </span>
        <span className="flex items-baseline gap-2">
          {value === undefined ? null : (
            <b className="text-[24px] leading-tight font-bold text-text tabular-nums">{value}</b>
          )}
          <small className="truncate text-meta text-muted">{note}</small>
        </span>
      </span>
      {to || onClick ? <ChevronRight className="size-4 text-subtle" aria-hidden /> : <span />}
    </>
  );
  const box =
    'grid min-h-[84px] w-full grid-cols-[44px_1fr_16px] items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left';
  if (to) {
    return (
      <Link to={to} className={cn(box, 'transition-shadow duration-150 hover:shadow-pop')}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(box, 'transition-shadow duration-150 hover:shadow-pop')}
      >
        {body}
      </button>
    );
  }
  return <div className={box}>{body}</div>;
}

/** The trial's days left; the owner also gets the way back into setup while it isn't finished. */
function TrialCard({ daysLeft, owner }: { daysLeft: number; owner: boolean }) {
  return owner ? <OwnerTrialCard daysLeft={daysLeft} /> : <TrialBox daysLeft={daysLeft} />;
}

function OwnerTrialCard({ daysLeft }: { daysLeft: number }) {
  const progress = useSetupProgress();
  return (
    <TrialBox
      daysLeft={daysLeft}
      nextStep={progress.loading || progress.complete ? undefined : progress.nextStep}
    />
  );
}

function TrialBox({ daysLeft, nextStep }: { daysLeft: number; nextStep?: string }) {
  const { membership } = useOrg();
  return (
    <section className="mb-6 flex flex-col gap-4 rounded-xl border border-brand/20 bg-brand-soft/60 p-4 sm:flex-row sm:items-center sm:p-5">
      <span className="grid size-16 shrink-0 place-items-center rounded-full bg-brand text-white">
        <span className="flex flex-col items-center leading-none">
          <b className="text-[20px] font-bold">{daysLeft}</b>
          <small className="text-[9px] font-semibold tracking-[0.05em] uppercase">
            {t(daysLeft === 1 ? 'home.trial.dayLeft' : 'home.trial.daysLeft')}
          </small>
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-label font-semibold text-text">{t('home.trial.title')}</h2>
        <p className="mt-0.5 text-meta text-muted">
          {t(nextStep ? 'home.trial.bodySetup' : 'home.trial.body')}
        </p>
      </div>
      {nextStep ? (
        <Link
          to={`${orgPath(membership.org.slug)}/setup?step=${nextStep}`}
          className={buttonClass('secondary')}
        >
          {t('home.trial.continue')}
        </Link>
      ) : null}
    </section>
  );
}

/** The next lesson today, or the one on now, picked out at the top of today's list. */
function NextLesson({
  session,
  now,
  onMark,
}: {
  session: Session;
  now: string;
  onMark?: () => void;
}) {
  const format = useFormat();
  const begun = session.startTime <= now;
  const wait = minutes(session.startTime) - minutes(now);
  const [time, meridiem] = format.time(session.startTime).split(' ');
  return (
    <div className="mx-4 mb-4 flex flex-col gap-3 rounded-xl border border-brand/20 bg-brand-soft/60 p-4 sm:mx-5 sm:flex-row sm:items-center">
      <span className="flex items-center gap-4">
        <span className="flex w-16 flex-col items-center">
          <b className="text-[26px] leading-none font-bold text-text tabular-nums">{time}</b>
          {meridiem ? (
            <small className="mt-1 text-meta text-muted uppercase">{meridiem}</small>
          ) : null}
        </span>
        <span aria-hidden className="h-12 w-0.5 rounded-full bg-brand" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {begun && onMark ? (
          <span className="self-start">
            <Badge tone="warning">{t('home.next.toTake')}</Badge>
          </span>
        ) : null}
        <b className="truncate text-body font-semibold text-text">{session.className}</b>
        <small className="truncate text-meta text-muted">
          {[session.teacherName, session.roomName].filter(Boolean).join(' · ')}
        </small>
      </span>
      {begun && onMark ? (
        <Button size="sm" onClick={onMark}>
          {t('today.take')}
        </Button>
      ) : (
        <span className="flex flex-col sm:items-end">
          <small className="text-[10px] font-semibold tracking-[0.08em] text-muted uppercase">
            {begun ? t('today.onNow') : t('home.next.startsIn')}
          </small>
          {begun ? null : <b className="text-label font-semibold text-brand">{waitLabel(wait)}</b>}
        </span>
      )}
    </div>
  );
}

const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
};

/** "25m", "2h 18m". */
function waitLabel(wait: number) {
  const h = Math.floor(wait / 60);
  const m = wait % 60;
  return h ? t('home.next.hours', { h, m }) : t('home.next.minutes', { m });
}

/** What families owe, what came in this month and what's overdue, for roles that see money. */
function MoneyAtAGlance({ money, base }: { money: NonNullable<Dashboard['money']>; base: string }) {
  const format = useFormat();
  const cells: { label: MessageKey; value: string; note: string; danger?: boolean }[] = [
    {
      label: 'home.money.owing',
      value: format.money(money.owing),
      note: money.draftInvoices
        ? t(money.draftInvoices === 1 ? 'home.money.draftOne' : 'home.money.drafts', {
            n: money.draftInvoices,
          })
        : t('home.money.owingNote'),
    },
    {
      label: 'home.money.received',
      value: format.money(money.receivedThisMonth),
      note: t('home.money.receivedNote'),
    },
    {
      label: 'home.money.overdue',
      value: format.money(money.overdue),
      note: t(money.overdueInvoices === 1 ? 'home.money.acrossOne' : 'home.money.across', {
        n: money.overdueInvoices,
      }),
      danger: money.overdueInvoices > 0,
    },
  ];
  return (
    <Card flush className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
        <div>
          <h2 className="text-section font-medium text-text">{t('home.money.title')}</h2>
          <p className="mt-0.5 text-meta text-muted">{t('home.money.subtitle')}</p>
        </div>
        <Link
          to={`${base}/invoices`}
          className="flex min-h-11 items-center gap-1 text-label font-semibold text-brand hover:underline md:min-h-0"
        >
          {t('home.money.view')}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      <dl className="grid border-t border-border sm:grid-cols-3 sm:divide-x sm:divide-border">
        {cells.map((cell) => (
          <div key={cell.label} className="px-4 py-4 max-sm:border-b max-sm:border-border sm:px-5">
            <dt className="text-meta font-semibold tracking-[0.05em] text-muted uppercase">
              {t(cell.label)}
            </dt>
            <dd
              className={cn(
                'mt-1 text-[20px] font-bold tabular-nums',
                cell.danger ? 'text-danger' : 'text-text',
              )}
            >
              {cell.value}
            </dd>
            <dd className="mt-0.5 text-meta text-muted">{cell.note}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const CHECKLIST = ['details', 'branch', 'grades', 'subjects', 'calendar', 'team', 'class'] as const;

/** The owner's "Set up your centre": what's done and what's left, each opening its step. */
function SetupChecklist() {
  const { membership } = useOrg();
  const progress = useSetupProgress();
  if (progress.loading || progress.complete) return null;
  const done = CHECKLIST.filter((key) => progress.done[key]).length;
  if (done === CHECKLIST.length) return null;
  const base = orgPath(membership.org.slug);
  const firstLeft = CHECKLIST.find((key) => !progress.done[key]);
  return (
    <Card flush className="overflow-hidden">
      <div className="flex items-center gap-3 px-4 pt-4 sm:px-5">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-full"
          style={{
            background: `conic-gradient(var(--brand) ${(done / CHECKLIST.length) * 360}deg, var(--brand-soft) 0)`,
          }}
        >
          <span className="grid size-9 place-items-center rounded-full bg-surface text-label font-bold text-text">
            {done}
            <span className="sr-only">{t('home.checklist.of', { n: CHECKLIST.length })}</span>
          </span>
        </span>
        <div>
          <h2 className="text-section font-medium text-text">{t('home.checklist.title')}</h2>
          <p className="text-meta text-muted">
            {t('home.checklist.left', { n: CHECKLIST.length - done })}
          </p>
        </div>
      </div>
      <div className="mx-4 mt-3 h-1.5 overflow-hidden rounded-full bg-brand-soft sm:mx-5">
        <div className="h-full bg-brand" style={{ width: `${(done / CHECKLIST.length) * 100}%` }} />
      </div>
      <ul className="mt-2 pb-2">
        {CHECKLIST.map((key, i) => {
          const finished = progress.done[key];
          const to = key === 'class' ? `${base}/classes` : `${base}/setup?step=${key}`;
          return (
            <li key={key}>
              <Link
                to={to}
                className={cn(
                  'flex min-h-11 items-center gap-3 px-4 text-body sm:px-5',
                  key === firstLeft
                    ? 'bg-brand-soft/60 font-semibold text-text'
                    : 'hover:bg-canvas',
                )}
              >
                {finished ? (
                  <CircleCheck className="size-5 shrink-0 fill-brand text-white" aria-hidden />
                ) : (
                  <span className="grid size-5 shrink-0 place-items-center rounded-full border border-border-strong text-[10px] text-muted">
                    {i + 1}
                  </span>
                )}
                <span className={cn('flex-1', finished && 'text-muted line-through')}>
                  {t(`home.checklist.${key}`)}
                  {finished ? <span className="sr-only"> {t('setup.stepDone')}</span> : null}
                </span>
                {key === firstLeft ? (
                  <ChevronRight className="size-4 text-brand" aria-hidden />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

type Action = 'family' | 'class' | 'payment' | 'run';

/** The everyday jobs the role may start from Home, in this order. */
function actionsFor(role: Role): Action[] {
  const actions: Action[] = [];
  if (can(role, 'people:write')) actions.push('family');
  if (can(role, 'classes:write')) actions.push('class');
  if (can(role, 'billing:write')) actions.push('payment', 'run');
  return actions;
}

const ACTION_ICONS = { family: Users, class: School, payment: Wallet, run: FileStack } as const;

/** Quick actions (TUI-134): each opens the same dialog as its own page. */
function QuickActions() {
  const { membership } = useOrg();
  const [open, setOpen] = useState<Action | null>(null);
  const actions = actionsFor(membership.role);
  if (!actions.length) return null;
  const close = () => setOpen(null);
  return (
    <Card flush className="overflow-hidden">
      <h2 className="px-4 pt-4 pb-2 text-section font-medium text-text sm:px-5">
        {t('home.actions')}
      </h2>
      <ul className="pb-2">
        {actions.map((key) => {
          const Icon = ACTION_ICONS[key];
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => setOpen(key)}
                className="grid min-h-[60px] w-full grid-cols-[36px_1fr_16px] items-center gap-3 px-4 py-2 text-left hover:bg-canvas sm:px-5"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col">
                  <b className="text-label font-semibold text-text">{t(`home.action.${key}`)}</b>
                  <small className="truncate text-meta text-muted">
                    {t(`home.action.${key}Note`)}
                  </small>
                </span>
                <ChevronRight className="size-4 text-subtle" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <AddFamilyDialog open={open === 'family'} onClose={close} />
      <ClassDialog open={open === 'class'} onClose={close} />
      <RecordPaymentDialog open={open === 'payment'} onClose={close} />
      <RunInvoicesDialog open={open === 'run'} onClose={close} />
    </Card>
  );
}

/**
 * The owner's plan (TUI-134): active students against the plan's limit, and the trial's end.
 * Amber once the students reach 80% of the limit.
 */
function PlanCard() {
  const { membership } = useOrg();
  const format = useFormat();
  const plan = useQuery({
    queryKey: ['billing', membership.org.id],
    queryFn: ({ signal }) =>
      api<BillingOverview>('GET', orgApiPath(membership, '/billing/subscription'), { signal }),
    staleTime: 5 * 60_000,
  });
  if (!plan.data) return null;
  const { studentLimit: limit, activeStudents: active, trialEndsAt, status } = plan.data;
  const near = limit !== null && active >= limit * 0.8;
  return (
    <section
      className={cn(
        'rounded-xl border p-4 sm:p-5',
        near ? 'border-[#f1d9a6] bg-warning-soft' : 'border-border bg-surface',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-section font-medium text-text">{t('home.plan.title')}</h2>
          <p className="mt-0.5 text-meta text-muted">
            {status === 'trialing' && trialEndsAt
              ? t('home.plan.trialEnds', { date: format.day(trialEndsAt.slice(0, 10)) })
              : t(`home.plan.name.${plan.data.plan}`)}
          </p>
        </div>
        <span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand">
          <GraduationCap className="size-4" aria-hidden />
        </span>
      </div>
      {near ? (
        <p className="mt-3 flex items-center gap-2 text-label font-semibold text-text">
          <TriangleAlert className="size-4 text-warning" aria-hidden />
          {t(active >= limit ? 'home.limit.reached' : 'home.limit.near')}
        </p>
      ) : null}
      <p className="mt-3 text-body text-text">
        {limit === null
          ? t('home.plan.unlimited', { n: active })
          : t('home.limit.body', { n: active, limit })}
      </p>
      {limit !== null ? (
        <div
          className={cn(
            'mt-2 h-1.5 overflow-hidden rounded-full',
            near ? 'bg-white/70' : 'bg-brand-soft',
          )}
        >
          <div
            className={cn('h-full', near ? 'bg-warning' : 'bg-brand')}
            style={{ width: `${Math.min(100, (active / limit) * 100)}%` }}
          />
        </div>
      ) : null}
    </section>
  );
}

/** A centre with no classes yet: the first steps, for staff other than the owner. */
function GettingStarted() {
  const { membership } = useOrg();
  const base = orgPath(membership.org.slug);
  const steps: { key: 'courses' | 'classes' | 'families'; to: string; Icon: LucideIcon }[] = [
    { key: 'courses', to: `${base}/settings/courses`, Icon: GraduationCap },
    { key: 'classes', to: `${base}/classes`, Icon: School },
  ];
  if (can(membership.role, 'people:write'))
    steps.push({ key: 'families', to: `${base}/families`, Icon: Users });

  return (
    <Card className="mb-6">
      <h2 className="text-section font-medium text-text">{t('home.setup.title')}</h2>
      <ul className="mt-3 divide-y divide-border">
        {steps.map(({ key, to, Icon }) => (
          <li key={key}>
            <Link to={to} className="flex items-center gap-3 py-3 hover:bg-canvas">
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="flex-1">
                <span className="block text-body font-semibold text-text">
                  {t(`home.setup.${key}Title`)}
                </span>
                <span className="block text-meta text-muted">{t(`home.setup.${key}Body`)}</span>
              </span>
              <ChevronRight className="size-4 text-subtle" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
