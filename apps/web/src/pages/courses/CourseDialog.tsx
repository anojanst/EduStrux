import type { Course, GradeLevel, Subject } from '@edustrux/shared';
import { fromMinorUnits, toMinorUnits } from '@edustrux/shared/money';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, SelectField, TextField } from '../../components/ui/Field';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useCourseLabel, useRefreshCurriculum, useSubjects } from '../../lib/classes';
import { orgApiPath, useOrg } from '../../lib/org';
import { useGradeLevels } from '../../lib/people';
import { can } from '../../lib/roles';

/** The select's choice that opens a field for typing a new subject or grade level. */
const NEW = 'new';

/**
 * A failed step of saving a course, with its field errors moved under the step's name
 * ("subject.name"), so they show on that step's field.
 */
async function step<T>(prefix: string, run: Promise<T>): Promise<T> {
  try {
    return await run;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    const fields = Object.fromEntries(
      Object.entries(err.fields).map(([key, messages]) => [`${prefix}.${key}`, messages]),
    );
    throw new ApiError(err.status, err.code, err.message, fields);
  }
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A failed save's message, unless every error sits on a field. */
function saveError(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiError) {
    if (err.status === 400 && Object.keys(err.fields).length) return null;
    if (err.status === 409 || err.status === 422) return err.message;
  }
  return errorMessage(err);
}

/**
 * Add a course, or edit one (TUI-113). A course is a subject at a grade level; the owner can
 * type in a subject or grade level that isn't there yet, and only the owner sets the default
 * price (D-111). A course keeps its subject and grade level once made.
 */
export function CourseDialog({
  open,
  onClose,
  course,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  course?: Course;
  onSaved?: (course: Course) => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={course ? t('courses.edit.title') : t('courses.add.title')}
      subtitle={course ? undefined : t('courses.add.subtitle')}
    >
      <CourseForm course={course} onClose={onClose} onSaved={onSaved} />
    </Dialog>
  );
}

function CourseForm({
  course,
  onClose,
  onSaved,
}: {
  course?: Course;
  onClose: () => void;
  onSaved?: (course: Course) => void;
}) {
  const { membership, org } = useOrg();
  const toast = useToast();
  const refresh = useRefreshCurriculum();
  const courseLabel = useCourseLabel();
  const subjects = useSubjects();
  const grades = useGradeLevels();
  const subjectList = subjects.data?.data ?? [];
  const gradeList = grades.data?.data ?? [];
  const canAddNames = can(membership.role, 'org:write');
  const setsPrice = membership.role === 'owner';
  const currency = org?.currency ?? course?.defaultPrice?.currency ?? '';

  const [subjectId, setSubjectId] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [gradeName, setGradeName] = useState('');
  const [curriculum, setCurriculum] = useState(course?.curriculum ?? '');
  const [medium, setMedium] = useState(course?.teachingMedium ?? '');
  const [minutes, setMinutes] = useState(
    course ? (course.durationMinutes?.toString() ?? '') : '60',
  );
  const [price, setPrice] = useState(
    course?.defaultPrice
      ? fromMinorUnits(course.defaultPrice.amount, course.defaultPrice.currency)
      : '',
  );
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  // With nothing to choose from, the owner types the first one in.
  const subjectChoice = subjectId || (canAddNames && subjectList.length === 0 ? NEW : '');
  const gradeChoice = gradeId || (canAddNames && gradeList.length === 0 ? NEW : '');
  const loaded = subjects.isSuccess && grades.isSuccess;
  const stuck =
    !course && loaded && !canAddNames && (subjectList.length === 0 || gradeList.length === 0);

  /** A subject or grade level by id, else the one of that name, else a new one. */
  async function resolve(
    choice: string,
    name: string,
    list: { id: string; name: string }[],
    prefix: string,
    path: string,
  ) {
    if (choice !== NEW) return choice;
    const existing = list.find((item) => sameName(item.name, name));
    if (existing) return existing.id;
    const made = await step(
      prefix,
      api<Subject | GradeLevel>('POST', orgApiPath(membership, path), {
        body: { name: name.trim() },
      }),
    );
    return made.id;
  }

  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        curriculum: curriculum.trim() || null,
        teachingMedium: medium.trim() || null,
        durationMinutes: minutes ? Number(minutes) : null,
        // Only the owner sends a price; others leave it as it is.
        ...(setsPrice
          ? {
              defaultPrice: price.trim()
                ? { amount: toMinorUnits(price, currency), currency }
                : null,
            }
          : {}),
      };
      if (course) {
        return api<Course>('PATCH', orgApiPath(membership, `/courses/${course.id}`), {
          body: { updatedAt: course.updatedAt, ...fields },
        });
      }
      const subject = await resolve(
        subjectChoice,
        subjectName,
        subjectList,
        'subject',
        '/subjects',
      );
      const grade = await resolve(gradeChoice, gradeName, gradeList, 'grade', '/grade-levels');
      return api<Course>('POST', orgApiPath(membership, '/courses'), {
        body: { subjectId: subject, gradeLevelId: grade, ...fields },
      });
    },
    onSuccess: async (saved) => {
      await refresh();
      toast(course ? t('courses.saved') : t('courses.added'));
      onSaved?.(saved);
      onClose();
    },
    // A subject or grade level made before a course that failed is kept: the lists show it.
    onError: () => void refresh(),
  });

  const errors = { ...fieldErrors(save.error), ...localErrors };
  const message = saveError(save.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!course) {
      if (!subjectChoice) local.subjectId = t('courses.error.required');
      else if (subjectChoice === NEW && !subjectName.trim())
        local['subject.name'] = t('courses.error.required');
      if (!gradeChoice) local.gradeLevelId = t('courses.error.required');
      else if (gradeChoice === NEW && !gradeName.trim())
        local['grade.name'] = t('courses.error.required');
    }
    const length = Number(minutes);
    if (minutes && (!Number.isInteger(length) || length < 5 || length > 600))
      local.durationMinutes = t('courses.error.lessonLength');
    if (setsPrice && price.trim()) {
      try {
        if (toMinorUnits(price, currency) < 0) local.defaultPrice = t('courses.error.price');
      } catch {
        local.defaultPrice = t('courses.error.price');
      }
    }
    setLocalErrors(local);
    if (Object.keys(local).length === 0) save.mutate();
  }

  // Teachers and parents don't get here; other staff read the price but don't set it.
  const readPrice = course?.defaultPrice
    ? fromMinorUnits(course.defaultPrice.amount, course.defaultPrice.currency)
    : t('courses.noPrice');

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {stuck ? <Notice tone="warning">{t('courses.ownerOnlyNames')}</Notice> : null}

      {course ? (
        <ReadOnly label={t('courses.field.course')} value={courseLabel(course.id)} />
      ) : (
        <>
          <NamePicker
            label={t('courses.field.subject')}
            newLabel={t('courses.field.newSubject')}
            typeLabel={t('courses.field.subjectName')}
            placeholder={t('courses.field.subjectPlaceholder')}
            list={subjectList}
            choice={subjectChoice}
            name={subjectName}
            canAdd={canAddNames}
            error={errors.subjectId}
            nameError={errors['subject.name']}
            onChoose={setSubjectId}
            onName={setSubjectName}
          />
          <NamePicker
            label={t('courses.field.grade')}
            newLabel={t('courses.field.newGrade')}
            typeLabel={t('courses.field.gradeName')}
            placeholder={t('courses.field.gradePlaceholder')}
            list={gradeList}
            choice={gradeChoice}
            name={gradeName}
            canAdd={canAddNames}
            error={errors.gradeLevelId}
            nameError={errors['grade.name']}
            onChoose={setGradeId}
            onName={setGradeName}
          />
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t('courses.field.curriculum')}
          value={curriculum}
          maxLength={60}
          placeholder={t('courses.field.curriculumPlaceholder')}
          error={errors.curriculum}
          onChange={(e) => setCurriculum(e.target.value)}
        />
        <TextField
          label={t('courses.field.medium')}
          value={medium}
          maxLength={60}
          placeholder={t('courses.field.mediumPlaceholder')}
          error={errors.teachingMedium}
          onChange={(e) => setMedium(e.target.value)}
        />
      </div>
      <TextField
        label={t('courses.field.lessonLength')}
        type="number"
        inputMode="numeric"
        min={5}
        max={600}
        value={minutes}
        error={errors.durationMinutes}
        helper={t('courses.field.lessonLengthHelp')}
        onChange={(e) => setMinutes(e.target.value)}
      />
      {setsPrice ? (
        <Field
          label={t('courses.field.price')}
          error={errors.defaultPrice ?? errors['defaultPrice.amount']}
          helper={t('courses.field.priceHelp')}
        >
          {({ className, ...props }) => (
            <div className="flex">
              <span className="flex items-center rounded-l-lg border border-r-0 border-border-strong bg-canvas px-3 text-label font-semibold text-muted">
                {currency}
              </span>
              <input
                {...props}
                inputMode="decimal"
                value={price}
                placeholder="0.00"
                onChange={(e) => setPrice(e.target.value)}
                className={cn(className, 'rounded-l-none')}
              />
            </div>
          )}
        </Field>
      ) : course ? (
        <ReadOnly
          label={t('courses.field.price')}
          value={course.defaultPrice ? `${currency} ${readPrice}` : readPrice}
          helper={t('courses.field.priceOwnerOnly')}
        />
      ) : null}

      {message ? <Notice tone="danger">{message}</Notice> : null}

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={save.isPending} disabled={stuck}>
          {course ? t('courses.save') : t('courses.add')}
        </Button>
      </div>
    </form>
  );
}

/**
 * A subject or grade level: chosen from the list, or typed in when it's new, by those who may
 * add them. With an empty list the owner gets only the field to type in.
 */
function NamePicker({
  label,
  newLabel,
  typeLabel,
  placeholder,
  list,
  choice,
  name,
  canAdd,
  error,
  nameError,
  onChoose,
  onName,
}: {
  label: string;
  newLabel: string;
  typeLabel: string;
  placeholder: string;
  list: { id: string; name: string }[];
  choice: string;
  name: string;
  canAdd: boolean;
  error?: string;
  nameError?: string;
  onChoose: (id: string) => void;
  onName: (name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {list.length > 0 || !canAdd ? (
        <SelectField
          label={label}
          required
          value={choice}
          error={error}
          onChange={(e) => onChoose(e.target.value)}
          options={[
            { value: '', label: t('courses.field.choose') },
            ...list.map((item) => ({ value: item.id, label: item.name })),
            ...(canAdd ? [{ value: NEW, label: newLabel }] : []),
          ]}
        />
      ) : null}
      {choice === NEW ? (
        <TextField
          label={list.length ? typeLabel : label}
          required
          maxLength={120}
          value={name}
          placeholder={placeholder}
          error={nameError}
          onChange={(e) => {
            onChoose(NEW);
            onName(e.target.value);
          }}
        />
      ) : null}
    </div>
  );
}

export function ReadOnly({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label font-medium text-text">{label}</span>
      <span className="flex h-11 items-center rounded-lg bg-canvas px-3 text-body text-text sm:h-10">
        {value}
      </span>
      {helper ? <span className="text-meta text-muted">{helper}</span> : null}
    </div>
  );
}
