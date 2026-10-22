import { useAuth, useClerk, useUser } from '@clerk/react';
import { isClerkAPIResponseError } from '@clerk/react/errors';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '../components/PageState';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { TextField } from '../components/ui/Field';
import { Notice } from '../components/ui/Notice';
import { t } from '../i18n';
import { useOrg } from '../lib/org';
import { roleLabel } from '../lib/roles';
import { meKey } from '../lib/session';

/** Clerk's own message for a refused change (English, like its sign-in screens, D-160). */
function clerkMessage(error: unknown) {
  if (isClerkAPIResponseError(error)) {
    const first = error.errors[0];
    if (first) return first.longMessage ?? first.message;
  }
  return t('error.generic');
}

/**
 * The signed-in user's own profile, in the app's design rather than Clerk's: their name, the
 * address they sign in with, and the orgs they belong to. Clerk holds the name; the API copies it
 * from the session token on the next request, so the token is refreshed after saving.
 */
export function ProfilePage() {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const { me } = useOrg();
  const queryClient = useQueryClient();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filled from Clerk when it loads, and again only if the stored name itself changes.
  const storedFirst = user?.firstName ?? '';
  const storedLast = user?.lastName ?? '';
  useEffect(() => {
    setFirstName(storedFirst);
    setLastName(storedLast);
  }, [storedFirst, storedLast]);

  const email = user?.primaryEmailAddress?.emailAddress ?? me.email;
  const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
  const unchanged = firstName.trim() === storedFirst && lastName.trim() === storedLast;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    if (!firstName.trim()) {
      setError(t('profile.firstNameRequired'));
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await user.update({ firstName: firstName.trim(), lastName: lastName.trim() });
      // A fresh token carries the new name, and the next API call stores it (D-161).
      await getToken({ skipCache: true });
      await queryClient.invalidateQueries({ queryKey: meKey });
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      setSaved(true);
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader overline={t('profile.overline')} title={t('profile.title')} />
      <div className="flex max-w-[640px] flex-col gap-4">
        <Card>
          <div className="mb-5 flex items-center gap-4">
            <Avatar name={fullName || null} fallback={email ?? '?'} className="size-12 text-body" />
            <div className="min-w-0">
              <p className="truncate text-section font-medium text-text">
                {fullName || t('profile.noName')}
              </p>
              <p className="truncate text-meta text-muted">{email}</p>
            </div>
          </div>
          <form onSubmit={save} noValidate className="flex flex-col gap-4">
            <h2 className="text-section font-medium text-text">{t('profile.nameTitle')}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label={t('profile.firstName')}
                required
                autoComplete="given-name"
                value={firstName}
                disabled={!isLoaded}
                maxLength={100}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  setSaved(false);
                }}
              />
              <TextField
                label={t('profile.lastName')}
                autoComplete="family-name"
                value={lastName}
                disabled={!isLoaded}
                maxLength={100}
                onChange={(e) => {
                  setLastName(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
            <p className="text-meta text-muted">{t('profile.nameHelper')}</p>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            {saved ? <Notice tone="success">{t('profile.saved')}</Notice> : null}
            <div className="flex justify-end">
              <Button type="submit" loading={saving} disabled={!isLoaded || unchanged}>
                {t('profile.save')}
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className="text-section font-medium text-text">{t('profile.emailTitle')}</h2>
          <p className="mt-3 text-body font-semibold break-all text-text">{email}</p>
          <p className="mt-1 text-meta text-muted">{t('profile.emailHelper')}</p>
        </Card>

        <Card className="p-0 sm:p-0">
          <h2 className="px-4 pt-4 text-section font-medium text-text sm:px-5 sm:pt-5">
            {t('profile.orgsTitle')}
          </h2>
          <ul className="mt-2 divide-y divide-border">
            {me.memberships.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Avatar name={m.org.name} tone="org" />
                <span className="min-w-0 flex-1 truncate text-body font-semibold text-text">
                  {m.org.name}
                </span>
                <Badge tone="brand">{roleLabel(m.role)}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <div>
          <Button
            variant="secondary"
            icon={<LogOut className="size-4" />}
            onClick={() => {
              queryClient.clear();
              void signOut();
            }}
          >
            {t('common.signOut')}
          </Button>
        </div>
      </div>
    </>
  );
}
