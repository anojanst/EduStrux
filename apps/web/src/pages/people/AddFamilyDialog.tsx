import type { DuplicateMatches, Family, Guardian, Student } from '@edustrux/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UsersRound } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
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
  namesOf,
  peopleKeys,
  query,
  useAcademicYears,
  useBranches,
  useGradeLevels,
  usePeoplePaths,
} from '../../lib/people';
import { Toggle } from './Toggle';

type StudentDraft = {
  key: number;
  firstName: string;
  /** null follows the family name until it's typed over. */
  lastName: string | null;
  gradeLevelId: string;
};

const blankStudent = (key: number): StudentDraft => ({
  key,
  firstName: '',
  lastName: null,
  gradeLevelId: '',
});

/** What the family page shows after it's added: who to invite, and anything that didn't save. */
export type AddedState = { added: { invite: string | null; problems: string[] } };

function useDebounced<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Add family: the family, its first guardian and its students in one form (TUI-109). Before
 * saving it asks the API for records that look the same (D-132). The family is added first, then
 * the guardian and the students; one of those failing still leaves the family, and the family
 * page says what didn't save.
 */
export function AddFamilyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('people.add.title')}
      subtitle={t('people.add.subtitle')}
      wide
    >
      <AddFamilyForm onClose={onClose} />
    </Dialog>
  );
}

function AddFamilyForm({ onClose }: { onClose: () => void }) {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const paths = usePeoplePaths();

  const branches = useBranches();
  const grades = useGradeLevels();
  const years = useAcademicYears();
  const own = membership.branchIds;
  const branchChoices = (branches.data?.data ?? []).filter((b) => !own || own.includes(b.id));
  const branchName = namesOf(branches.data?.data);
  const askGrade = (grades.data?.data.length ?? 0) > 0 && (years.data?.data.length ?? 0) > 0;

  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [guardian, setGuardian] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    emergencyContact: true,
  });
  const [students, setStudents] = useState<StudentDraft[]>([blankStudent(0)]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);

  // One branch to choose from: it's the family's, without asking.
  const onlyBranch = branchChoices.length === 1 ? branchChoices[0]!.id : null;
  const homeBranch = onlyBranch ?? branchId;

  const familyName = useDebounced(name.trim(), 400);
  const contact = useDebounced({ email: guardian.email.trim(), phone: guardian.phone.trim() }, 400);
  const familyMatches = useQuery({
    queryKey: ['duplicates', membership.org.id, 'family', familyName],
    queryFn: ({ signal }) =>
      api<DuplicateMatches>(
        'GET',
        orgApiPath(membership, `/search/duplicates${query({ kind: 'family', name: familyName })}`),
        { signal },
      ),
    enabled: familyName.length >= 2,
  });
  const guardianMatches = useQuery({
    queryKey: ['duplicates', membership.org.id, 'guardian', contact.email, contact.phone],
    queryFn: ({ signal }) =>
      api<DuplicateMatches>(
        'GET',
        orgApiPath(
          membership,
          `/search/duplicates${query({ kind: 'guardian', email: contact.email.includes('@') ? contact.email : '', phone: contact.phone.length >= 6 ? contact.phone : '' })}`,
        ),
        { signal },
      ),
    enabled: contact.email.includes('@') || contact.phone.length >= 6,
  });
  const sameFamily = familyMatches.data?.families.find((f) => !dismissed.includes(f.id));
  const sameGuardian = guardianMatches.data?.guardians.find((g) => !dismissed.includes(g.id));

  const form = useRef<HTMLFormElement>(null);
  // ui-design.md §8: errors move focus to the first one, once they're drawn.
  const focusFirstError = () =>
    requestAnimationFrame(() =>
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    );

  const lastNameOf = (s: StudentDraft) => s.lastName ?? name.trim();
  const isBlank = (s: StudentDraft) => !s.firstName.trim() && !s.gradeLevelId;

  function updateStudent(key: number, change: Partial<StudentDraft>) {
    setStudents((list) => list.map((s) => (s.key === key ? { ...s, ...change } : s)));
  }

  function check() {
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = t('people.add.nameRequired');
    if (!homeBranch) found.branchId = t('people.add.branchRequired');
    if (!guardian.firstName.trim()) found['guardian.firstName'] = t('people.form.required');
    if (!guardian.lastName.trim()) found['guardian.lastName'] = t('people.form.required');
    students.forEach((s, i) => {
      if (isBlank(s) && i === 0 && students.length === 1) return;
      if (!s.firstName.trim()) found[`students.${i}.firstName`] = t('people.form.required');
      if (!lastNameOf(s).trim()) found[`students.${i}.lastName`] = t('people.form.required');
    });
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = check();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) {
      focusFirstError();
      return;
    }
    setSaving(true);

    let family: Family;
    try {
      family = await api<Family>('POST', orgApiPath(membership, '/families'), {
        body: { name: name.trim(), branchId: homeBranch },
      });
    } catch (err) {
      setSaving(false);
      const fields = fieldErrors(err);
      if (Object.keys(fields).length) {
        setErrors(fields);
        focusFirstError();
      } else
        setFormError(
          err instanceof ApiError && err.status === 403
            ? t('people.add.branchForbidden')
            : err instanceof ApiError && err.status === 422
              ? err.message
              : errorMessage(err),
        );
      return;
    }

    const problems: string[] = [];
    let invite: string | null = null;
    const person = `${guardian.firstName.trim()} ${guardian.lastName.trim()}`;
    try {
      const added = await api<Guardian>(
        'POST',
        orgApiPath(membership, `/families/${family.id}/guardians`),
        {
          body: {
            firstName: guardian.firstName.trim(),
            lastName: guardian.lastName.trim(),
            email: guardian.email.trim() || undefined,
            phone: guardian.phone.trim() || undefined,
            emergencyContact: guardian.emergencyContact,
          },
        },
      );
      if (added.email) invite = added.id;
    } catch (err) {
      problems.push(t('people.add.notSaved', { name: person, reason: reasonOf(err) }));
    }
    for (const s of students.filter((s, i) => !(isBlank(s) && i === 0 && students.length === 1))) {
      const student = `${s.firstName.trim()} ${lastNameOf(s).trim()}`;
      try {
        await api<Student>('POST', orgApiPath(membership, '/students'), {
          body: {
            familyId: family.id,
            firstName: s.firstName.trim(),
            lastName: lastNameOf(s).trim(),
            gradeLevelId: s.gradeLevelId || undefined,
          },
        });
      } catch (err) {
        problems.push(t('people.add.notSaved', { name: student, reason: reasonOf(err) }));
      }
    }

    for (const key of peopleKeys(membership.org.id)) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
    toast(t('people.add.done', { name: family.name }));
    onClose();
    navigate(paths.family(family.id), {
      state: { added: { invite, problems } } satisfies AddedState,
    });
  }

  return (
    <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <h3 className="text-label font-semibold text-text">{t('people.add.family')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t('people.form.familyName')}
            required
            autoFocus
            value={name}
            maxLength={120}
            helper={t('people.form.familyNameHelp')}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
          />
          {onlyBranch ? null : (
            <SelectField
              label={t('people.form.branch')}
              required
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              options={[
                { value: '', label: t('people.form.chooseBranch') },
                ...branchChoices.map((b) => ({ value: b.id, label: b.name })),
              ]}
              error={errors.branchId}
            />
          )}
        </div>
        {sameFamily ? (
          <Notice
            tone="warning"
            title={t('people.dup.familyTitle')}
            action={
              <div className="flex flex-col gap-1.5 sm:flex-row">
                <Link
                  to={paths.family(sameFamily.id)}
                  onClick={onClose}
                  className="inline-flex h-9 items-center rounded-lg border border-[#e5ca8b] bg-[#fffdf8] px-3 text-label font-medium text-[#775218]"
                >
                  {t('people.dup.open')}
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => setDismissed((list) => [...list, sameFamily.id])}
                >
                  {t('people.dup.different')}
                </Button>
              </div>
            }
          >
            {[
              t('people.familyName', { name: sameFamily.name }),
              branchChoices.length > 1 || (branches.data?.data.length ?? 0) > 1
                ? branchName(sameFamily.branchId)
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Notice>
        ) : null}
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-5">
        <h3 className="text-label font-semibold text-text">{t('people.add.guardian')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t('people.form.firstName')}
            required
            value={guardian.firstName}
            maxLength={80}
            onChange={(e) => setGuardian({ ...guardian, firstName: e.target.value })}
            error={errors['guardian.firstName']}
          />
          <TextField
            label={t('people.form.lastName')}
            required
            value={guardian.lastName}
            maxLength={80}
            onChange={(e) => setGuardian({ ...guardian, lastName: e.target.value })}
            error={errors['guardian.lastName']}
          />
          <TextField
            label={t('people.form.email')}
            type="email"
            autoComplete="off"
            value={guardian.email}
            onChange={(e) => setGuardian({ ...guardian, email: e.target.value })}
          />
          <TextField
            label={t('people.form.phone')}
            type="tel"
            autoComplete="off"
            value={guardian.phone}
            onChange={(e) => setGuardian({ ...guardian, phone: e.target.value })}
          />
          <Toggle
            checked={guardian.emergencyContact}
            onChange={(on) => setGuardian({ ...guardian, emergencyContact: on })}
            label={t('people.form.emergency')}
            hint={t('people.form.emergencyHint')}
          />
        </div>
        {sameGuardian ? (
          <Notice
            tone="warning"
            title={t('people.dup.guardianTitle', {
              name: `${sameGuardian.firstName} ${sameGuardian.lastName}`,
              family: sameGuardian.familyName,
            })}
            action={
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => setDismissed((list) => [...list, sameGuardian.id])}
              >
                {t('common.dismiss')}
              </Button>
            }
          >
            <Link
              to={paths.family(sameGuardian.familyId)}
              onClick={onClose}
              className="font-medium text-brand underline"
            >
              {t('people.dup.open')}
            </Link>
          </Notice>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-label font-semibold text-text">{t('people.add.students')}</h3>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() =>
              setStudents((list) => [
                ...list,
                blankStudent(Math.max(...list.map((s) => s.key)) + 1),
              ])
            }
          >
            {t('people.add.anotherStudent')}
          </Button>
        </div>
        {students.map((s, i) => (
          <fieldset key={s.key} className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <legend className="contents">
                <b className="text-label font-semibold text-text">
                  {t('people.add.studentN', { n: i + 1 })}
                </b>
              </legend>
              {students.length > 1 ? (
                <button
                  type="button"
                  className="text-label font-medium text-danger hover:underline"
                  onClick={() => setStudents((list) => list.filter((x) => x.key !== s.key))}
                >
                  {t('people.add.removeStudent', { n: i + 1 })}
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label={t('people.form.firstName')}
                required={i > 0 || !isBlank(s)}
                value={s.firstName}
                maxLength={80}
                onChange={(e) => updateStudent(s.key, { firstName: e.target.value })}
                error={errors[`students.${i}.firstName`]}
              />
              <TextField
                label={t('people.form.lastName')}
                required={i > 0 || !isBlank(s)}
                value={lastNameOf(s)}
                maxLength={80}
                onChange={(e) => updateStudent(s.key, { lastName: e.target.value })}
                error={errors[`students.${i}.lastName`]}
              />
              {askGrade ? (
                <SelectField
                  label={t('people.form.grade')}
                  value={s.gradeLevelId}
                  onChange={(e) => updateStudent(s.key, { gradeLevelId: e.target.value })}
                  options={[
                    { value: '', label: t('people.form.noGrade') },
                    ...grades.data!.data.map((g) => ({ value: g.id, label: g.name })),
                  ]}
                />
              ) : null}
            </div>
          </fieldset>
        ))}
        {students.length === 1 ? (
          <p className="text-meta text-muted">{t('people.add.studentsOptional')}</p>
        ) : null}
      </section>

      {formError ? <Notice tone="danger">{formError}</Notice> : null}
      <div className="sticky -bottom-5 -mx-[18px] -mb-5 flex flex-col-reverse gap-2 border-t border-border bg-surface px-[18px] pt-3.5 pb-[calc(14px+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end md:-bottom-[22px] md:-mx-[22px] md:-mb-[22px] md:px-[22px] md:pb-3.5">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={saving} icon={<UsersRound className="size-4" />}>
          {t('people.addFamily')}
        </Button>
      </div>
    </form>
  );
}

function reasonOf(err: unknown) {
  if (err instanceof ApiError && (err.status === 400 || err.status === 422)) {
    const first = Object.values(err.fields)[0]?.[0];
    return first ?? err.message;
  }
  return errorMessage(err);
}
