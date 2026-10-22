import { SignIn } from '@clerk/react';
import { Mail } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { t } from '../i18n';
import { AuthLayout } from '../layouts/AuthLayout';
import { safeRedirect } from '../lib/session';

/**
 * One sign-in for every role: owners and staff, and parents (who sign in with an email code,
 * D-021). What they reach afterwards comes from their memberships, not from where they signed in.
 */
export function SignInPage() {
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get('redirect_url'));
  return (
    <AuthLayout>
      <SignIn
        path="/sign-in"
        routing="path"
        signUpUrl="/sign-up"
        fallbackRedirectUrl={redirect ?? '/'}
      />
      <p className="mt-6 flex items-start gap-2 text-meta text-muted">
        <Mail className="mt-px size-4 shrink-0" aria-hidden />
        {t('auth.signIn.invitedHint')}
      </p>
    </AuthLayout>
  );
}
