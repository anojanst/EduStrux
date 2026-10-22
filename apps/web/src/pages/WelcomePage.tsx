import { useClerk } from '@clerk/react';
import { ChevronRight, Mail, School } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { t } from '../i18n';
import { AuthLayout } from '../layouts/AuthLayout';
import { useMe } from '../lib/session';

/**
 * Signed in but in no org yet: someone who signed up to start a centre and stopped before
 * creating it, or an invited person who signed up without their link.
 */
export function WelcomePage() {
  const me = useMe();
  const { signOut } = useClerk();
  return (
    <AuthLayout>
      <h1 className="text-title font-normal text-text">{t('welcome.title')}</h1>
      <p className="mt-2 text-body text-muted">
        {me.data?.email
          ? t('welcome.subtitleEmail', { email: me.data.email })
          : t('welcome.subtitle')}
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <Link to="/onboarding" className="group block">
          <Card className="flex items-center gap-4 transition-colors duration-150 group-hover:border-border-strong group-hover:bg-canvas">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <School className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold text-text">
                {t('welcome.startTitle')}
              </span>
              <span className="block text-meta text-muted">{t('welcome.startBody')}</span>
            </span>
            <ChevronRight className="size-4 text-subtle" aria-hidden />
          </Card>
        </Link>
        <Card className="flex items-center gap-4">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info">
            <Mail className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold text-text">
              {t('welcome.joinTitle')}
            </span>
            <span className="block text-meta text-muted">{t('welcome.joinBody')}</span>
          </span>
        </Card>
      </div>
      <Button variant="ghost" className="mt-6" onClick={() => void signOut()}>
        {t('common.signOut')}
      </Button>
    </AuthLayout>
  );
}
