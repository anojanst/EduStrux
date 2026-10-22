import { SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import type { InvitationPreview, Me } from '@edustrux/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Clock, Link2Off } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { PageError, PageLoading, errorMessage } from '../components/PageState';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button, buttonClass } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Notice } from '../components/ui/Notice';
import { t } from '../i18n';
import { AuthLayout } from '../layouts/AuthLayout';
import { ApiError, api } from '../lib/api';
import { cn } from '../lib/cn';
import { roleLabel } from '../lib/roles';
import { meKey, orgPath, rememberOrg } from '../lib/session';

/**
 * Where an invite email's link lands (`APP_URL/invitations/{token}`, D-131). Staff and parents
 * both register here: the page shows who invited them and as what, signs them up (or in) without
 * leaving it, then joins them to the org with `POST /invitations/{token}/accept`.
 */
export function InvitationPage() {
  const { token = '' } = useParams();
  const { isLoaded, isSignedIn } = useAuth();
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: ({ signal }) =>
      api<InvitationPreview>('GET', `/invitations/${encodeURIComponent(token)}`, {
        signal,
        auth: false,
      }),
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });

  if (preview.isPending || !isLoaded) {
    return (
      <AuthLayout>
        <PageLoading />
      </AuthLayout>
    );
  }

  if (preview.isError) {
    const unknown = preview.error instanceof ApiError && preview.error.status === 404;
    return (
      <AuthLayout>
        {unknown ? (
          <Problem
            icon={<Link2Off className="size-5" aria-hidden />}
            title={t('invite.invalid.title')}
            body={t('invite.invalid.body')}
            signedIn={isSignedIn}
          />
        ) : (
          <PageError error={preview.error} onRetry={() => void preview.refetch()} />
        )}
      </AuthLayout>
    );
  }

  const invite = preview.data;
  if (invite.status === 'accepted') {
    return (
      <AuthLayout>
        <Problem
          icon={<CircleAlert className="size-5" aria-hidden />}
          title={t('invite.used.title')}
          body={t('invite.used.body', { org: invite.org.name })}
          signedIn={isSignedIn}
        />
      </AuthLayout>
    );
  }
  if (invite.status === 'expired') {
    return (
      <AuthLayout>
        <Problem
          icon={<Clock className="size-5" aria-hidden />}
          title={t('invite.expired.title')}
          body={t('invite.expired.body', { org: invite.org.name })}
          signedIn={isSignedIn}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <InviteHeader invite={invite} />
      {isSignedIn ? <AcceptInvite token={token} invite={invite} /> : <InviteAuth invite={invite} />}
    </AuthLayout>
  );
}

function InviteHeader({ invite }: { invite: InvitationPreview }) {
  return (
    <Card className="mb-6">
      <div className="flex items-start gap-3">
        <Avatar name={invite.org.name} tone="org" className="size-10" />
        <div className="min-w-0">
          <p className="text-meta font-semibold tracking-[0.05em] text-muted uppercase">
            {t('invite.overline')}
          </p>
          <h1 className="mt-1 text-section font-medium text-text">
            {t('invite.title', { org: invite.org.name })}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-meta text-muted">
            <Badge tone="brand">{roleLabel(invite.role)}</Badge>
            <span className="break-all">{t('invite.sentTo', { email: invite.email })}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Signed out: create an account (the default, as most invitees are new) or sign in to one they
 * have, with the invite's address filled in. Clerk's steps stay on this page (hash routing) and
 * come back here signed in.
 */
function InviteAuth({ invite }: { invite: InvitationPreview }) {
  const location = useLocation();
  const here = location.pathname;
  const [mode, setMode] = useState<'sign-up' | 'sign-in'>('sign-up');
  const isParent = invite.role === 'parent';
  const viaSignIn = `/sign-in?redirect_url=${encodeURIComponent(here)}`;

  return (
    <div>
      <p className="mb-4 text-body text-muted">
        {isParent ? t('invite.auth.parentIntro') : t('invite.auth.staffIntro')}
      </p>
      <div
        role="tablist"
        aria-label={t('invite.auth.tabs')}
        className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface p-1"
      >
        {(['sign-up', 'sign-in'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              'h-10 rounded-md text-label font-medium transition-colors duration-150',
              mode === value ? 'bg-brand-soft text-brand' : 'text-muted hover:text-text',
            )}
          >
            {value === 'sign-up' ? t('invite.auth.newAccount') : t('invite.auth.haveAccount')}
          </button>
        ))}
      </div>
      {mode === 'sign-up' ? (
        <SignUp
          routing="hash"
          initialValues={{ emailAddress: invite.email }}
          forceRedirectUrl={here}
          signInUrl={viaSignIn}
        />
      ) : (
        <SignIn
          routing="hash"
          initialValues={{ emailAddress: invite.email }}
          forceRedirectUrl={here}
          signUpUrl={here}
        />
      )}
    </div>
  );
}

/** What a 409 or 422 from accepting means, from the field the API names (D-131). */
function acceptProblem(error: unknown, org: string): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return t('invite.accept.alreadyMember', { org });
    const reason = error.fields.token?.[0];
    if (reason === 'Used') return t('invite.used.body', { org });
    if (reason === 'Expired') return t('invite.expired.body', { org });
    if (reason === 'Guardian removed') return t('invite.accept.guardianRemoved', { org });
    if (error.status === 404) return t('invite.invalid.body');
  }
  return errorMessage(error);
}

/**
 * Signed in: join with one click. The token alone is the proof (D-131), so a different signed-in
 * address is allowed, but it is pointed out with a way to switch account first.
 */
function AcceptInvite({ token, invite }: { token: string; invite: InvitationPreview }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signedInEmail = user?.primaryEmailAddress?.emailAddress ?? null;
  const otherAddress =
    signedInEmail !== null && signedInEmail.toLowerCase() !== invite.email.toLowerCase();

  const accept = useMutation({
    mutationFn: () =>
      api<Me['memberships'][number]>('POST', `/invitations/${encodeURIComponent(token)}/accept`),
    onSuccess: async (membership) => {
      await queryClient.invalidateQueries({ queryKey: meKey });
      queryClient.removeQueries({ queryKey: ['invitation', token] });
      rememberOrg(membership.org.slug);
      navigate(orgPath(membership.org.slug), { replace: true });
    },
  });
  const alreadyMember = accept.error instanceof ApiError && accept.error.status === 409;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-muted">
        {signedInEmail
          ? t('invite.accept.signedInAs', { email: signedInEmail })
          : t('invite.accept.signedIn')}
      </p>
      {otherAddress ? (
        <Notice tone="warning" title={t('invite.accept.otherAddressTitle')}>
          {t('invite.accept.otherAddressBody', { invited: invite.email, email: signedInEmail })}
        </Notice>
      ) : null}
      {accept.isError ? (
        <Notice tone="danger">{acceptProblem(accept.error, invite.org.name)}</Notice>
      ) : null}
      {alreadyMember ? (
        <Link to={orgPath(invite.org.slug)} className={buttonClass('primary')}>
          {t('invite.accept.open', { org: invite.org.name })}
        </Link>
      ) : (
        <Button loading={accept.isPending} onClick={() => accept.mutate()}>
          {t('invite.accept.join', { org: invite.org.name })}
        </Button>
      )}
      <Button variant="ghost" onClick={() => void signOut({ redirectUrl: location.pathname })}>
        {t('invite.accept.switchAccount')}
      </Button>
    </div>
  );
}

function Problem({
  icon,
  title,
  body,
  signedIn,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  signedIn: boolean | undefined;
}) {
  return (
    <Card className="flex flex-col items-start gap-3">
      <span className="inline-flex size-10 items-center justify-center rounded-lg bg-warning-soft text-warning">
        {icon}
      </span>
      <h1 className="text-section font-medium text-text">{title}</h1>
      <p className="text-body text-muted">{body}</p>
      <Link to={signedIn ? '/' : '/sign-in'} className={cn(buttonClass('secondary'), 'mt-2')}>
        {signedIn ? t('common.continue') : t('invite.goToSignIn')}
      </Link>
    </Card>
  );
}
