import { useClerk, useSession, useUser } from '@clerk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Monitor, Plus, Smartphone, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { CodeInput } from '../../components/ui/CodeInput';
import { Dialog } from '../../components/ui/Dialog';
import { TextField } from '../../components/ui/Field';
import { OverflowMenu } from '../../components/ui/Menu';
import { Notice } from '../../components/ui/Notice';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { useOrg } from '../../lib/org';
import { ResendButton, useSensitive } from './reverify';
import { clerkMessage, useCountdown, useRefreshIdentity, wasCancelled } from './shared';

/**
 * Sign-in and security: emails, devices and deleting the account (D-161). Everyone signs in with a
 * code sent to their email, so there's no password to set (D-192).
 */
export function SecuritySection() {
  return (
    <div className="flex flex-col gap-4">
      <EmailsCard />
      <DevicesCard />
      <DeleteCard />
    </div>
  );
}

function SettingIcon({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-[#f0f4f4] text-brand">
      {children}
    </span>
  );
}

/** A card's heading row: title and description, with its action beside it (below on phones). */
function SettingTitle({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-4 md:min-h-[82px] md:flex-row md:items-center md:justify-between md:gap-5 md:py-0">
      <div>
        <h3 className="text-label font-semibold text-text">{title}</h3>
        <p className="mt-1 text-meta text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

const rowClass =
  'grid min-h-[78px] grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-[11px] border-t border-border md:min-h-[70px] md:grid-cols-[38px_minmax(0,1fr)_auto]';

// ── Email addresses ─────────────────────────────────────────────────────────

type EmailFlow = { kind: 'add' } | { kind: 'verify'; id: string; email: string } | null;

function EmailsCard() {
  const { user } = useUser();
  const toast = useToast();
  const refreshIdentity = useRefreshIdentity();
  const [flow, setFlow] = useState<EmailFlow>(null);
  const [removing, setRemoving] = useState<{ id: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const makePrimary = useSensitive(async (id: string) => {
    await user!.update({ primaryEmailAddressId: id });
  });

  if (!user) return null;
  const primaryId = user.primaryEmailAddressId;
  const emails = [...user.emailAddresses].sort(
    (a, b) => Number(b.id === primaryId) - Number(a.id === primaryId),
  );

  return (
    <Card flush className="px-4 md:px-5">
      <SettingTitle
        title={t('security.email.title')}
        body={t('security.email.body')}
        action={
          <Button
            variant="secondary"
            className="max-md:h-11"
            icon={<Plus className="size-4" />}
            onClick={() => setFlow({ kind: 'add' })}
          >
            {t('security.email.add')}
          </Button>
        }
      />
      {error ? (
        <Notice tone="danger" className="mb-3">
          {error}
        </Notice>
      ) : null}
      {emails.map((email) => {
        const primary = email.id === primaryId;
        const verified = email.verification?.status === 'verified';
        return (
          <div key={email.id} className={rowClass}>
            <SettingIcon>
              <Mail className="size-4" aria-hidden />
            </SettingIcon>
            <div className="flex min-w-0 flex-col gap-1">
              <b className="truncate text-label text-text">{email.emailAddress}</b>
              {primary ? (
                <span className="text-meta text-muted">{t('security.email.primaryHint')}</span>
              ) : verified ? (
                <span className="text-meta text-muted">{t('security.email.verifiedHint')}</span>
              ) : (
                <span className="flex items-center gap-2 text-meta">
                  <Badge tone="warning">{t('security.email.notVerified')}</Badge>
                  <button
                    type="button"
                    className="font-semibold text-brand"
                    onClick={() =>
                      setFlow({ kind: 'verify', id: email.id, email: email.emailAddress })
                    }
                  >
                    {t('security.email.verify')}
                  </button>
                </span>
              )}
            </div>
            {primary ? (
              <Badge tone="info">{t('security.email.primary')}</Badge>
            ) : (
              <OverflowMenu
                label={t('security.email.options', { email: email.emailAddress })}
                items={[
                  ...(verified
                    ? [
                        {
                          label: t('security.email.makePrimary'),
                          onSelect: () => {
                            setError(null);
                            makePrimary(email.id)
                              .then(async () => {
                                await refreshIdentity();
                                toast(t('security.email.primaryDone'));
                              })
                              .catch((err: unknown) => {
                                if (!wasCancelled(err)) setError(clerkMessage(err));
                              });
                          },
                        },
                      ]
                    : []),
                  {
                    label: t('security.email.remove'),
                    danger: true,
                    onSelect: () => setRemoving({ id: email.id, email: email.emailAddress }),
                  },
                ]}
              />
            )}
          </div>
        );
      })}
      <AddEmailDialog flow={flow} onClose={() => setFlow(null)} />
      <RemoveEmailDialog target={removing} onClose={() => setRemoving(null)} />
    </Card>
  );
}

/**
 * Adding an address (step 1: the address; step 2: the code sent to it), or verifying one added
 * before (straight to step 2).
 */
function AddEmailDialog({ flow, onClose }: { flow: EmailFlow; onClose: () => void }) {
  const { user } = useUser();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<{ id: string; email: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, restartResend] = useCountdown(30);
  const createEmail = useSensitive(async (address: string) => {
    const created = await user!.createEmailAddress({ email: address });
    await created.prepareVerification({ strategy: 'email_code' });
    return created;
  });

  // Each opening starts fresh; verifying a known address sends its code straight away.
  useEffect(() => {
    setEmail('');
    setCode('');
    setError(null);
    setSentTo(flow?.kind === 'verify' ? { id: flow.id, email: flow.email } : null);
    if (flow?.kind !== 'verify') return;
    restartResend();
    user?.emailAddresses
      .find((e) => e.id === flow.id)
      ?.prepareVerification({ strategy: 'email_code' })
      .catch((err: unknown) => setError(clerkMessage(err)));
    // Runs when the dialog opens for a new flow; restartResend only resets a counter.
  }, [flow]);

  const close = onClose;

  async function sendCode() {
    if (!email.trim()) {
      setError(t('security.email.enterAddress'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createEmail(email.trim());
      setSentTo({ id: created.id, email: created.emailAddress });
      restartResend();
    } catch (err) {
      if (!wasCancelled(err)) setError(clerkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    const address = user?.emailAddresses.find((e) => e.id === sentTo?.id);
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      await address.attemptVerification({ code });
      toast(t('security.email.added'));
      close();
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    const address = user?.emailAddresses.find((e) => e.id === sentTo?.id);
    setError(null);
    try {
      await address?.prepareVerification({ strategy: 'email_code' });
      restartResend();
    } catch (err) {
      setError(clerkMessage(err));
    }
  }

  return (
    <Dialog
      open={flow !== null}
      onClose={close}
      title={sentTo ? t('security.email.checkTitle') : t('security.email.add')}
      actions={
        <>
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
          {sentTo ? (
            <Button loading={busy} disabled={code.length < 6} onClick={() => void verify()}>
              {t('common.continue')}
            </Button>
          ) : (
            <Button loading={busy} onClick={() => void sendCode()}>
              {t('security.email.sendCode')}
            </Button>
          )}
        </>
      }
    >
      {sentTo ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-muted">
            {t('security.email.codeIntro', { email: sentTo.email })}
          </p>
          <CodeInput value={code} onChange={setCode} invalid={error !== null} />
          {error ? <p className="text-meta text-danger">{error}</p> : null}
          <ResendButton left={resendIn} onResend={() => void resend()} />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
        >
          <TextField
            label={t('security.email.address')}
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error ?? undefined}
          />
        </form>
      )}
    </Dialog>
  );
}

function RemoveEmailDialog({
  target,
  onClose,
}: {
  target: { id: string; email: string } | null;
  onClose: () => void;
}) {
  const { user } = useUser();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useSensitive(async (id: string) => {
    await user!.emailAddresses.find((e) => e.id === id)?.destroy();
  });

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await remove(target.id);
      toast(t('security.email.removed'));
      onClose();
    } catch (err) {
      if (!wasCancelled(err)) setError(clerkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={t('security.email.removeTitle')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            {t('security.email.remove')}
          </Button>
        </>
      }
    >
      <p className="text-body text-muted">
        {t('security.email.removeBody', { email: target?.email ?? '' })}
      </p>
      {error ? (
        <Notice tone="danger" className="mt-4">
          {error}
        </Notice>
      ) : null}
    </Dialog>
  );
}

// ── Signed-in devices ───────────────────────────────────────────────────────

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "Active now" within five minutes, otherwise "Last active 2 days ago". */
export function lastActive(at: Date, now = new Date()): string {
  const seconds = Math.round((at.getTime() - now.getTime()) / 1000);
  if (seconds > -300) return t('security.devices.activeNow');
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2592000],
  ];
  let unit: Intl.RelativeTimeFormatUnit = 'minute';
  let size = 60;
  for (const [u, s] of steps) if (-seconds >= s) [unit, size] = [u, s];
  return t('security.devices.lastActive', {
    when: relative.format(Math.round(seconds / size), unit),
  });
}

function DevicesCard() {
  const { user } = useUser();
  const { session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['clerk-sessions', user?.id],
    queryFn: () => user!.getSessions(),
    enabled: user !== null && user !== undefined,
  });
  const revoke = useSensitive(async (ids: string[]) => {
    const list = sessions.data ?? [];
    await Promise.all(list.filter((s) => ids.includes(s.id)).map((s) => s.revoke()));
  });

  const currentId = session?.id;
  const list = [...(sessions.data ?? [])]
    .filter((s) => s.status === 'active')
    .sort(
      (a, b) =>
        Number(b.id === currentId) - Number(a.id === currentId) ||
        b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
    );
  const others = list.filter((s) => s.id !== currentId).map((s) => s.id);

  async function signOut(ids: string[]) {
    setBusy(ids.length > 1 ? 'all' : ids[0]!);
    setError(null);
    try {
      await revoke(ids);
      await queryClient.invalidateQueries({ queryKey: ['clerk-sessions'] });
      toast(ids.length > 1 ? t('security.devices.allSignedOut') : t('security.devices.signedOut'));
      setConfirmAll(false);
    } catch (err) {
      if (!wasCancelled(err)) setError(clerkMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card flush className="px-4 md:px-5">
      <SettingTitle title={t('security.devices.title')} body={t('security.devices.body')} />
      {error ? (
        <Notice tone="danger" className="mb-3">
          {error}
        </Notice>
      ) : null}
      {sessions.isPending ? (
        <div aria-hidden className="border-t border-border py-4">
          <div className="h-10 animate-pulse rounded-lg bg-canvas" />
        </div>
      ) : (
        list.map((s) => {
          const a = s.latestActivity;
          const name =
            a?.browserName && a.deviceType
              ? t('security.devices.device', { browser: a.browserName, device: a.deviceType })
              : (a?.browserName ?? a?.deviceType ?? t('security.devices.unknown'));
          const place = [a?.city, a?.country].filter(Boolean).join(', ');
          const when =
            s.id === currentId ? t('security.devices.activeNow') : lastActive(s.lastActiveAt);
          return (
            <div key={s.id} className={rowClass}>
              <SettingIcon>
                {a?.isMobile ? (
                  <Smartphone className="size-4" aria-hidden />
                ) : (
                  <Monitor className="size-4" aria-hidden />
                )}
              </SettingIcon>
              <div className="flex min-w-0 flex-col gap-1">
                <b className="truncate text-label text-text">{name}</b>
                <span className="text-meta text-muted">
                  {place ? t('security.devices.where', { place, when }) : when}
                </span>
              </div>
              {s.id === currentId ? (
                <Badge tone="success">{t('security.devices.thisDevice')}</Badge>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="max-md:h-11"
                  loading={busy === s.id}
                  onClick={() => void signOut([s.id])}
                >
                  {t('security.devices.signOut')}
                </Button>
              )}
            </div>
          );
        })
      )}
      {others.length > 0 ? (
        <button
          type="button"
          onClick={() => setConfirmAll(true)}
          className="flex min-h-12 w-full items-center border-t border-border text-left text-label font-semibold text-brand"
        >
          {t('security.devices.signOutAll')}
        </button>
      ) : null}
      <Dialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title={t('security.devices.confirmTitle')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmAll(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy === 'all'} onClick={() => void signOut(others)}>
              {t('security.devices.confirmAction')}
            </Button>
          </>
        }
      >
        <p className="text-body text-muted">{t('security.devices.confirmBody')}</p>
      </Dialog>
    </Card>
  );
}

// ── Delete account ──────────────────────────────────────────────────────────

/**
 * Deleting the account, where Clerk allows it. An owner can't: the centre would be left with no
 * one able to run it, and there's no way to hand it over yet.
 */
function DeleteCard() {
  const { user } = useUser();
  const { me } = useOrg();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useSensitive(async () => {
    await user!.delete();
  });

  if (!user?.deleteSelfEnabled) return null;
  const email = user.primaryEmailAddress?.emailAddress ?? '';
  const owned = me.memberships.filter((m) => m.role === 'owner').map((m) => m.org.name);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await remove();
      queryClient.clear();
      await signOut().catch(() => {});
      navigate('/sign-in', { replace: true });
    } catch (err) {
      if (!wasCancelled(err)) setError(clerkMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card
      flush
      className="flex flex-col items-start gap-4 border-l-4 border-l-danger px-5 py-[19px] md:flex-row md:items-center md:justify-between"
    >
      <div>
        <h3 className="text-label font-semibold text-text">{t('security.delete.title')}</h3>
        <p className="mt-1 text-meta text-muted">
          {owned.length > 0
            ? t('security.delete.owner', { orgs: owned.join(', ') })
            : t('security.delete.body')}
        </p>
      </div>
      {owned.length === 0 ? (
        <Button
          variant="dangerOutline"
          className="max-md:h-11 max-md:w-full"
          icon={<Trash2 className="size-4" />}
          onClick={() => {
            setTyped('');
            setError(null);
            setOpen(true);
          }}
        >
          {t('security.delete.action')}
        </Button>
      ) : null}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('security.delete.confirmTitle')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={typed.trim().toLowerCase() !== email.toLowerCase()}
              onClick={() => void confirm()}
            >
              {t('security.delete.action')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-body text-muted">{t('security.delete.confirmBody')}</p>
          <TextField
            label={t('security.delete.typeEmail', { email })}
            type="email"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {busy ? (
            <p className="flex items-center gap-2 text-meta text-muted">
              <Spinner /> {t('security.delete.deleting')}
            </p>
          ) : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </div>
      </Dialog>
    </Card>
  );
}
