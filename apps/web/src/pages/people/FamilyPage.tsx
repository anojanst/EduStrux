import type { Family, Guardian, Invoice, Payment } from '@edustrux/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Copy, Mail, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { PageError, PageLoading } from '../../components/PageState';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { OverflowMenu, type MenuItem } from '../../components/ui/Menu';
import { Notice } from '../../components/ui/Notice';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import {
  familyKey,
  guardianName,
  namesOf,
  query,
  useBranches,
  useGradeLevels,
  usePeoplePaths,
  type Page,
} from '../../lib/people';
import { can } from '../../lib/roles';
import type { AddedState } from './AddFamilyDialog';
import {
  ConfirmDialog,
  DeleteFamilyDialog,
  EditFamilyDialog,
  EraseFamilyDialog,
  GuardianDialog,
  InviteGuardianDialog,
  StudentDialog,
  useRefreshPeople,
} from './dialogs';
import { invoiceStatus, isOpen, useBillingPaths } from '../../lib/billing';
import { InvoiceBadge } from '../billing/parts';
import { RecordPaymentDialog } from '../billing/RecordPaymentDialog';
import { methodLabel } from './labels';
import { CardEmpty, DetailHeader, SectionCard } from './parts';

export function FamilyPage() {
  const { membership } = useOrg();
  const { familyId = '' } = useParams();
  if (!can(membership.role, 'people:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <FamilyDetail key={familyId} familyId={familyId} />;
}

type Open =
  | { kind: 'edit' | 'delete' | 'erase' | 'addStudent' | 'addGuardian' }
  | { kind: 'editGuardian' | 'removeGuardian' | 'invite'; guardian: Guardian }
  | null;

function FamilyDetail({ familyId }: { familyId: string }) {
  const { membership } = useOrg();
  const navigate = useNavigate();
  const location = useLocation();
  const paths = usePeoplePaths();
  const branches = useBranches();
  const branchName = namesOf(branches.data?.data);
  const [open, setOpen] = useState<Open>(null);
  const [invited, setInvited] = useState<string[]>([]);
  const added = (location.state as Partial<AddedState> | null)?.added;
  const [prompt, setPrompt] = useState(added?.invite ?? null);
  const canWrite = can(membership.role, 'people:write');
  const canBill = can(membership.role, 'billing:read');

  const family = useQuery({
    queryKey: familyKey(membership.org.id, familyId),
    queryFn: ({ signal }) =>
      api<Family>('GET', orgApiPath(membership, `/families/${familyId}`), { signal }),
  });

  if (family.isPending) return <PageLoading />;
  if (family.isError)
    return <PageError error={family.error} onRetry={() => void family.refetch()} />;
  const data = family.data;
  const close = () => setOpen(null);

  const menu: MenuItem[] = [];
  if (canWrite)
    menu.push({
      label: t('people.deleteFamily.menu'),
      onSelect: () => setOpen({ kind: 'delete' }),
      danger: true,
    });
  if (can(membership.role, 'org:write'))
    menu.push({
      label: t('people.erase.menu'),
      onSelect: () => setOpen({ kind: 'erase' }),
      danger: true,
    });
  const promptGuardian = data.guardians.find((g) => g.id === prompt && g.membershipId === null);

  return (
    <>
      <DetailHeader
        back={{ to: paths.list, label: t('people.title') }}
        title={t('people.familyName', { name: data.name })}
        meta={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {(branches.data?.data.length ?? 0) > 1 ? (
              <span>
                {t('people.branchName', { name: branchName(data.branchId) })}
                {data.bankReference ? ' ·' : ''}
              </span>
            ) : null}
            {data.bankReference ? <BankReference reference={data.bankReference} /> : null}
          </span>
        }
        actions={
          canWrite ? (
            <>
              <Button variant="secondary" onClick={() => setOpen({ kind: 'edit' })}>
                {t('people.edit')}
              </Button>
              {menu.length ? <OverflowMenu label={t('people.moreActions')} items={menu} /> : null}
            </>
          ) : null
        }
      />

      {added?.problems.length ? (
        <Notice tone="warning" title={t('people.add.someNotSaved')} className="mb-4">
          <ul className="list-disc pl-5">
            {added.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.8fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <StudentsCard
            family={data}
            onAdd={canWrite ? () => setOpen({ kind: 'addStudent' }) : undefined}
          />
          <SectionCard
            title={t('people.guardians')}
            action={
              canWrite ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus className="size-4" />}
                  onClick={() => setOpen({ kind: 'addGuardian' })}
                >
                  {t('people.guardian.add')}
                </Button>
              ) : null
            }
          >
            {promptGuardian && canWrite ? (
              <div className="flex flex-col gap-3 border-b border-border bg-info-soft px-4 py-3 sm:flex-row sm:items-center">
                <Mail className="size-4 shrink-0 text-info" aria-hidden />
                <p className="flex-1 text-body text-text">
                  {t('people.invite.prompt', { name: promptGuardian.firstName })}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-9"
                    onClick={() => setOpen({ kind: 'invite', guardian: promptGuardian })}
                  >
                    {t('people.invite.short')}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-9" onClick={() => setPrompt(null)}>
                    {t('people.invite.later')}
                  </Button>
                </div>
              </div>
            ) : null}
            {data.guardians.length === 0 ? (
              <CardEmpty>{t('people.noGuardians')}</CardEmpty>
            ) : (
              <ul className="divide-y divide-border">
                {data.guardians.map((guardian) => (
                  <GuardianRow
                    key={guardian.id}
                    guardian={guardian}
                    billing={guardian.id === data.billingGuardianId}
                    invited={invited.includes(guardian.id)}
                    canWrite={canWrite}
                    onOpen={(kind) => setOpen({ kind, guardian })}
                    familyUpdatedAt={data.updatedAt}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {canBill ? <MoneyCards familyId={data.id} familyName={data.name} /> : null}
          {data.address ? (
            <SectionCard title={t('people.address')}>
              <p className="px-4 py-3.5 text-body whitespace-pre-line text-text">{data.address}</p>
            </SectionCard>
          ) : null}
        </div>
      </div>

      <EditFamilyDialog family={data} open={open?.kind === 'edit'} onClose={close} />
      <DeleteFamilyDialog
        family={data}
        open={open?.kind === 'delete'}
        onClose={close}
        onDeleted={() => navigate(paths.list, { replace: true })}
      />
      <EraseFamilyDialog family={data} open={open?.kind === 'erase'} onClose={close} />
      <StudentDialog family={data} open={open?.kind === 'addStudent'} onClose={close} />
      <GuardianDialog familyId={data.id} open={open?.kind === 'addGuardian'} onClose={close} />
      <GuardianDialog
        familyId={data.id}
        guardian={open?.kind === 'editGuardian' ? open.guardian : undefined}
        open={open?.kind === 'editGuardian'}
        onClose={close}
      />
      {open?.kind === 'removeGuardian' ? (
        <RemoveGuardian guardian={open.guardian} onClose={close} />
      ) : null}
      {open?.kind === 'invite' ? (
        <InviteGuardianDialog
          guardian={open.guardian}
          open
          onClose={close}
          onSent={(id) => {
            setInvited((list) => [...list, id]);
            setPrompt(null);
          }}
        />
      ) : null}
    </>
  );
}

function BankReference({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      {t('people.bankReferenceLabel')}{' '}
      <b className="font-semibold text-text tabular-nums">{reference}</b>
      <button
        type="button"
        aria-label={t('people.copyReference')}
        title={t('people.copyReference')}
        onClick={() => void navigator.clipboard?.writeText(reference).then(() => setCopied(true))}
        className="grid size-8 place-items-center rounded-lg text-muted hover:bg-canvas"
      >
        {copied ? (
          <Check className="size-4 text-success" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
      </button>
    </span>
  );
}

function StudentsCard({ family, onAdd }: { family: Family; onAdd?: () => void }) {
  const format = useFormat();
  const paths = usePeoplePaths();
  const gradeName = namesOf(useGradeLevels().data?.data);
  return (
    <SectionCard
      title={t('people.students')}
      action={
        onAdd ? (
          <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={onAdd}>
            {t('people.student.add')}
          </Button>
        ) : null
      }
    >
      {family.students.length === 0 ? (
        <CardEmpty>{t('people.noStudents')}</CardEmpty>
      ) : (
        <ul className="divide-y divide-border">
          {family.students.map((student) => {
            const name = `${student.firstName} ${student.lastName}`;
            const grade = gradeName(student.gradeLevelId);
            return (
              <li key={student.id}>
                <Link
                  to={paths.student(student.id)}
                  className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 hover:bg-canvas"
                >
                  <Avatar name={name} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate text-body font-semibold text-text">{name}</b>
                    {student.dateOfBirth ? (
                      <small className="text-meta text-muted">
                        {t('people.born', { date: format.date(student.dateOfBirth) })}
                      </small>
                    ) : null}
                  </span>
                  {grade ? <Badge>{grade}</Badge> : null}
                  {student.dateOfBirth ? (
                    <span className="hidden w-[60px] text-body text-muted tabular-nums sm:block">
                      {t('people.age', { age: format.age(student.dateOfBirth) })}
                    </span>
                  ) : null}
                  <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function GuardianRow({
  guardian,
  billing,
  invited,
  canWrite,
  onOpen,
  familyUpdatedAt,
}: {
  guardian: Guardian;
  billing: boolean;
  invited: boolean;
  canWrite: boolean;
  onOpen: (kind: 'editGuardian' | 'removeGuardian' | 'invite') => void;
  familyUpdatedAt: string;
}) {
  const { membership } = useOrg();
  const refresh = useRefreshPeople();
  const [error, setError] = useState<string | null>(null);
  const roles = [
    guardian.relationship,
    billing ? t('people.billingContact') : null,
    guardian.emergencyContact ? t('people.emergencyContact') : null,
  ].filter(Boolean);

  async function makeBilling() {
    setError(null);
    try {
      await api('PATCH', orgApiPath(membership, `/families/${guardian.familyId}`), {
        body: { updatedAt: familyUpdatedAt, billingGuardianId: guardian.id },
      });
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'stale_data'
          ? t('error.staleData')
          : t('error.generic'),
      );
    }
  }

  const items: MenuItem[] = [{ label: t('people.edit'), onSelect: () => onOpen('editGuardian') }];
  if (!billing) {
    items.push({ label: t('people.makeBilling'), onSelect: () => void makeBilling() });
    items.push({
      label: t('people.remove'),
      onSelect: () => onOpen('removeGuardian'),
      danger: true,
    });
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 md:grid md:min-h-[72px] md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto_40px] md:items-center md:gap-3">
      <span className="flex min-w-0 flex-col">
        <b className="text-body font-semibold text-text">{guardianName(guardian)}</b>
        {roles.length ? <small className="text-meta text-muted">{roles.join(' · ')}</small> : null}
      </span>
      <span className="flex min-w-0 flex-col">
        {guardian.email ? (
          <a
            href={`mailto:${guardian.email}`}
            className="truncate text-body text-text hover:underline"
          >
            {guardian.email}
          </a>
        ) : (
          <span className="text-body text-subtle">{t('people.noEmail')}</span>
        )}
        {guardian.phone ? (
          <a
            href={`tel:${guardian.phone}`}
            className="text-meta text-muted tabular-nums hover:underline"
          >
            {guardian.phone}
          </a>
        ) : null}
      </span>
      <span className="flex items-center justify-between gap-2 md:justify-end">
        {guardian.membershipId ? (
          <Badge tone="success">{t('people.portal.signedIn')}</Badge>
        ) : invited ? (
          <span className="text-meta text-muted">
            {t('people.portal.invited')} ·{' '}
            <button
              type="button"
              className="font-semibold text-brand hover:underline"
              onClick={() => onOpen('invite')}
            >
              {t('people.invite.resend')}
            </button>
          </span>
        ) : canWrite ? (
          <Button variant="secondary" size="sm" onClick={() => onOpen('invite')}>
            {t('people.invite.button')}
          </Button>
        ) : (
          <Badge tone="neutral">{t('people.portal.notSignedIn')}</Badge>
        )}
        {canWrite ? (
          <span className="md:hidden">
            <OverflowMenu
              label={t('people.guardianActions', { name: guardianName(guardian) })}
              items={items}
            />
          </span>
        ) : null}
      </span>
      {canWrite ? (
        <span className="hidden md:block">
          <OverflowMenu
            label={t('people.guardianActions', { name: guardianName(guardian) })}
            items={items}
          />
        </span>
      ) : (
        <span className="hidden md:block" />
      )}
      {error ? <p className="text-meta text-danger md:col-span-4">{error}</p> : null}
    </li>
  );
}

function RemoveGuardian({ guardian, onClose }: { guardian: Guardian; onClose: () => void }) {
  const { membership } = useOrg();
  const refresh = useRefreshPeople();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={t('people.removeGuardian.title', { name: guardianName(guardian) })}
      body={
        guardian.membershipId
          ? t('people.removeGuardian.signedIn', { name: guardian.firstName })
          : t('people.removeGuardian.body')
      }
      action={t('people.remove')}
      onConfirm={async () => {
        await api('DELETE', orgApiPath(membership, `/guardians/${guardian.id}`));
        await refresh();
      }}
    />
  );
}

/** Balance and recent payments: for roles that read billing. */
function MoneyCards({ familyId, familyName }: { familyId: string; familyName: string }) {
  const { membership } = useOrg();
  const format = useFormat();
  const [paying, setPaying] = useState(false);
  const invoices = useQuery({
    queryKey: ['invoices', membership.org.id, { familyId }],
    queryFn: ({ signal }) =>
      api<Page<Invoice>>(
        'GET',
        orgApiPath(membership, `/invoices${query({ familyId, limit: 200 })}`),
        { signal },
      ),
  });
  const payments = useQuery({
    queryKey: ['payments', membership.org.id, { familyId }],
    queryFn: ({ signal }) =>
      api<Page<Payment>>(
        'GET',
        orgApiPath(membership, `/payments${query({ familyId, limit: 200 })}`),
        { signal },
      ),
  });

  const list = invoices.data?.data ?? [];
  const open = list.filter(isOpen);
  const overdue = open.filter((i) => invoiceStatus(i, format.today) === 'overdue').length;
  const owing = open.reduce((sum, i) => sum + i.balance.amount, 0);
  const currency = open[0]?.balance.currency;
  const recent = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
  const received = [...(payments.data?.data ?? [])]
    .sort(
      (a, b) => b.receivedOn.localeCompare(a.receivedOn) || b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, 3);

  return (
    <>
      <SectionCard
        title={t('people.balance')}
        action={
          <span className="flex items-center gap-2">
            {overdue ? (
              <Badge tone="danger">{t('people.overdueCount', { n: overdue })}</Badge>
            ) : null}
            {owing > 0 && can(membership.role, 'billing:write') ? (
              <Button variant="secondary" size="sm" onClick={() => setPaying(true)}>
                {t('billing.recordPayment')}
              </Button>
            ) : null}
          </span>
        }
      >
        {invoices.isPending ? (
          <div className="h-24 animate-pulse bg-canvas/60" aria-hidden />
        ) : invoices.isError ? (
          <CardEmpty>{t('error.generic')}</CardEmpty>
        ) : (
          <>
            <div className="flex items-baseline justify-between px-4 py-4">
              <span className="text-body text-muted">{t('people.owing')}</span>
              {currency ? (
                <strong className="text-stat font-bold text-text tabular-nums">
                  {format.money({ amount: owing, currency })}
                </strong>
              ) : (
                <span className="text-body font-semibold text-text">
                  {t('people.nothingOwing')}
                </span>
              )}
            </div>
            {recent.length ? (
              <ul className="divide-y divide-border border-t border-border">
                {recent.map((invoice) => (
                  <InvoiceRow key={invoice.id} invoice={invoice} />
                ))}
              </ul>
            ) : (
              <p className="border-t border-border px-4 py-3.5 text-body text-muted">
                {t('people.noInvoices')}
              </p>
            )}
          </>
        )}
      </SectionCard>
      <SectionCard title={t('people.recentPayments')}>
        {payments.isPending ? (
          <div className="h-20 animate-pulse bg-canvas/60" aria-hidden />
        ) : payments.isError ? (
          <CardEmpty>{t('error.generic')}</CardEmpty>
        ) : received.length === 0 ? (
          <CardEmpty>{t('people.noPayments')}</CardEmpty>
        ) : (
          <ul className="divide-y divide-border">
            {received.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex flex-col">
                  <b className="text-body font-semibold text-text">
                    {format.date(payment.receivedOn)}
                  </b>
                  <small className="text-meta text-muted">{methodLabel(payment.method)}</small>
                </span>
                <b className="text-body font-semibold text-text tabular-nums">
                  {format.money(payment.amount)}
                </b>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <RecordPaymentDialog
        open={paying}
        onClose={() => setPaying(false)}
        familyId={familyId}
        familyName={familyName}
      />
    </>
  );
}

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const format = useFormat();
  const paths = useBillingPaths();
  const status = invoiceStatus(invoice, format.today);
  return (
    <li>
      <Link
        to={paths.invoice(invoice.id)}
        className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3 hover:bg-canvas"
      >
        <span className="flex min-w-0 flex-col">
          <b className="truncate text-body font-semibold text-text">
            {format.date(invoice.periodStart)} – {format.date(invoice.periodEnd)}
          </b>
          <small className="text-meta text-muted">
            {invoice.dueDate
              ? t('people.due', { date: format.date(invoice.dueDate) })
              : t('people.noDueDate')}
          </small>
        </span>
        <span className="text-body text-text tabular-nums">{format.money(invoice.total)}</span>
        <InvoiceBadge status={status} />
      </Link>
    </li>
  );
}
