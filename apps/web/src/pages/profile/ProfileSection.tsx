import { useUser } from '@clerk/react';
import { Camera } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TextField } from '../../components/ui/Field';
import { Notice } from '../../components/ui/Notice';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { clerkMessage, useRefreshIdentity } from './shared';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Profile: the photo and the name other people see. Both live in Clerk. */
export function ProfileSection({ fallbackEmail }: { fallbackEmail: string | null }) {
  const { user, isLoaded } = useUser();
  const toast = useToast();
  const refreshIdentity = useRefreshIdentity();
  const fileInput = useRef<HTMLInputElement>(null);

  const storedFirst = user?.firstName ?? '';
  const storedLast = user?.lastName ?? '';
  const [firstName, setFirstName] = useState(storedFirst);
  const [lastName, setLastName] = useState(storedLast);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Filled from Clerk when it loads, and again only if the stored name itself changes.
  useEffect(() => {
    setFirstName(storedFirst);
    setLastName(storedLast);
  }, [storedFirst, storedLast]);

  const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
  const unchanged = firstName.trim() === storedFirst && lastName.trim() === storedLast;

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    if (!firstName.trim()) {
      setNameError(t('profile.firstNameRequired'));
      return;
    }
    setSaving(true);
    setNameError(null);
    try {
      await user.update({ firstName: firstName.trim(), lastName: lastName.trim() });
      await refreshIdentity();
      toast(t('profile.saved'));
    } catch (err) {
      setNameError(clerkMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function setPhoto(file: File | null) {
    if (!user) return;
    if (file && !['image/png', 'image/jpeg'].includes(file.type)) {
      setPhotoError(t('profile.photoType'));
      return;
    }
    if (file && file.size > MAX_PHOTO_BYTES) {
      setPhotoError(t('profile.photoTooBig'));
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await user.setProfileImage({ file });
      toast(file ? t('profile.photoSaved') : t('profile.photoRemoved'));
    } catch (err) {
      setPhotoError(clerkMessage(err));
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <Card flush>
      <div className="flex items-start gap-4 border-b border-border p-[18px] md:items-center md:p-[22px]">
        <div className="relative">
          <Avatar
            name={fullName || null}
            fallback={fallbackEmail ?? '?'}
            src={user?.hasImage ? user.imageUrl : null}
            className="size-16 text-section"
          />
          {photoBusy ? (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-white/70">
              <Spinner className="size-5 text-brand" label={t('common.loading')} />
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col items-start">
          <p className="text-label font-semibold text-text">{t('profile.photoTitle')}</p>
          <p className="mt-1 text-meta text-muted">{t('profile.photoHint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="max-md:h-11"
              icon={<Camera className="size-4" />}
              disabled={!isLoaded || photoBusy}
              onClick={() => fileInput.current?.click()}
            >
              {t('profile.photoChange')}
            </Button>
            {user?.hasImage ? (
              <Button
                variant="ghost"
                size="sm"
                className="max-md:h-11"
                disabled={photoBusy}
                onClick={() => void setPhoto(null)}
              >
                {t('profile.photoRemove')}
              </Button>
            ) : null}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            tabIndex={-1}
            aria-label={t('profile.photoChange')}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = '';
              if (file) void setPhoto(file);
            }}
          />
          {photoError ? <p className="mt-2 text-meta text-danger">{photoError}</p> : null}
        </div>
      </div>

      <form onSubmit={saveName} noValidate>
        <div className="grid grid-cols-1 gap-3.5 px-[18px] pt-[18px] pb-1.5 md:grid-cols-2 md:gap-4 md:px-[22px] md:pt-[22px]">
          <TextField
            label={t('profile.firstName')}
            required
            autoComplete="given-name"
            value={firstName}
            disabled={!isLoaded}
            maxLength={100}
            error={nameError === t('profile.firstNameRequired') ? nameError : undefined}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <TextField
            label={t('profile.lastName')}
            autoComplete="family-name"
            value={lastName}
            disabled={!isLoaded}
            maxLength={100}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <p className="mx-[18px] mt-1 mb-[18px] text-meta text-muted md:mx-[22px] md:mb-5">
          {t('profile.nameHelper')}
        </p>
        {nameError && nameError !== t('profile.firstNameRequired') ? (
          <Notice tone="danger" className="mx-[18px] mb-4 md:mx-[22px]">
            {nameError}
          </Notice>
        ) : null}
        <div className="flex justify-end border-t border-border px-[18px] py-3.5 md:px-[22px] md:py-[15px]">
          <Button
            type="submit"
            loading={saving}
            disabled={!isLoaded || unchanged}
            className="max-md:w-full"
          >
            {t('profile.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
