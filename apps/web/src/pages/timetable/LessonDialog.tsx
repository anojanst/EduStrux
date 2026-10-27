import type { Clash, Session } from '@edustrux/shared';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Check, MapPin, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../../components/PageState';
import { Badge } from '../../components/ui/Badge';
import { Button, buttonClass } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { OverflowMenu, type MenuItem } from '../../components/ui/Menu';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import {
  markedCount,
  useClassPaths,
  useCourseLabel,
  useRefreshClasses,
  useRooms,
  useTeachers,
} from '../../lib/classes';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { classColour } from '../../lib/people';
import { can } from '../../lib/roles';
import { marksLabel } from '../classes/LessonResult';
import { ConfirmDialog, StaleOrError } from '../people/dialogs';

/**
 * A lesson opened from the timetable: when, where and who, its attendance, any clash, and what
 * can be done about it. Moving and cancelling are for roles that change classes, before the
 * lesson starts, as on the class page.
 */
export function LessonDialog({
  session,
  clashes,
  onClose,
}: {
  session: Session;
  clashes: Clash[];
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const paths = useClassPaths();
  const courseLabel = useCourseLabel();
  const refresh = useRefreshClasses();
  const toast = useToast();
  const [step, setStep] = useState<'detail' | 'move' | 'cancel'>('detail');
  const cancelled = session.status === 'cancelled';
  const started = session.startsAt <= new Date().toISOString();
  const canWrite = can(membership.role, 'classes:write');
  const canMark = can(membership.role, 'attendance:write');

  const restore = useMutation({
    mutationFn: () =>
      api('PATCH', orgApiPath(membership, `/sessions/${session.id}`), {
        body: { updatedAt: session.updatedAt, status: 'scheduled' },
      }),
    onSuccess: async () => {
      await refresh();
      toast(t('classes.lesson.restored'));
      onClose();
    },
    onError: (err) => toast(errorMessage(err)),
  });

  if (step === 'move') return <MoveLesson session={session} onClose={onClose} />;
  if (step === 'cancel') {
    return (
      <ConfirmDialog
        open
        onClose={onClose}
        title={t('classes.lesson.cancelTitle', { when: format.day(session.date) })}
        body={t('classes.lesson.cancelBody')}
        action={t('classes.lesson.cancel')}
        onConfirm={async () => {
          await api('PATCH', orgApiPath(membership, `/sessions/${session.id}`), {
            body: { updatedAt: session.updatedAt, status: 'cancelled' },
          });
          await refresh();
          toast(t('classes.lesson.cancelled'));
        }}
      />
    );
  }

  const items: MenuItem[] =
    canWrite && !started
      ? cancelled
        ? [{ label: t('classes.lesson.restore'), onSelect: () => restore.mutate() }]
        : [
            { label: t('timetable.lesson.move'), onSelect: () => setStep('move') },
            {
              label: t('classes.lesson.cancel'),
              onSelect: () => setStep('cancel'),
              danger: true,
            },
          ]
      : [];
  const marked = markedCount(session) > 0;
  const due = session.date <= format.today && !cancelled;
  const course = courseLabel(session.courseId);

  return (
    <Dialog
      open
      onClose={onClose}
      title={session.className}
      subtitle={[
        `${format.dayLong(session.date)} · ${format.timeRange(session.startTime, session.endTime)}`,
        course,
      ]
        .filter(Boolean)
        .join(' · ')}
      actions={
        <div className="flex w-full items-center gap-2">
          {canMark && due && !marked ? (
            <Link to={paths.lesson(session.id)} className={buttonClass('primary')}>
              {t('classes.markAttendance')}
            </Link>
          ) : (
            <Link to={paths.lesson(session.id)} className={buttonClass('secondary')}>
              {t('timetable.lesson.openLesson')}
            </Link>
          )}
          <Link to={paths.class(session.classId)} className={buttonClass('ghost')}>
            {t('timetable.lesson.openClass')}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          {items.length ? (
            <span className="ml-auto">
              <OverflowMenu label={t('classes.lesson.actions')} items={items} />
            </span>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-meta text-muted">
          <span
            aria-hidden
            className="size-3 rounded-full"
            style={{ background: classColour(session.classId) }}
          />
          <span className="flex items-center gap-1.5">
            <MapPin className="size-4" aria-hidden />
            {session.roomName ?? t('timetable.noRoom')}
          </span>
          <span className="flex items-center gap-1.5">
            <User className="size-4" aria-hidden />
            {session.teacherName ?? t('timetable.noTeacher')}
          </span>
          {cancelled ? (
            <Badge tone="danger">{t('people.lesson.cancelled')}</Badge>
          ) : session.movedFrom ? (
            <Badge tone="warning">{t('timetable.moved')}</Badge>
          ) : (
            <Badge>{t('timetable.lesson.scheduled')}</Badge>
          )}
        </div>
        {session.movedFrom ? (
          <p className="text-meta text-muted">
            {t('people.lesson.moved', {
              when: `${format.day(session.movedFrom.date)} ${format.time(session.movedFrom.startTime)}`,
            })}
          </p>
        ) : null}
        {session.attendance && due ? (
          <div
            className={
              marked
                ? 'flex gap-2.5 rounded-lg bg-success-soft p-3 text-success'
                : 'flex gap-2.5 rounded-lg bg-warning-soft p-3 text-warning'
            }
          >
            {marked ? (
              <Check className="size-[18px] shrink-0" aria-hidden />
            ) : (
              <span aria-hidden className="mt-1.5 size-[7px] shrink-0 rounded-full bg-warning" />
            )}
            <span className="flex flex-col text-meta">
              <b className="font-semibold">{t('timetable.lesson.attendance')}</b>
              {marked ? marksLabel(session) : t('timetable.lesson.notMarkedYet')}
            </span>
          </div>
        ) : null}
        {clashes.map((clash) => {
          const other = clash.sessions.find((s) => s.id !== session.id) ?? clash.sessions[0]!;
          return (
            <Notice
              key={`${clash.kind}-${other.id}`}
              tone="warning"
              title={t(clash.kind === 'room' ? 'timetable.clash.room' : 'timetable.clash.teacher', {
                other: other.className,
              })}
            >
              {format.timeRange(other.startTime, other.endTime)}
            </Notice>
          );
        })}
      </div>
    </Dialog>
  );
}

/** Moves one lesson: its date, times, room or teacher. The weekly schedule stays as it is. */
function MoveLesson({ session, onClose }: { session: Session; onClose: () => void }) {
  const { membership } = useOrg();
  const refresh = useRefreshClasses();
  const toast = useToast();
  const rooms = useRooms(session.branchId);
  const teachers = useTeachers();
  const [draft, setDraft] = useState({
    date: session.date,
    startTime: session.startTime,
    endTime: session.endTime,
    roomId: session.roomId ?? '',
    teacherId: session.teacherId ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const changes = {
    ...(draft.date !== session.date && { date: draft.date }),
    ...(draft.startTime !== session.startTime && { startTime: draft.startTime }),
    ...(draft.endTime !== session.endTime && { endTime: draft.endTime }),
    ...(draft.roomId !== (session.roomId ?? '') && { roomId: draft.roomId || null }),
    ...(draft.teacherId !== (session.teacherId ?? '') && { teacherId: draft.teacherId || null }),
  };

  const save = useMutation({
    mutationFn: () =>
      api('PATCH', orgApiPath(membership, `/sessions/${session.id}`), {
        body: { updatedAt: session.updatedAt, ...changes },
      }),
    onSuccess: async () => {
      await refresh();
      toast(t('timetable.moved.toast'));
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 400) setErrors(fieldErrors(err));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.endTime <= draft.startTime) {
      setErrors({ endTime: t('timetable.move.endTime') });
      return;
    }
    setErrors({});
    save.mutate();
  }

  const set = (key: keyof typeof draft) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const unchanged = Object.keys(changes).length === 0;
  // A room or teacher no longer in the lists still shows as the lesson's own.
  const roomOptions = [
    { value: '', label: t('timetable.move.none') },
    ...(rooms.data?.data ?? []).map((r) => ({ value: r.id, label: r.name })),
  ];
  if (session.roomId && !roomOptions.some((o) => o.value === session.roomId)) {
    roomOptions.push({ value: session.roomId, label: session.roomName ?? '' });
  }
  const teacherOptions = [
    { value: '', label: t('timetable.move.none') },
    ...(teachers.data?.data ?? []).map((m) => ({ value: m.id, label: m.name })),
  ];
  if (session.teacherId && !teacherOptions.some((o) => o.value === session.teacherId)) {
    teacherOptions.push({ value: session.teacherId, label: session.teacherName ?? '' });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('timetable.move.title')}
      subtitle={session.className}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="move-lesson" loading={save.isPending} disabled={unchanged}>
            {t('timetable.move.title')}
          </Button>
        </>
      }
    >
      <form id="move-lesson" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('timetable.move.date')}
            type="date"
            required
            value={draft.date}
            onChange={(e) => set('date')(e.target.value)}
            error={errors.date}
          />
          <SelectField
            label={t('timetable.move.room')}
            value={draft.roomId}
            onChange={(e) => set('roomId')(e.target.value)}
            options={roomOptions}
            error={errors.roomId}
          />
          <TextField
            label={t('timetable.move.start')}
            type="time"
            required
            value={draft.startTime}
            onChange={(e) => set('startTime')(e.target.value)}
            error={errors.startTime}
          />
          <TextField
            label={t('timetable.move.end')}
            type="time"
            required
            value={draft.endTime}
            onChange={(e) => set('endTime')(e.target.value)}
            error={errors.endTime}
          />
          <SelectField
            label={t('timetable.move.teacher')}
            value={draft.teacherId}
            onChange={(e) => set('teacherId')(e.target.value)}
            options={teacherOptions}
            error={errors.teacherId}
          />
        </div>
        <Notice tone="info">{t('timetable.move.note')}</Notice>
        <StaleOrError error={save.error} onReload={onClose} />
      </form>
    </Dialog>
  );
}
