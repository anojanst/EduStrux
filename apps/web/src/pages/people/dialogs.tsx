import type { CreatedInvitation, Family, Guardian, Student } from '@edustrux/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import { orgApiPath, useOrg } from '../../lib/org';
import {
  guardianName,
  peopleKeys,
  useAcademicYears,
  useBranches,
  useGradeLevels,
} from '../../lib/people';
import { Toggle } from './Toggle';

/** After any change in the people area: every list and page that might show it reads again. */
export function useRefreshPeople() {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      peopleKeys(membership.org.id).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
}

/** The message for a failed save: field errors stay on their fields, the rest goes here. */
function saveError(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiError) {
    if (err.status === 400 && Object.keys(err.fields).length) return null;
    if (err.status === 422) return err.message;
    if (err.code === 'stale_data') return t('error.staleData');
  }
  return errorMessage(err);
}

export function FormActions({
  onClose,
  saving,
  label,
  danger = false,
}: {
  onClose: () => void;
  saving: boolean;
  label: string;
  danger?: boolean;
}) {
  return (
    <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="secondary" onClick={onClose} disabled={saving}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={saving}>
        {label}
      </Button>
    </div>
  );
}

/** A save that failed because someone else saved first: say so, and offer to read it again. */
export function StaleOrError({ error, onReload }: { error: unknown; onReload: () => void }) {
  const message = saveError(error);
  if (!message) return null;
  const stale = error instanceof ApiError && error.code === 'stale_data';
  return (
    <Notice
      tone="danger"
      className="mt-4"
      action={
        stale ? (
          <Button variant="secondary" size="sm" onClick={onReload}>
            {t('people.reload')}
          </Button>
        ) : null
      }
    >
      {message}
    </Notice>
  );
}

// ── Family ──────────────────────────────────────────────────────────────────

export function EditFamilyDialog({
  family,
  open,
  onClose,
}: {
  family: Family;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={t('people.editFamily.title')}>
      <EditFamilyForm family={family} onClose={onClose} />
    </Dialog>
  );
}

function EditFamilyForm({ family, onClose }: { family: Family; onClose: () => void }) {
  const { membership } = useOrg();
  const refresh = useRefreshPeople();
  const toast = useToast();
  const branches = useBranches();
  const own = membership.branchIds;
  const choices = (branches.data?.data ?? []).filter(
    (b) => !own || own.includes(b.id) || b.id === family.branchId,
  );
  const [name, setName] = useState(family.name);
  const [branchId, setBranchId] = useState(family.branchId);

  const save = useMutation({
    mutationFn: () =>
      api<Family>('PATCH', orgApiPath(membership, `/families/${family.id}`), {
        body: {
          updatedAt: family.updatedAt,
          name: name.trim(),
          ...(branchId !== family.branchId ? { branchId } : {}),
        },
      }),
    onSuccess: async () => {
      await refresh();
      toast(t('people.saved'));
      onClose();
    },
  });
  const errors = fieldErrors(save.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextField
        label={t('people.form.familyName')}
        required
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />
      {choices.length > 1 ? (
        <SelectField
          label={t('people.form.branch')}
          required
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          options={choices.map((b) => ({ value: b.id, label: b.name }))}
          helper={t('people.form.branchHelp')}
          error={errors.branchId}
        />
      ) : null}
      <StaleOrError
        error={save.error}
        onReload={() => {
          void refresh();
          onClose();
        }}
      />
      <FormActions onClose={onClose} saving={save.isPending} label={t('people.save')} />
    </form>
  );
}

/** Delete a family: only once it has no students (the API refuses otherwise, D-057). */
export function DeleteFamilyDialog({
  family,
  open,
  onClose,
  onDeleted,
}: {
  family: Family;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { membership } = useOrg();
  const refresh = useRefreshPeople();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: () => api<void>('DELETE', orgApiPath(membership, `/families/${family.id}`)),
    onSuccess: async () => {
      toast(t('people.deleteFamily.done', { name: family.name }));
      onDeleted();
      await refresh();
    },
  });
  const blocked = family.students.length > 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('people.deleteFamily.title', { name: family.name })}
      actions={
        blocked ? (
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={remove.isPending}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              {t('people.deleteFamily.action')}
            </Button>
          </>
        )
      }
    >
      <p className="text-body text-text">
        {!blocked
          ? t('people.deleteFamily.body')
          : family.students.length === 1
            ? t('people.deleteFamily.blockedOne')
            : t('people.deleteFamily.blocked', { n: family.students.length })}
      </p>
      <StaleOrError error={remove.error} onReload={onClose} />
    </Dialog>
  );
}

/**
 * Erase a family's personal data (D-155): owner only and irreversible, so the family's name must
 * be typed to confirm.
 */
export function EraseFamilyDialog({
  family,
  open,
  onClose,
}: {
  family: Family;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={t('people.erase.title')}>
      <EraseForm family={family} onClose={onClose} />
    </Dialog>
  );
}

function EraseForm({ family, onClose }: { family: Family; onClose: () => void }) {
  const { membership } = useOrg();
  const refresh = useRefreshPeople();
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const erase = useMutation({
    mutationFn: () => api('POST', orgApiPath(membership, `/families/${family.id}/erase`)),
    onSuccess: async () => {
      await refresh();
      toast(t('people.erase.done'));
      onClose();
    },
  });
  const matches = typed.trim().toLowerCase() === family.name.trim().toLowerCase();
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (matches) erase.mutate();
      }}
    >
      <p className="text-body text-text">{t('people.erase.body')}</p>
      <p className="mt-2 text-body font-semibold text-danger">{t('people.erase.final')}</p>
      <div className="mt-4">
        <TextField
          label={t('people.erase.type', { name: family.name })}
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      <StaleOrError error={erase.error} onReload={onClose} />
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={erase.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="danger" disabled={!matches} loading={erase.isPending}>
          {t('people.erase.action')}
        </Button>
      </div>
    </form>
  );
}

// ── Guardians ───────────────────────────────────────────────────────────────

/** Add a guardian to a family, or edit one (`guardian` given). */
export function GuardianDialog({
  familyId,
  guardian,
  open,
  onClose,
}: {
  familyId: string;
  guardian?: Guardian;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={guardian ? t('people.guardian.editTitle') : t('people.guardian.addTitle')}
      wide
    >
      <GuardianForm familyId={familyId} guardian={guardian} onClose={onClose} />
    </Dialog>
  );
}

function GuardianForm({
  familyId,
  guardian,
  onClose,
}: {
  familyId: string;
  guardian?: Guardian;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const refresh = useRefreshPeople();
  const toast = useToast();
  const [form, setForm] = useState({
    firstName: guardian?.firstName ?? '',
    lastName: guardian?.lastName ?? '',
    email: guardian?.email ?? '',
    phone: guardian?.phone ?? '',
    emergencyContact: guardian?.emergencyContact ?? true,
  });

  const save = useMutation({
    mutationFn: () => {
      const fields = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        emergencyContact: form.emergencyContact,
      };
      return guardian
        ? api<Guardian>('PATCH', orgApiPath(membership, `/guardians/${guardian.id}`), {
            body: { updatedAt: guardian.updatedAt, ...fields },
          })
        : api<Guardian>('POST', orgApiPath(membership, `/families/${familyId}/guardians`), {
            body: Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)),
          });
    },
    onSuccess: async (saved) => {
      await refresh();
      toast(
        guardian ? t('people.saved') : t('people.guardian.added', { name: guardianName(saved) }),
      );
      onClose();
    },
  });
  const errors = fieldErrors(save.error);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label={t('people.form.firstName')}
          required
          autoFocus
          value={form.firstName}
          maxLength={80}
          onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          error={errors.firstName}
        />
        <TextField
          label={t('people.form.lastName')}
          required
          value={form.lastName}
          maxLength={80}
          onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          error={errors.lastName}
        />
        <TextField
          label={t('people.form.email')}
          type="email"
          autoComplete="off"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          error={errors.email}
        />
        <TextField
          label={t('people.form.phone')}
          type="tel"
          autoComplete="off"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          error={errors.phone}
        />
        <Toggle
          checked={form.emergencyContact}
          onChange={(on) => setForm({ ...form, emergencyContact: on })}
          label={t('people.form.emergency')}
          hint={t('people.form.emergencyHint')}
        />
      </div>
      <StaleOrError
        error={save.error}
        onReload={() => {
          void refresh();
          onClose();
        }}
      />
      <FormActions
        onClose={onClose}
        saving={save.isPending}
        label={guardian ? t('people.save') : t('people.guardian.add')}
      />
    </form>
  );
}

/** A plain "are you sure" for a change that can be undone by hand but not by a button. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  action,
  onConfirm,
  variant = 'danger',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  action: string;
  onConfirm: () => Promise<unknown>;
  /** `primary` for a confirm that isn't destructive, such as issuing an invoice. */
  variant?: 'danger' | 'primary';
}) {
  const run = useMutation({ mutationFn: onConfirm, onSuccess: onClose });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant={variant} loading={run.isPending} onClick={() => run.mutate()}>
            {action}
          </Button>
        </>
      }
    >
      <div className="text-body text-text">{body}</div>
      <StaleOrError error={run.error} onReload={onClose} />
    </Dialog>
  );
}

/**
 * Invite a guardian to the parent portal (D-131): to their email unless another is typed. The
 * link is shown to copy too, since invite emails may not be set up yet.
 */
export function InviteGuardianDialog({
  guardian,
  open,
  onClose,
  onSent,
}: {
  guardian: Guardian;
  open: boolean;
  onClose: () => void;
  onSent: (guardianId: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={t('people.invite.title')}>
      <InviteForm guardian={guardian} onClose={onClose} onSent={onSent} />
    </Dialog>
  );
}

function InviteForm({
  guardian,
  onClose,
  onSent,
}: {
  guardian: Guardian;
  onClose: () => void;
  onSent: (guardianId: string) => void;
}) {
  const { membership } = useOrg();
  const [email, setEmail] = useState(guardian.email ?? '');
  const invite = useMutation({
    mutationFn: () =>
      api<CreatedInvitation>(
        'POST',
        orgApiPath(membership, `/guardians/${guardian.id}/invitation`),
        { body: email.trim() && email.trim() !== guardian.email ? { email: email.trim() } : {} },
      ),
    onSuccess: () => onSent(guardian.id),
  });

  if (invite.data) {
    const link = `${window.location.origin}/invitations/${invite.data.token}`;
    return (
      <>
        <Notice tone="success" title={t('people.invite.sentTitle', { name: guardian.firstName })}>
          {t('people.invite.sentBody', { email: invite.data.invitation.email })}
        </Notice>
        <CopyLink link={link} />
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>{t('common.done')}</Button>
        </div>
      </>
    );
  }

  const errors = fieldErrors(invite.error);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        invite.mutate();
      }}
    >
      <p className="mb-4 text-body text-text">
        {t('people.invite.body', { name: guardian.firstName })}
      </p>
      <TextField
        label={t('people.form.email')}
        required
        type="email"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
      />
      <StaleOrError error={invite.error} onReload={onClose} />
      <FormActions onClose={onClose} saving={invite.isPending} label={t('people.invite.send')} />
    </form>
  );
}

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
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
    </>
  );
}

// ── Students ────────────────────────────────────────────────────────────────

/** Add a student to a family, or edit one (`student` given). Notes have their own dialog. */
export function StudentDialog({
  family,
  student,
  open,
  onClose,
}: {
  family: Pick<Family, 'id' | 'name'>;
  student?: Student;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={student ? t('people.student.editTitle') : t('people.student.addTitle')}
      wide
    >
      <StudentForm family={family} student={student} onClose={onClose} />
    </Dialog>
  );
}

function StudentForm({
  family,
  student,
  onClose,
}: {
  family: Pick<Family, 'id' | 'name'>;
  student?: Student;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const refresh = useRefreshPeople();
  const toast = useToast();
  const grades = useGradeLevels();
  const years = useAcademicYears();
  const askGrade = (grades.data?.data.length ?? 0) > 0 && (years.data?.data.length ?? 0) > 0;
  const [form, setForm] = useState({
    firstName: student?.firstName ?? '',
    lastName: student?.lastName ?? family.name,
    gradeLevelId: student?.gradeLevelId ?? '',
  });

  const save = useMutation({
    mutationFn: () => {
      const gradeChanged = form.gradeLevelId !== (student?.gradeLevelId ?? '');
      if (student) {
        return api<Student>('PATCH', orgApiPath(membership, `/students/${student.id}`), {
          body: {
            updatedAt: student.updatedAt,
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            ...(gradeChanged ? { gradeLevelId: form.gradeLevelId || null } : {}),
          },
        });
      }
      return api<Student>('POST', orgApiPath(membership, '/students'), {
        body: {
          familyId: family.id,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          gradeLevelId: form.gradeLevelId || undefined,
        },
      });
    },
    onSuccess: async (saved) => {
      await refresh();
      toast(
        student
          ? t('people.saved')
          : t('people.student.added', { name: `${saved.firstName} ${saved.lastName}` }),
      );
      onClose();
    },
  });
  const errors = fieldErrors(save.error);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label={t('people.form.firstName')}
          required
          autoFocus
          value={form.firstName}
          maxLength={80}
          onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          error={errors.firstName}
        />
        <TextField
          label={t('people.form.lastName')}
          required
          value={form.lastName}
          maxLength={80}
          onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          error={errors.lastName}
        />
        {askGrade ? (
          <SelectField
            label={t('people.form.grade')}
            value={form.gradeLevelId}
            onChange={(e) => setForm({ ...form, gradeLevelId: e.target.value })}
            options={[
              { value: '', label: t('people.form.noGrade') },
              ...grades.data!.data.map((g) => ({ value: g.id, label: g.name })),
            ]}
            helper={t('people.form.gradeHelp')}
            error={errors.gradeLevelId}
          />
        ) : null}
      </div>
      <StaleOrError
        error={save.error}
        onReload={() => {
          void refresh();
          onClose();
        }}
      />
      <FormActions
        onClose={onClose}
        saving={save.isPending}
        label={student ? t('people.save') : t('people.student.add')}
      />
    </form>
  );
}
