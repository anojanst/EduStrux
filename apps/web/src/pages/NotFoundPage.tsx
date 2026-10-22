import { Link } from 'react-router';
import { buttonClass } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { t } from '../i18n';
import { AuthLayout } from '../layouts/AuthLayout';

export function NotFoundPage() {
  return (
    <AuthLayout>
      <Card className="flex flex-col items-start gap-3">
        <h1 className="text-section font-medium text-text">{t('notFound.title')}</h1>
        <p className="text-body text-muted">{t('notFound.body')}</p>
        <Link to="/" className={buttonClass('secondary')}>
          {t('common.continue')}
        </Link>
      </Card>
    </AuthLayout>
  );
}
