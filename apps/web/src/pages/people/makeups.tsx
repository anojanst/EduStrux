import { addDays } from '@edustrux/shared/dates';
import type {
  Class,
  MakeupBooking,
  MakeupCredit,
  MakeupPolicy,
  Session,
  Student,
} from '@edustrux/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../components/PageState';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { classColour, query, type Page } from '../../lib/people';
import { can } from '../../lib/roles';
import { ConfirmDialog } from './dialogs';
import { CardEmpty, SectionCard } from './parts';

/** A refused booking says why (full, already booked, too late); other errors read as usual. */
function bookingError(err: unknown) {
  return err instanceof ApiError && (err.status === 409 || err.status === 422)
    ? err.message
    : errorMessage(err);
}

/** How far ahead the booking dialog looks for lessons, unless the credit lapses sooner. */
const BOOKING_WINDOW_DAYS = 28;

function useRefreshMakeups() {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  const orgId = membership.org.id;
  // A booking changes the credit, the lesson's roster and the dashboard's count of credits.
  return () =>
    Promise.all(
      [
        ['makeup-credits', orgId],
        ['sessions', orgId],
        ['session', orgId],
        ['dashboard', orgId],
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
}

type Open = { kind: 'book'; credit: MakeupCredit } | { kind: 'cancel'; booking: MakeupBooking };

/**
 * The student's make-up credits (D-139): the ones still to use, each with "Book" for staff who
 * can change classes, and the make-ups booked and still to come, which can be cancelled.
 */
export function MakeupCard({ student }: { student: Student }) {
  const { membership } = useOrg();
  const format = useFormat();
  const refresh = useRefreshMakeups();
  const toast = useToast();
  const [open, setOpen] = useState<Open | null>(null);
  const canBook = can(membership.role, 'classes:write');
  const credits = useQuery({
    queryKey: ['makeup-credits', membership.org.id, { studentId: student.id }],
    queryFn: ({ signal }) =>
      api<Page<MakeupCredit>>(
        'GET',
        orgApiPath(membership, `/makeup-credits${query({ studentId: student.id, limit: 200 })}`),
        { signal },
      ),
  });
  const all = credits.data?.data ?? [];
  const available = all
    .filter((c) => c.status === 'available')
    .sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999'));
  const booked = all
    .flatMap((c) => (c.booking && c.booking.date >= format.today ? [c.booking] : []))
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  const classIds = [...new Set(available.map((c) => c.classId))];
  const classes = useQueries({
    queries: classIds.map((classId) => ({
      queryKey: ['class', membership.org.id, classId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api<Class>('GET', orgApiPath(membership, `/classes/${classId}`), { signal }),
      staleTime: 60_000,
    })),
  });
  const className = new Map(classes.flatMap((c) => (c.data ? [[c.data.id, c.data.name]] : [])));
  const close = () => setOpen(null);

  return (
    <SectionCard title={t('people.makeups')}>
      {credits.isPending ? (
        <div className="h-16 animate-pulse bg-canvas/60" aria-hidden />
      ) : credits.isError ? (
        <CardEmpty>{errorMessage(credits.error)}</CardEmpty>
      ) : available.length === 0 && booked.length === 0 ? (
        <CardEmpty>{t('people.makeups.none')}</CardEmpty>
      ) : (
        <ul className="divide-y divide-border">
          {available.map((credit) => (
            <li key={credit.id} className="flex items-center gap-3 px-4 py-3">
              <span
                aria-hidden
                className="h-9 w-[3px] shrink-0 rounded-full"
                style={{ background: classColour(credit.classId) }}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-body font-semibold text-text">
                  {className.get(credit.classId) ?? t('people.makeups.aLesson')}
                </b>
                <small className="text-meta text-muted">
                  {[
                    t('people.makeups.missedOn', { day: format.day(credit.missedOn) }),
                    credit.expiresOn
                      ? t('people.makeups.useBy', { date: format.date(credit.expiresOn) })
                      : t('people.makeups.noExpiry'),
                  ].join(' · ')}
                </small>
              </span>
              {canBook ? (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t('people.makeups.bookLabel', { day: format.day(credit.missedOn) })}
                  onClick={() => setOpen({ kind: 'book', credit })}
                >
                  {t('people.makeups.book')}
                </Button>
              ) : (
                <Badge tone="info">{t('people.makeups.status.available')}</Badge>
              )}
            </li>
          ))}
          {booked.map((booking) => (
            <li key={booking.id} className="flex items-center gap-3 px-4 py-3">
              <span
                aria-hidden
                className="h-9 w-[3px] shrink-0 rounded-full"
                style={{ background: classColour(booking.classId) }}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-body font-semibold text-text">{booking.className}</b>
                <small className="text-meta text-muted">
                  {t('people.makeups.bookedFor', {
                    when: `${format.day(booking.date)} ${format.time(booking.startTime)}`,
                  })}
                </small>
              </span>
              {canBook ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('people.makeups.cancelLabel', { day: format.day(booking.date) })}
                  onClick={() => setOpen({ kind: 'cancel', booking })}
                >
                  {t('common.cancel')}
                </Button>
              ) : (
                <Badge tone="success">{t('people.makeups.status.booked')}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}

      {open?.kind === 'book' ? (
        <BookMakeupDialog
          student={student}
          credit={open.credit}
          missedClass={className.get(open.credit.classId)}
          bookedSessionIds={all.flatMap((c) => (c.booking ? [c.booking.sessionId] : []))}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'cancel' ? (
        <ConfirmDialog
          open
          onClose={close}
          title={t('people.makeups.cancel.title')}
          body={t('people.makeups.cancel.body', {
            name: student.firstName,
            className: open.booking.className,
            day: format.dayLong(open.booking.date),
          })}
          action={t('people.makeups.cancel.action')}
          onConfirm={async () => {
            await api('DELETE', orgApiPath(membership, `/makeup-bookings/${open.booking.id}`));
            await refresh();
            toast(t('people.makeups.cancelled'));
          }}
        />
      ) : null}
    </SectionCard>
  );
}

/**
 * Pick a lesson to book a credit into: scheduled lessons in the student's branch from now until
 * the credit lapses (four weeks at most), leaving out the student's own lessons and make-ups.
 * Under a same-course policy only that course's lessons show; otherwise they show first, and
 * "Any course" adds the rest. A full lesson is refused by the API (422) with its message.
 */
function BookMakeupDialog({
  student,
  credit,
  missedClass,
  bookedSessionIds,
  onClose,
}: {
  student: Student;
  credit: MakeupCredit;
  missedClass: string | undefined;
  /** The lessons the student already has a make-up booked in. */
  bookedSessionIds: string[];
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const refresh = useRefreshMakeups();
  const toast = useToast();
  const orgId = membership.org.id;
  const [sessionId, setSessionId] = useState('');
  const [anyCourse, setAnyCourse] = useState(false);
  const from = format.today;
  const windowEnd = addDays(from, BOOKING_WINDOW_DAYS - 1);
  const to = credit.expiresOn && credit.expiresOn < windowEnd ? credit.expiresOn : windowEnd;

  const policy = useQuery({
    queryKey: ['makeup-policy', orgId],
    queryFn: ({ signal }) =>
      api<MakeupPolicy>('GET', orgApiPath(membership, '/makeup-policy'), { signal }),
    staleTime: 60_000,
  });
  const lessons = useQuery({
    queryKey: ['sessions', orgId, { branchId: student.branchId, from, to }],
    queryFn: ({ signal }) =>
      api<Page<Session>>(
        'GET',
        orgApiPath(
          membership,
          `/sessions${query({ branchId: student.branchId, from, to, limit: 200 })}`,
        ),
        { signal },
      ),
  });
  const own = useQuery({
    queryKey: ['sessions', orgId, { studentId: student.id, from, to, limit: 200 }],
    queryFn: ({ signal }) =>
      api<Page<Session>>(
        'GET',
        orgApiPath(
          membership,
          `/sessions${query({ studentId: student.id, from, to, limit: 200 })}`,
        ),
        { signal },
      ),
  });

  const book = useMutation({
    mutationFn: () =>
      api<MakeupBooking>('POST', orgApiPath(membership, '/makeup-bookings'), {
        body: { creditId: credit.id, sessionId },
      }),
    onSuccess: async (booking) => {
      await refresh();
      toast(
        t('people.makeups.booked', {
          name: student.firstName,
          when: `${format.day(booking.date)} ${format.time(booking.startTime)}`,
        }),
      );
      onClose();
    },
  });

  const sameCourseOnly = policy.data?.sameCourseOnly ?? true;
  const taken = new Set([...(own.data?.data ?? []).map((s) => s.id), ...bookedSessionIds]);
  const now = Date.now();
  const candidates = (lessons.data?.data ?? []).filter(
    (s) =>
      s.status === 'scheduled' &&
      Date.parse(s.startsAt) > now &&
      !taken.has(s.id) &&
      (s.courseId === credit.courseId || (!sameCourseOnly && anyCourse)),
  );
  const pending = policy.isPending || lessons.isPending || own.isPending;
  const loadError = policy.error ?? lessons.error ?? own.error;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('people.makeups.bookTitle', { name: student.firstName })}
      subtitle={
        missedClass
          ? t('people.makeups.missed', { name: missedClass, day: format.day(credit.missedOn) })
          : t('people.makeups.missedOn', { day: format.day(credit.missedOn) })
      }
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={book.isPending}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!sessionId} loading={book.isPending} onClick={() => book.mutate()}>
            {t('people.makeups.book')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-meta text-muted">
          {t('people.makeups.window', { from: format.dayShort(from), to: format.dayShort(to) })}
        </p>
        {!sameCourseOnly ? (
          <label className="flex items-center gap-2 text-body text-text">
            <input
              type="checkbox"
              checked={anyCourse}
              onChange={(e) => {
                setAnyCourse(e.target.checked);
                setSessionId('');
              }}
              className="size-4 accent-[var(--brand)]"
            />
            {t('people.makeups.anyCourse')}
          </label>
        ) : null}
        {pending ? (
          <div className="h-32 animate-pulse rounded-lg bg-canvas/60" aria-hidden />
        ) : loadError ? (
          <Notice tone="danger">{errorMessage(loadError)}</Notice>
        ) : candidates.length === 0 ? (
          <p className="rounded-lg border border-border px-4 py-6 text-center text-body text-muted">
            {t('people.makeups.noLessons')}
          </p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-label font-medium text-text">
              {t('people.makeups.pick')}
            </legend>
            {candidates.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border-strong px-3 py-2.5 has-checked:border-brand has-checked:bg-brand-soft"
              >
                <input
                  type="radio"
                  name="session"
                  value={s.id}
                  checked={sessionId === s.id}
                  onChange={() => setSessionId(s.id)}
                  className="size-4 shrink-0 accent-[var(--brand)]"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="text-body font-semibold text-text">
                    {format.day(s.date)}{' '}
                    <span className="font-normal text-muted tabular-nums">
                      {format.timeRange(s.startTime, s.endTime)}
                    </span>
                  </b>
                  <small className="truncate text-meta text-muted">
                    {[s.className, s.teacherName, s.roomName].filter(Boolean).join(' · ')}
                  </small>
                </span>
              </label>
            ))}
            {lessons.data?.nextCursor ? (
              <p className="text-meta text-muted">{t('people.makeups.more')}</p>
            ) : null}
          </fieldset>
        )}
        {book.error ? <Notice tone="danger">{bookingError(book.error)}</Notice> : null}
      </div>
    </Dialog>
  );
}
