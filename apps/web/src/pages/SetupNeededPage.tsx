import { Card } from '../components/ui/Card';
import { t } from '../i18n';
import { AuthLayout } from '../layouts/AuthLayout';

/** Shown in development until the Clerk publishable key is set (apps/web/.env.example). */
export function SetupNeededPage() {
  return (
    <AuthLayout>
      <Card className="flex flex-col gap-3">
        <h1 className="text-section font-medium text-text">{t('setup.title')}</h1>
        <p className="text-body text-muted">{t('setup.body')}</p>
        <code className="rounded-lg bg-canvas px-3 py-2 text-meta break-all text-text">
          VITE_CLERK_PUBLISHABLE_KEY=pk_test_…
        </code>
      </Card>
    </AuthLayout>
  );
}
