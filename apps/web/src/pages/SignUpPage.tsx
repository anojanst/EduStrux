import { SignUp } from '@clerk/react';
import { Mail } from 'lucide-react';
import { t } from '../i18n';
import { AuthLayout } from '../layouts/AuthLayout';

/**
 * Sign-up is for someone starting a centre: the account first, then the org on /onboarding,
 * which starts the 14-day trial (D-153). Staff and parents join through their invite link
 * instead, which signs them up on the invitation page.
 */
export function SignUpPage() {
  return (
    <AuthLayout aside={<SignUpAside />}>
      <SignUp path="/sign-up" routing="path" signInUrl="/sign-in" forceRedirectUrl="/onboarding" />
      <p className="mt-6 flex items-start gap-2 text-meta text-muted">
        <Mail className="mt-px size-4 shrink-0" aria-hidden />
        {t('auth.signUp.invitedHint')}
      </p>
    </AuthLayout>
  );
}

function SignUpAside() {
  return (
    <div>
      <p className="text-meta font-semibold tracking-[0.05em] text-sidebar-text uppercase">
        {t('auth.signUp.overline')}
      </p>
      <h2 className="mt-2 text-title font-normal text-white">{t('auth.signUp.asideTitle')}</h2>
      <p className="mt-4 text-body">{t('auth.signUp.asideBody')}</p>
    </div>
  );
}
