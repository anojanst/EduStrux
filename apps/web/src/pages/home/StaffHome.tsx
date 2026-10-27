import type { Dashboard, Session } from '@edustrux/shared';
import { addDays, localNow } from '@edustrux/shared/dates';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarDays,
  CalendarX,
  Check,
  ChevronRight,
  CircleCheck,
  FileStack,
  GraduationCap,
  MessageSquareWarning,
  ReceiptText,
  RotateCcw,
  School,
  TriangleAlert,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { PageError, PageHeader } from '../../components/PageState';
import { Card } from '../../components/ui/Card';
import { t } from '../../i18n';
import { api } from '../../lib/api';
import { markedCount } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { query, type Page } from '../../lib/people';
import { can } from '../../lib/roles';
import { orgPath } from '../../lib/session';
import { RecordPaymentDialog } from '../billing/RecordPaymentDialog';
import { RunInvoicesDialog } from '../billing/RunInvoicesDialog';
import { MoneyStats } from '../billing/parts';
import { ClassDialog } from '../classes/ClassDialog';
import { StatCard } from '../classes/parts';
import { AddFamilyDialog } from '../people/AddFamilyDialog';
import { SkeletonRows } from '../people/parts';
import { LessonRow } from '../today/TeacherToday';
import { QuickAttendance } from '../today/QuickAttendance';

/** How far back "Needs attention" looks for lessons left unmarked, as the dashboard does. */
const LOOK_BACK_DAYS = 14;

/**
 * The staff Home (ui-design.md §9, TUI-125) for the owner, branch managers, front desk and
 * accountants: money or the centre's counts, today's lessons with attendance, what needs
 * attention, and quick actions. Each part shows only to the roles that can read it.
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
  const unmarkedToday = live.filter((s) => s.attendance !== undefined && markedCount(s) === 0);
  const toMark = unmarkedToday.filter((s) => s.startTime <= now).length;
  // The dashboard counts today's unmarked lessons too, even those still to start.
  const earlier =
    dashboard.data && sessions.isSuccess
      ? Math.max(0, dashboard.data.unmarkedLessons - unmarkedToday.length)
      : 0;

  // The oldest lesson left unmarked, to open from "Needs attention". Lessons come oldest first,
  // so the first page holds it.
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
  const oldest = past.data?.data.find(
    (s) => s.status !== 'cancelled' && s.attendance !== undefined && markedCount(s) === 0,
  );

  const subtitle = !sessions.isSuccess
    ? membership.org.name
    : [
        membership.org.name,
        live.length === 0
          ? t('today.none')
          : t(live.length === 1 ? 'today.lessons.one' : 'today.lessons', { n: live.length }),
        toMark ? t('today.toMark', { n: toMark }) : null,
      ]
        .filter(Boolean)
        .join(' · ');

  const base = orgPath(membership.org.slug);
  const data = dashboard.data;
  // A centre with no classes yet gets the first steps instead of empty panels.
  const starting = data?.classes === 0 && can(role, 'classes:write');

  return (
    <div className="max-w-[1280px]">
      <PageHeader overline={overline} title={greeting} subtitle={subtitle} />

      {dashboard.isError ? (
        <PageError error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : null}

      {readsReports && can(role, 'reports:money') ? (
        <MoneyStats draftsTo={`${base}/invoices?status=draft`} />
      ) : data ? (
        <Counts dashboard={data} base={base} />
      ) : null}

      {starting ? <GettingStarted /> : null}

      {/* On phones what needs attention comes straight after today's lessons. */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] lg:grid-rows-[auto_1fr] lg:items-start">
        {readsLessons ? (
          <section className="lg:col-start-1">
            <div className="flex min-h-[50px] items-center justify-between gap-3">
              <h2 className="text-section font-medium text-text">{t('today.title')}</h2>
              <Link
                to={`${base}/timetable`}
                className="flex min-h-11 items-center gap-1 text-label font-semibold text-brand hover:underline md:min-h-0"
              >
                {t('home.timetable')}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <Card flush className="overflow-hidden">
              {sessions.isPending ? (
                <SkeletonRows rows={3} />
              ) : sessions.isError ? (
                <PageError error={sessions.error} onRetry={() => void sessions.refetch()} />
              ) : todays.length === 0 ? (
                <p className="flex flex-col items-center px-5 py-10 text-center text-body text-muted">
                  <CalendarDays className="mb-2 size-5 text-brand" aria-hidden />
                  {t('today.empty')}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {todays.map((s) => (
                    <LessonRow
                      key={s.id}
                      session={s}
                      now={now}
                      showTeacher
                      onMark={marks ? () => setMarking(s) : undefined}
                    />
                  ))}
                </ul>
              )}
            </Card>
          </section>
        ) : null}
        {data ? (
          <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <Card flush className="overflow-hidden px-4">
              <div className="flex min-h-[50px] items-center">
                <h2 className="text-section font-medium text-text">{t('today.attention')}</h2>
              </div>
              <NeedsAttention
                dashboard={data}
                earlier={earlier}
                onMarkOldest={oldest ? () => setMarking(oldest) : undefined}
                oldestDay={oldest ? format.day(oldest.date) : undefined}
                base={base}
              />
            </Card>
          </aside>
        ) : dashboard.isPending && readsReports ? (
          <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <Card flush className="overflow-hidden">
              <SkeletonRows rows={3} />
            </Card>
          </aside>
        ) : null}
        <div className="lg:col-start-1">
          <QuickActions />
        </div>
      </div>

      {marking ? (
        <QuickAttendance key={marking.id} session={marking} onClose={() => setMarking(null)} />
      ) : null}
    </div>
  );
}

/** Families, students, classes and today's lessons, for staff who don't see money. */
function Counts({ dashboard, base }: { dashboard: Dashboard; base: string }) {
  const { today } = dashboard;
  const lessons = today.lessons - today.cancelled;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatLink to={`${base}/families`}>
        <StatCard
          label={t('home.stat.families')}
          Icon={UsersRound}
          value={dashboard.families}
          className="h-full"
        />
      </StatLink>
      <StatLink to={`${base}/families`}>
        <StatCard
          label={t('home.stat.students')}
          Icon={GraduationCap}
          tone="info"
          value={dashboard.students}
          note={t('home.stat.studentsNote')}
          className="h-full"
        />
      </StatLink>
      <StatLink to={`${base}/classes`}>
        <StatCard
          label={t('home.stat.classes')}
          Icon={School}
          tone="success"
          value={dashboard.classes}
          className="h-full"
        />
      </StatLink>
      <StatLink to={`${base}/timetable`}>
        <StatCard
          label={t('home.stat.lessons')}
          Icon={CalendarDays}
          tone="warning"
          value={lessons}
          note={lessons ? t('home.stat.lessonsMarked', { n: today.marked }) : null}
          className="h-full"
        />
      </StatLink>
    </div>
  );
}

function StatLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="rounded-xl transition-shadow duration-150 hover:shadow-pop">
      {children}
    </Link>
  );
}

const tiles = {
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
} as const;

/**
 * Lessons left unmarked, students away today, make-up credits to book and overdue invoices,
 * each with its count. "All caught up" when there's nothing.
 */
function NeedsAttention({
  dashboard,
  earlier,
  onMarkOldest,
  oldestDay,
  base,
}: {
  dashboard: Dashboard;
  earlier: number;
  onMarkOldest?: () => void;
  oldestDay?: string;
  base: string;
}) {
  const format = useFormat();
  const away = dashboard.today.absenceNotices;
  const credits = dashboard.makeupCreditsAvailable;
  const overdue = dashboard.money?.overdueInvoices ?? 0;
  if (!earlier && !away && !credits && !overdue) {
    return (
      <p className="flex items-center gap-2 border-t border-border py-4 text-body text-muted">
        <Check className="size-4 text-success" aria-hidden />
        {t('today.caughtUp')}
      </p>
    );
  }
  return (
    <ul>
      {earlier ? (
        <AttentionRow
          Icon={CalendarX}
          tone="danger"
          title={t('home.attention.unmarked')}
          meta={
            oldestDay
              ? t('home.attention.unmarkedOldest', { day: oldestDay })
              : t('home.attention.unmarkedMeta')
          }
          count={earlier}
          onClick={onMarkOldest}
        />
      ) : null}
      {away ? (
        <AttentionRow
          Icon={MessageSquareWarning}
          tone="warning"
          title={t('home.attention.away')}
          meta={t('home.attention.awayMeta')}
          count={away}
        />
      ) : null}
      {credits ? (
        <AttentionRow
          Icon={RotateCcw}
          tone="info"
          title={t('home.attention.makeups')}
          meta={t('home.attention.makeupsMeta')}
          count={credits}
        />
      ) : null}
      {overdue ? (
        <AttentionRow
          Icon={TriangleAlert}
          tone="danger"
          title={t('home.attention.overdue')}
          meta={t('home.attention.overdueMeta', { amount: format.money(dashboard.money!.overdue) })}
          count={overdue}
          to={`${base}/invoices`}
        />
      ) : null}
    </ul>
  );
}

/** An icon tile, what needs doing over a meta line, its count and a chevron (ui-design.md §6). */
function AttentionRow({
  Icon,
  tone,
  title,
  meta,
  count,
  to,
  onClick,
}: {
  Icon: LucideIcon;
  tone: keyof typeof tiles;
  title: string;
  meta: string;
  count: number;
  to?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={cn('grid size-[34px] place-items-center rounded-lg', tiles[tone])}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <b className="text-label font-semibold text-text">{title}</b>
        <small className="text-meta text-muted">{meta}</small>
      </span>
      <b className="text-body font-semibold text-text tabular-nums">{count}</b>
      {to || onClick ? (
        <ChevronRight className="size-4 text-subtle" aria-hidden />
      ) : (
        <span aria-hidden />
      )}
    </>
  );
  const row =
    'grid min-h-[68px] w-full grid-cols-[34px_1fr_auto_16px] items-center gap-3 border-t border-border py-3 text-left';
  return (
    <li>
      {to ? (
        <Link to={to} className={cn(row, 'hover:bg-canvas')}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(row, 'hover:bg-canvas')}>
          {body}
        </button>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  );
}

type Dialog = 'family' | 'class' | 'payment' | 'run';
type Action = Dialog | 'invoices' | 'payments';

/** The everyday jobs the role may do, as tiles: two columns on wide screens, one on phones. */
function QuickActions() {
  const { membership } = useOrg();
  const role = membership.role;
  const base = orgPath(membership.org.slug);
  const [open, setOpen] = useState<Dialog | null>(null);
  const close = () => setOpen(null);

  const actions: { key: Action; Icon: LucideIcon; to?: string; dialog?: Dialog }[] = [];
  if (can(role, 'people:write')) actions.push({ key: 'family', Icon: Users, dialog: 'family' });
  if (can(role, 'classes:write')) actions.push({ key: 'class', Icon: School, dialog: 'class' });
  if (can(role, 'billing:write')) {
    actions.push({ key: 'payment', Icon: Wallet, dialog: 'payment' });
    actions.push({ key: 'run', Icon: FileStack, dialog: 'run' });
  } else if (can(role, 'billing:read')) {
    actions.push({ key: 'invoices', Icon: ReceiptText, to: `${base}/invoices` });
    actions.push({ key: 'payments', Icon: Wallet, to: `${base}/payments` });
  }
  if (actions.length === 0) return null;

  const tile =
    'grid min-h-[68px] w-full grid-cols-[34px_1fr_16px] items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors duration-150 hover:bg-canvas';
  const body = (key: Action, Icon: LucideIcon) => (
    <>
      <span className="grid size-[34px] place-items-center rounded-lg bg-brand-soft text-brand">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <b className="text-label font-semibold text-text">{t(`home.action.${key}`)}</b>
        <small className="text-meta text-muted">{t(`home.action.${key}Note`)}</small>
      </span>
      <ChevronRight className="size-4 text-subtle" aria-hidden />
    </>
  );

  return (
    <section>
      <div className="flex min-h-[50px] items-center">
        <h2 className="text-section font-medium text-text">{t('home.actions')}</h2>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {actions.map(({ key, Icon, to, dialog }) => (
          <li key={key}>
            {to ? (
              <Link to={to} className={tile}>
                {body(key, Icon)}
              </Link>
            ) : (
              <button type="button" className={tile} onClick={() => setOpen(dialog!)}>
                {body(key, Icon)}
              </button>
            )}
          </li>
        ))}
      </ul>
      <AddFamilyDialog open={open === 'family'} onClose={close} />
      <ClassDialog open={open === 'class'} onClose={close} />
      <RecordPaymentDialog open={open === 'payment'} onClose={close} />
      <RunInvoicesDialog open={open === 'run'} onClose={close} />
    </section>
  );
}

/** A centre with no classes yet: the first steps, for whoever can take them. */
function GettingStarted() {
  const { membership } = useOrg();
  const base = orgPath(membership.org.slug);
  const steps: {
    key: 'courses' | 'classes' | 'families' | 'invite';
    to: string;
    Icon: LucideIcon;
  }[] = [
    { key: 'courses', to: `${base}/settings/courses`, Icon: GraduationCap },
    { key: 'classes', to: `${base}/classes`, Icon: School },
  ];
  if (can(membership.role, 'people:write'))
    steps.push({ key: 'families', to: `${base}/families`, Icon: Users });
  if (can(membership.role, 'staff:write'))
    steps.push({ key: 'invite', to: `${base}/settings/team`, Icon: UsersRound });

  return (
    <Card className="mb-6">
      <h2 className="text-section font-medium text-text">{t('home.setup.title')}</h2>
      <ul className="mt-3 divide-y divide-border">
        <li className="flex items-center gap-3 py-3">
          <CircleCheck className="size-5 text-success" aria-hidden />
          <span className="flex-1 text-body text-text">
            {t('home.setup.signedIn', { org: membership.org.name })}
          </span>
        </li>
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
