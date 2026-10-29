import { ABSENCE_REASONS, type AbsenceReason } from '@edustrux/shared';
import { diffDays, weekday } from '@edustrux/shared/dates';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../components/PageState';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, fieldErrors } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { usePortalSessions } from '../../lib/portal';
import type { Child } from './parts';

/** The preview reads lessons for up to this many days; a longer absence just isn't previewed. */
const PREVIEW_DAYS = 62;
const PREVIEW_LINES = 4;

/**
 * Report an absence (Figma "Report an absence"): which child, from and to, an optional reason,
 * and which lessons it covers before it's sent. A notice can't be changed once sent (D-129).
 */
export function ReportAbsence({
  kids,
  initial,
  onClose,
}: {
  kids: Child[];
  initial?: { studentId?: string; date?: string };
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [studentId, setStudentId] = useState(initial?.studentId ?? kids[0]?.id ?? '');
  const [from, setFrom] = useState(initial?.date ?? format.today);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState<AbsenceReason | ''>('');
  const child = kids.find((k) => k.id === studentId);
  const last = to || from;
  const ordered = Boolean(from) && last >= from;
  const previewable = ordered && diffDays(from, last) < PREVIEW_DAYS;

  const sessions = usePortalSessions({ from, to: last, studentId }, Boolean(child) && previewable);
  const missed = (sessions.data?.data ?? []).filter((s) => s.status !== 'cancelled');

  const send = useMutation({
    mutationFn: () =>
      api('POST', orgApiPath(membership, '/portal/absence-notices'), {
        body: {
          studentId,
          startDate: from,
          ...(to && { endDate: to }),
          ...(reason && { reason }),
        },
      }),
    onSuccess: async () => {
      toast(t('portal.absence.sent'));
      onClose();
      await queryClient.invalidateQueries({ queryKey: ['absence-notices', membership.org.id] });
    },
  });
  const errors = fieldErrors(send.error);
  const toError = !ordered && to ? t('portal.absence.toBefore') : errors.endDate;

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={t('portal.absence.title')}
      subtitle={t('portal.absence.subtitle')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={send.isPending}
            disabled={!child || !from || !ordered}
            onClick={() => send.mutate()}
          >
            {t('portal.absence.send')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {kids.length > 1 ? (
          <fieldset>
            <legend className="mb-2 text-label font-semibold text-text">
              {t('portal.absence.child')}
            </legend>
            <div role="radiogroup" className="grid grid-cols-2 gap-2">
              {kids.map((kid) => {
                const on = kid.id === studentId;
                return (
                  <button
                    key={kid.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setStudentId(kid.id)}
                    className={cn(
                      'flex h-[58px] items-center gap-2.5 rounded-lg border bg-surface px-2.5 text-left',
                      on ? 'border-2 border-brand bg-brand-soft' : 'border-border-strong',
                    )}
                  >
                    <Avatar name={`${kid.firstName} ${kid.lastName}`} className="size-[38px]" />
                    <b className="truncate text-label font-semibold text-text">{kid.firstName}</b>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-label font-semibold text-text">
            {t('portal.absence.from')}
            <input
              type="date"
              value={from}
              required
              onChange={(e) => setFrom(e.target.value)}
              className="h-11 rounded-lg border border-border-strong px-2.5 text-label font-normal focus:outline-2 focus:outline-brand"
            />
            {errors.startDate ? (
              <span className="text-meta font-normal text-danger">{errors.startDate}</span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1.5 text-label font-semibold text-text">
            <span>
              {t('portal.absence.to')}{' '}
              <small className="text-meta font-normal text-muted">{t('lesson.optional')}</small>
            </span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              aria-invalid={Boolean(toError)}
              className={cn(
                'h-11 rounded-lg border px-2.5 text-label font-normal focus:outline-2 focus:outline-brand',
                toError ? 'border-danger' : 'border-border-strong',
              )}
            />
            {toError ? <span className="text-meta font-normal text-danger">{toError}</span> : null}
          </label>
        </div>

        {/* A fixed choice, not free text, so no health detail is typed in (D-171). */}
        <SelectField
          label={t('portal.absence.reason')}
          helper={t('lesson.optional')}
          value={reason}
          onChange={(e) => setReason(e.target.value as AbsenceReason | '')}
          options={[
            { value: '', label: t('portal.absence.noReason') },
            ...ABSENCE_REASONS.map((r) => ({ value: r, label: t(`absence.reason.${r}`) })),
          ]}
          error={errors.reason}
        />

        {child && previewable && sessions.isSuccess ? (
          <div className="flex gap-2.5 rounded-lg bg-info-soft p-3 text-info" aria-live="polite">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="flex flex-col gap-0.5 text-meta">
              <b className="font-semibold">
                {missed.length === 0
                  ? t('portal.absence.noLessons', { name: child.firstName })
                  : t(missed.length === 1 ? 'portal.absence.missOne' : 'portal.absence.miss', {
                      name: child.firstName,
                      n: missed.length,
                    })}
              </b>
              {missed.length ? (
                <span>
                  {missed
                    .slice(0, PREVIEW_LINES)
                    .map((s) => `${s.className} (${format.weekday(weekday(s.date))})`)
                    .join(', ')}
                  {missed.length > PREVIEW_LINES
                    ? ` ${t('today.awayMore', { n: missed.length - PREVIEW_LINES })}`
                    : ''}
                </span>
              ) : null}
            </span>
          </div>
        ) : null}

        {send.isError && !errors.startDate && !errors.endDate ? (
          <p className="text-meta text-danger" role="alert">
            {errorMessage(send.error)}
          </p>
        ) : null}
        <p className="text-meta text-muted">{t('portal.absence.final')}</p>
      </div>
    </Dialog>
  );
}
