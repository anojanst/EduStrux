import type { Class, ScheduleResult, ScheduleSlot } from '@edustrux/shared';
import { MAX_SCHEDULE_SLOTS } from '@edustrux/shared';
import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import {
  currentTerm,
  useClassPaths,
  useCourseLabel,
  useCourses,
  useRefreshClasses,
  useRooms,
  useTeachers,
  useTerms,
} from '../../lib/classes';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { useBranches } from '../../lib/people';
import { can } from '../../lib/roles';
import { CourseDialog } from '../courses/CourseDialog';
import { Toggle } from '../people/Toggle';

/** A weekly slot being typed: times as the inputs hold them. */
type SlotDraft = { weekday: string; startTime: string; endTime: string };

const toDraft = (slot: ScheduleSlot): SlotDraft => ({
  weekday: String(slot.weekday),
  startTime: slot.startTime,
  endTime: slot.endTime,
});

/** "16:00" plus minutes, kept inside the day. */
function plusMinutes(time: string, minutes: number) {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Errors in the slots before anything is sent: an end at or before its start, by row. */
function slotErrors(slots: SlotDraft[]) {
  const errors: Record<string, string> = {};
  slots.forEach((slot, i) => {
    if (!slot.startTime) errors[`slots.${i}.startTime`] = t('classes.error.required');
    else if (!slot.endTime) errors[`slots.${i}.endTime`] = t('classes.error.required');
    else if (slot.endTime <= slot.startTime)
      errors[`slots.${i}.endTime`] = t('classes.error.endTime');
  });
  return errors;
}

const toSlots = (slots: SlotDraft[]) =>
  slots.map((slot) => ({
    weekday: Number(slot.weekday),
    startTime: slot.startTime,
    endTime: slot.endTime,
  }));

/** The rows of a weekly schedule: weekday, start and end, and a button to remove each. */
export function ScheduleRows({
  slots,
  onChange,
  errors,
  lessonMinutes,
}: {
  slots: SlotDraft[];
  onChange: (slots: SlotDraft[]) => void;
  errors: Record<string, string>;
  lessonMinutes: number | null;
}) {
  const format = useFormat();
  const set = (i: number, patch: Partial<SlotDraft>) =>
    onChange(slots.map((slot, j) => (j === i ? { ...slot, ...patch } : slot)));

  return (
    <div className="flex flex-col gap-3">
      {slots.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong px-4 py-3 text-body text-muted">
          {t('classes.schedule.none')}
        </p>
      ) : null}
      {slots.map((slot, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_1fr_auto] items-start gap-3 rounded-lg border border-border bg-canvas/60 p-3 sm:grid-cols-[1.2fr_1fr_1fr_auto]"
        >
          <div className="col-span-3 sm:col-span-1">
            <SelectField
              label={t('classes.schedule.weekday')}
              value={slot.weekday}
              onChange={(e) => set(i, { weekday: e.target.value })}
              options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({
                value: String(d),
                label: format.weekdayLong(d),
              }))}
            />
          </div>
          <TextField
            label={t('classes.schedule.start')}
            type="time"
            value={slot.startTime}
            error={errors[`slots.${i}.startTime`]}
            onChange={(e) => {
              const startTime = e.target.value;
              // A new start moves the end with it, by the course's lesson length when it has one.
              const length =
                lessonMinutes ??
                (slot.startTime && slot.endTime > slot.startTime
                  ? minutesBetween(slot.startTime, slot.endTime)
                  : 60);
              set(i, { startTime, endTime: startTime ? plusMinutes(startTime, length) : '' });
            }}
          />
          <TextField
            label={t('classes.schedule.end')}
            type="time"
            value={slot.endTime}
            error={errors[`slots.${i}.endTime`]}
            onChange={(e) => set(i, { endTime: e.target.value })}
          />
          <div className="pt-[26px]">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('classes.schedule.remove')}
              onClick={() => onChange(slots.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ))}
      {slots.length < MAX_SCHEDULE_SLOTS ? (
        <div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() => {
              const last = slots.at(-1);
              const start = last?.startTime || '16:00';
              onChange([
                ...slots,
                {
                  weekday: last ? String((Number(last.weekday) % 7) + 1) : '1',
                  startTime: start,
                  endTime: last?.endTime || plusMinutes(start, lessonMinutes ?? 60),
                },
              ]);
            }}
          >
            {slots.length ? t('classes.schedule.addAnother') : t('classes.schedule.add')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function minutesBetween(start: string, end: string) {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  return eh * 60 + em - (sh * 60 + sm);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 border-b border-border pb-5 last:border-b-0 last:pb-0">
      <legend className="mb-4 text-section font-medium text-text">{title}</legend>
      {children}
    </fieldset>
  );
}

/** A failed save's message, unless every error sits on a field. */
function saveError(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiError) {
    if (err.status === 400 && Object.keys(err.fields).length) return null;
    if (err.status === 422 || err.status === 409) return err.message;
  }
  return errorMessage(err);
}

/**
 * Add a class, with its weekly schedule, or edit one (TUI-112). A class keeps its course, term
 * and branch, so editing shows them but doesn't change them; its schedule has a dialog of its
 * own on the class page.
 */
export function ClassDialog({
  open,
  onClose,
  klass,
}: {
  open: boolean;
  onClose: () => void;
  klass?: Class;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={klass ? t('classes.edit.title') : t('classes.add.title')}
      subtitle={klass ? undefined : t('classes.add.subtitle')}
    >
      <ClassForm klass={klass} onClose={onClose} />
    </Dialog>
  );
}

/** The course select's choice that opens the Add course dialog. */
const NEW = 'new';

function ClassForm({ klass, onClose }: { klass?: Class; onClose: () => void }) {
  const { membership } = useOrg();
  const format = useFormat();
  const navigate = useNavigate();
  const paths = useClassPaths();
  const toast = useToast();
  const refresh = useRefreshClasses();
  const courses = useCourses();
  const courseLabel = useCourseLabel();
  const terms = useTerms();
  const branches = useBranches();
  const teachers = useTeachers();

  const own = membership.branchIds;
  const branchChoices = (branches.data?.data ?? []).filter((b) => !own || own.includes(b.id));
  const termList = [...(terms.data?.data ?? [])].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  const openTerms = termList.filter((term) => term.endDate >= format.today);

  const [courseId, setCourseId] = useState(klass?.courseId ?? '');
  const [name, setName] = useState(klass?.name ?? '');
  const [capacity, setCapacity] = useState(klass?.capacity ? String(klass.capacity) : '');
  const [ongoing, setOngoing] = useState(klass ? klass.termId === null : openTerms.length === 0);
  const [termId, setTermId] = useState(
    klass?.termId ?? currentTerm(openTerms, format.today)?.id ?? '',
  );
  const [startDate, setStartDate] = useState(klass?.startDate ?? (klass ? '' : format.today));
  const [endDate, setEndDate] = useState(klass?.endDate ?? '');
  const [branchId, setBranchId] = useState(
    klass?.branchId ?? (branchChoices.length === 1 ? branchChoices[0]!.id : ''),
  );
  const [roomId, setRoomId] = useState(klass?.roomId ?? '');
  const [teacherId, setTeacherId] = useState(klass?.teacherId ?? '');
  const [slots, setSlots] = useState<SlotDraft[]>(
    klass ? klass.schedule.map(toDraft) : [{ weekday: '1', startTime: '16:00', endTime: '17:00' }],
  );
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [addingCourse, setAddingCourse] = useState(false);
  const rooms = useRooms(branchId);
  const noCourses = courses.isSuccess && courses.data.data.length === 0;
  const course = courses.data?.data.find((c) => c.id === courseId);
  const lessonMinutes = course?.durationMinutes ?? null;
  // Branches load after the form opens: a single one is chosen without asking.
  const branch = branchId || (branchChoices.length === 1 ? branchChoices[0]!.id : '');

  const save = useMutation({
    mutationFn: async () => {
      const dates = ongoing
        ? { startDate: startDate || null, endDate: endDate || null }
        : { startDate: null, endDate: null };
      if (klass) {
        return api<Class>('PATCH', orgApiPath(membership, `/classes/${klass.id}`), {
          body: {
            updatedAt: klass.updatedAt,
            name: name.trim(),
            capacity: capacity ? Number(capacity) : null,
            roomId: roomId || null,
            teacherId: teacherId || null,
            ...(klass.termId === null ? dates : {}),
          },
        });
      }
      const created = await api<Class>('POST', orgApiPath(membership, '/classes'), {
        body: {
          courseId,
          termId: ongoing ? null : termId || null,
          branchId: branch,
          name: name.trim(),
          capacity: capacity ? Number(capacity) : null,
          roomId: roomId || null,
          teacherId: teacherId || null,
          ...dates,
        },
      });
      if (slots.length) {
        try {
          await api<ScheduleResult>(
            'PUT',
            orgApiPath(membership, `/classes/${created.id}/schedule`),
            { body: { slots: toSlots(slots) } },
          );
        } catch {
          // The class is saved; its schedule can be set again from the class page.
          return { ...created, scheduleFailed: true as const };
        }
      }
      return created;
    },
    onSuccess: async (saved) => {
      await refresh();
      onClose();
      if (klass) {
        toast(t('classes.saved'));
        return;
      }
      toast('scheduleFailed' in saved ? t('classes.added.noSchedule') : t('classes.added'));
      navigate(paths.class(saved.id, 'schedule'));
    },
  });

  const errors = { ...fieldErrors(save.error), ...localErrors };
  const message = saveError(save.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!klass && !courseId) local.courseId = t('classes.error.required');
    if (!name.trim()) local.name = t('classes.error.required');
    if (!klass && !branch) local.branchId = t('classes.error.required');
    if (!klass && !ongoing && !termId) local.termId = t('classes.error.required');
    if (ongoing && !startDate) local.startDate = t('classes.error.required');
    if (ongoing && endDate && startDate && endDate < startDate)
      local.endDate = t('classes.error.endDate');
    if (!klass) Object.assign(local, slotErrors(slots));
    setLocalErrors(local);
    if (Object.keys(local).length === 0) save.mutate();
  }

  return (
    <>
      <form noValidate onSubmit={submit} className="flex flex-col gap-5">
        {noCourses && !klass ? (
          <Notice
            tone="info"
            action={
              <Button variant="secondary" size="sm" onClick={() => setAddingCourse(true)}>
                {t('courses.add')}
              </Button>
            }
          >
            {t('classes.noCourses')}
          </Notice>
        ) : null}

        <Section title={t('classes.section.class')}>
          <div className="grid gap-4 sm:grid-cols-2">
            {klass ? (
              <ReadOnly label={t('classes.field.course')} value={courseLabel(klass.courseId)} />
            ) : (
              <SelectField
                label={t('classes.field.course')}
                required
                value={courseId}
                error={errors.courseId}
                onChange={(e) =>
                  e.target.value === NEW ? setAddingCourse(true) : setCourseId(e.target.value)
                }
                options={[
                  { value: '', label: t('classes.field.choose') },
                  ...(courses.data?.data ?? [])
                    .map((c) => ({ value: c.id, label: courseLabel(c.id) }))
                    .sort((a, b) => a.label.localeCompare(b.label)),
                  { value: NEW, label: t('classes.field.newCourse') },
                ]}
              />
            )}
            <TextField
              label={t('classes.field.name')}
              required
              value={name}
              maxLength={120}
              placeholder={t('classes.field.namePlaceholder')}
              error={errors.name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label={t('classes.field.capacity')}
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              value={capacity}
              error={errors.capacity}
              helper={t('classes.field.capacityHelp')}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
        </Section>

        <Section title={t('classes.section.when')}>
          {klass ? (
            klass.termId ? (
              <ReadOnly
                label={t('classes.field.term')}
                value={termList.find((term) => term.id === klass.termId)?.name ?? ''}
                helper={t('classes.field.termFixed')}
              />
            ) : null
          ) : (
            // In a block of its own, so the switch sits at the start rather than at the end.
            <div>
              <Toggle
                checked={ongoing}
                onChange={setOngoing}
                label={t('classes.field.ongoing')}
                hint={t('classes.field.ongoingHint')}
              />
            </div>
          )}
          {ongoing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t('classes.field.startDate')}
                required
                type="date"
                value={startDate}
                error={errors.startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <TextField
                label={t('classes.field.endDate')}
                type="date"
                value={endDate}
                error={errors.endDate}
                helper={t('classes.field.endDateHelp')}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          ) : !klass ? (
            <SelectField
              label={t('classes.field.term')}
              required
              value={termId}
              error={errors.termId}
              onChange={(e) => setTermId(e.target.value)}
              options={[
                { value: '', label: t('classes.field.choose') },
                ...openTerms.map((term) => ({
                  value: term.id,
                  label: t('classes.termOption', {
                    name: term.name,
                    start: format.date(term.startDate),
                    end: format.date(term.endDate),
                  }),
                })),
              ]}
            />
          ) : null}
        </Section>

        <Section title={t('classes.section.where')}>
          <div className="grid gap-4 sm:grid-cols-2">
            {klass || branchChoices.length <= 1 ? (
              branchChoices.length > 1 || klass ? (
                <ReadOnly
                  label={t('classes.field.branch')}
                  value={branches.data?.data.find((b) => b.id === branch)?.name ?? ''}
                />
              ) : null
            ) : (
              <SelectField
                label={t('classes.field.branch')}
                required
                value={branchId}
                error={errors.branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setRoomId('');
                }}
                options={[
                  { value: '', label: t('classes.field.choose') },
                  ...branchChoices.map((b) => ({ value: b.id, label: b.name })),
                ]}
              />
            )}
            <SelectField
              label={t('classes.field.room')}
              value={roomId}
              error={errors.roomId}
              disabled={!branch}
              helper={
                rooms.isSuccess && rooms.data.data.length === 0
                  ? t('classes.field.noRooms')
                  : t('classes.field.roomHelp')
              }
              onChange={(e) => setRoomId(e.target.value)}
              options={[
                { value: '', label: t('classes.field.noRoom') },
                ...(rooms.data?.data ?? []).map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
            {teachers.data ? (
              <SelectField
                label={t('classes.field.teacher')}
                value={teacherId}
                error={errors.teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                options={[
                  { value: '', label: t('classes.field.noTeacher') },
                  ...teachers.data.data
                    .filter((m) => !branch || m.branchIds === null || m.branchIds.includes(branch))
                    .map((m) => ({ value: m.id, label: m.name })),
                ]}
              />
            ) : null}
          </div>
        </Section>

        {klass ? null : (
          <Section title={t('classes.section.schedule')}>
            <ScheduleRows
              slots={slots}
              onChange={setSlots}
              errors={errors}
              lessonMinutes={lessonMinutes}
            />
          </Section>
        )}

        {message ? <Notice tone="danger">{message}</Notice> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {klass ? t('classes.save') : t('classes.add')}
          </Button>
        </div>
      </form>
      {/* Outside the form: a form can't hold another. Saving picks the new course here. */}
      <CourseDialog
        open={addingCourse}
        onClose={() => setAddingCourse(false)}
        onSaved={(made) => setCourseId(made.id)}
      />
    </>
  );
}

function ReadOnly({ label, value, helper }: { label: string; value: string; helper?: string }) {
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

/** Replace a class's weekly schedule (PUT /classes/{id}/schedule). */
export function ScheduleDialog({
  klass,
  open,
  onClose,
  lessonMinutes,
}: {
  klass: Class;
  open: boolean;
  onClose: () => void;
  lessonMinutes: number | null;
}) {
  return (
    <Dialog open={open} onClose={onClose} wide title={t('classes.schedule.editTitle')}>
      <ScheduleForm klass={klass} onClose={onClose} lessonMinutes={lessonMinutes} />
    </Dialog>
  );
}

function ScheduleForm({
  klass,
  onClose,
  lessonMinutes,
}: {
  klass: Class;
  onClose: () => void;
  lessonMinutes: number | null;
}) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshClasses();
  const [slots, setSlots] = useState<SlotDraft[]>(klass.schedule.map(toDraft));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      api<ScheduleResult>('PUT', orgApiPath(membership, `/classes/${klass.id}/schedule`), {
        body: { slots: toSlots(slots) },
      }),
    onSuccess: async (result) => {
      await refresh();
      const { added, removed } = result.sessions;
      toast(
        added || removed
          ? t('classes.schedule.savedChanges', { added, removed })
          : t('classes.schedule.saved'),
      );
      onClose();
    },
  });
  const errors = { ...fieldErrors(save.error), ...localErrors };
  const message = saveError(save.error);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const local = slotErrors(slots);
        setLocalErrors(local);
        if (Object.keys(local).length === 0) save.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-body text-muted">{t('classes.schedule.help')}</p>
      <ScheduleRows
        slots={slots}
        onChange={setSlots}
        errors={errors}
        lessonMinutes={lessonMinutes}
      />
      {message ? <Notice tone="danger">{message}</Notice> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {t('classes.schedule.save')}
        </Button>
      </div>
    </form>
  );
}
