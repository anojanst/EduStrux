import type { Branch, CreatedInvitation, CreateInvitation, StaffMember } from '@edustrux/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, MailPlus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { PageError, PageHeader, errorMessage } from '../components/PageState';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SelectField, TextField } from '../components/ui/Field';
import { Notice } from '../components/ui/Notice';
import { t } from '../i18n';
import { api, ApiError, fieldErrors } from '../lib/api';
import { orgApiPath, useOrg } from '../lib/org';
import { can, invitableRoles, ORG_WIDE_ROLES, roleLabel, type Role } from '../lib/roles';

type Page<T> = { data: T[]; nextCursor: string | null };

/**
 * Settings › Team: the org's staff (`GET /staff`) and inviting more (`POST /staff/invitations`).
 * Parents aren't listed or invited here: they're invited from their guardian (D-131).
 */
export function TeamPage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'staff:read')) {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <Team />;
}

function Team() {
  const { membership } = useOrg();
  const [inviting, setInviting] = useState(false);
  const canInvite = can(membership.role, 'staff:write');

  const staff = useInfiniteQuery({
    queryKey: ['staff', membership.org.id],
    queryFn: ({ pageParam, signal }) =>
      api<Page<StaffMember>>(
        'GET',
        orgApiPath(
          membership,
          `/staff?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        ),
        { signal },
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const branches = useQuery({
    queryKey: ['branches', membership.org.id],
    queryFn: ({ signal }) =>
      api<Page<Branch>>('GET', orgApiPath(membership, '/branches?limit=200'), { signal }),
  });
  const branchName = (id: string) => branches.data?.data.find((b) => b.id === id)?.name ?? id;

  return (
    <>
      <PageHeader
        overline={t('team.overline')}
        title={t('team.title')}
        subtitle={t('team.subtitle')}
        action={
          canInvite && !inviting ? (
            <Button icon={<MailPlus className="size-4" />} onClick={() => setInviting(true)}>
              {t('team.invite')}
            </Button>
          ) : null
        }
      />

      {inviting ? (
        <InviteForm branches={branches.data?.data ?? []} onClose={() => setInviting(false)} />
      ) : null}

      <Card className="p-0 sm:p-0">
        {staff.isPending ? (
          <ul aria-hidden className="divide-y divide-border">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex h-[60px] items-center gap-3 px-4 sm:px-5">
                <span className="size-9 animate-pulse rounded-full bg-canvas" />
                <span className="h-4 w-40 animate-pulse rounded bg-canvas" />
              </li>
            ))}
          </ul>
        ) : staff.isError ? (
          <PageError error={staff.error} onRetry={() => void staff.refetch()} />
        ) : (
          <ul className="divide-y divide-border">
            {staff.data.pages
              .flatMap((p) => p.data)
              .map((member) => (
                <li key={member.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <Avatar name={member.name} fallback={member.email ?? '?'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-text">
                      {member.name ?? member.email ?? t('team.unnamed')}
                      {member.id === membership.id ? (
                        <span className="font-normal text-muted"> {t('team.you')}</span>
                      ) : null}
                    </span>
                    <span className="block truncate text-meta text-muted">
                      {[
                        member.name ? member.email : null,
                        member.branchIds
                          ? member.branchIds.map(branchName).join(', ')
                          : t('team.allBranches'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <Badge tone="brand">{roleLabel(member.role)}</Badge>
                    {member.status === 'suspended' ? (
                      <Badge tone="neutral">{t('team.suspended')}</Badge>
                    ) : null}
                  </span>
                </li>
              ))}
          </ul>
        )}
        {staff.hasNextPage ? (
          <div className="border-t border-border p-3 text-center">
            <Button
              variant="secondary"
              loading={staff.isFetchingNextPage}
              onClick={() => void staff.fetchNextPage()}
            >
              {t('common.loadMore')}
            </Button>
          </div>
        ) : null}
      </Card>
    </>
  );
}

/**
 * The invite form. A branch manager limited to some branches must pick from theirs; an owner
 * or accountant invite takes no branches (D-131). On success the link is shown to copy, since
 * invite emails may not be set up yet.
 */
function InviteForm({ branches, onClose }: { branches: Branch[]; onClose: () => void }) {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  const roles = invitableRoles(membership.role);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(roles.includes('teacher') ? 'teacher' : roles[0]!);
  const ownBranches = membership.branchIds;
  const choosable = ownBranches ? branches.filter((b) => ownBranches.includes(b.id)) : branches;
  const [picked, setPicked] = useState<string[]>([]);
  const [sent, setSent] = useState<CreatedInvitation | null>(null);

  const orgWide = ORG_WIDE_ROLES.includes(role);
  // Only worth asking where there's a choice, or where the API needs one (a limited manager).
  const askBranches = !orgWide && (choosable.length > 1 || ownBranches !== null);

  const invite = useMutation({
    mutationFn: (body: CreateInvitation) =>
      api<CreatedInvitation>('POST', orgApiPath(membership, '/staff/invitations'), { body }),
    onSuccess: (created) => {
      setSent(created);
      void queryClient.invalidateQueries({ queryKey: ['staff', membership.org.id] });
    },
  });
  const errors = fieldErrors(invite.error);
  const formError =
    invite.error && !(invite.error instanceof ApiError && invite.error.status === 400)
      ? invite.error instanceof ApiError && invite.error.status === 403
        ? t('team.form.forbidden')
        : errorMessage(invite.error)
      : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    invite.mutate({
      email: email.trim(),
      role: role as CreateInvitation['role'],
      ...(askBranches ? { branchIds: picked.length ? picked : null } : {}),
    });
  }

  if (sent) {
    return (
      <SentInvite
        sent={sent}
        onAnother={() => {
          setSent(null);
          setEmail('');
          setPicked([]);
          invite.reset();
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-section font-medium text-text">{t('team.form.title')}</h2>
          <p className="mt-1 text-meta text-muted">{t('team.form.subtitle')}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('common.close')}
          onClick={onClose}
          icon={<X className="size-4 text-muted" />}
        />
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t('team.form.email')}
            required
            type="email"
            autoComplete="off"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <SelectField
            label={t('team.form.role')}
            required
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            options={roles.map((r) => ({ value: r, label: roleLabel(r) }))}
            helper={t(`team.roleHelp.${role}` as Parameters<typeof t>[0])}
            error={errors.role}
          />
        </div>
        {askBranches ? (
          <fieldset>
            <legend className="text-label font-medium text-text">
              {t('team.form.branches')}
              {ownBranches ? (
                <span className="font-normal text-muted"> {t('form.required')}</span>
              ) : null}
            </legend>
            <p className="mt-0.5 text-meta text-muted">
              {ownBranches ? t('team.form.branchesLimited') : t('team.form.branchesHelper')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {choosable.map((branch) => {
                const on = picked.includes(branch.id);
                return (
                  <label
                    key={branch.id}
                    className={
                      'inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-label font-medium sm:h-9 ' +
                      (on
                        ? 'border-brand bg-brand-soft text-brand'
                        : 'border-border-strong bg-surface text-secondary-text hover:bg-canvas')
                    }
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--brand)]"
                      checked={on}
                      onChange={() =>
                        setPicked((list) =>
                          on ? list.filter((id) => id !== branch.id) : [...list, branch.id],
                        )
                      }
                    />
                    {branch.name}
                  </label>
                );
              })}
            </div>
            {errors.branchIds ? (
              <p className="mt-1.5 text-meta text-danger">{errors.branchIds}</p>
            ) : null}
          </fieldset>
        ) : null}
        {formError ? <Notice tone="danger">{formError}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={invite.isPending}>
            {t('team.form.send')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SentInvite({
  sent,
  onAnother,
  onClose,
}: {
  sent: CreatedInvitation;
  onAnother: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/invitations/${sent.token}`;
  return (
    <Card className="mb-6">
      <Notice tone="success" title={t('team.sent.title', { email: sent.invitation.email })}>
        {t('team.sent.body')}
      </Notice>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={link}
          aria-label={t('team.sent.link')}
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 min-w-0 flex-1 rounded-lg border border-border-strong bg-canvas px-3 text-body text-secondary-text sm:h-10"
        />
        <Button
          variant="secondary"
          icon={copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
        >
          {copied ? t('team.sent.copied') : t('team.sent.copy')}
        </Button>
      </div>
      <p className="mt-2 text-meta text-muted">{t('team.sent.expires')}</p>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          {t('common.done')}
        </Button>
        <Button onClick={onAnother}>{t('team.sent.another')}</Button>
      </div>
    </Card>
  );
}
