import type { MessageTemplate, NotificationSettings } from '@edustrux/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage, PageError } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Field, TextField } from '../../components/ui/Field';
import { OverflowMenu } from '../../components/ui/Menu';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { useNotificationSettings, useRefreshMessages, useTemplates } from '../../lib/messages';
import { orgApiPath, useOrg } from '../../lib/org';
import { StaleOrError } from '../people/dialogs';
import { EmptyState, SkeletonRows } from '../people/parts';
import { Toggle } from '../people/Toggle';

type Open =
  { kind: 'edit'; template?: MessageTemplate } | { kind: 'delete'; template: MessageTemplate };

/** Templates (owner): the announcements sent often, to start a new one from. */
export function TemplatesTab() {
  const templates = useTemplates();
  const [open, setOpen] = useState<Open | null>(null);
  const list = templates.data?.data ?? [];
  const close = () => setOpen(null);

  if (templates.isError) {
    return <PageError error={templates.error} onRetry={() => void templates.refetch()} />;
  }
  return (
    <>
      <Card flush className="overflow-hidden">
        <div className="flex min-h-16 items-center gap-2.5 border-b border-border px-4 py-3">
          <h2 className="flex-1 text-section font-medium text-text">
            {t('messages.templates.title')}
          </h2>
          <Button
            variant="secondary"
            icon={<Plus className="size-4" />}
            onClick={() => setOpen({ kind: 'edit' })}
          >
            {t('messages.templates.add')}
          </Button>
        </div>
        {templates.isPending ? (
          <SkeletonRows rows={3} />
        ) : list.length === 0 ? (
          <EmptyState
            Icon={FileText}
            title={t('messages.templates.none')}
            body={t('messages.templates.noneBody')}
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((template) => (
              <li
                key={template.id}
                className="grid min-h-[72px] grid-cols-[36px_minmax(0,1fr)_44px] items-center gap-3 px-4 py-2.5"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand">
                  <FileText className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col">
                  <b className="truncate text-body font-semibold text-text">{template.name}</b>
                  <span className="truncate text-label text-text">{template.subject}</span>
                  <small className="truncate text-meta text-muted">{template.body}</small>
                </span>
                <OverflowMenu
                  label={t('terms.actions', { name: template.name })}
                  items={[
                    {
                      label: t('messages.templates.edit'),
                      onSelect: () => setOpen({ kind: 'edit', template }),
                    },
                    {
                      label: t('messages.templates.delete'),
                      danger: true,
                      onSelect: () => setOpen({ kind: 'delete', template }),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog
        open={open?.kind === 'edit'}
        wide
        onClose={close}
        title={t(
          open?.kind === 'edit' && open.template
            ? 'messages.templates.edit'
            : 'messages.templates.add',
        )}
      >
        {open?.kind === 'edit' ? <TemplateForm template={open.template} onClose={close} /> : null}
      </Dialog>
      {open?.kind === 'delete' ? <DeleteTemplate template={open.template} onClose={close} /> : null}
    </>
  );
}

/** A template's name, unique in the org, and the subject and message it starts with. */
function TemplateForm({ template, onClose }: { template?: MessageTemplate; onClose: () => void }) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshMessages();
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const fields = { name: name.trim(), subject: subject.trim(), body: body.trim() };
      return template
        ? api('PATCH', orgApiPath(membership, `/message-templates/${template.id}`), {
            body: { updatedAt: template.updatedAt, ...fields },
          })
        : api('POST', orgApiPath(membership, '/message-templates'), { body: fields });
    },
    onSuccess: async () => {
      await refresh();
      toast(t(template ? 'messages.templates.saved' : 'messages.templates.added'));
      onClose();
    },
  });
  const taken = save.error instanceof ApiError && save.error.code === 'conflict';
  const fields = fieldErrors(save.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = t('courses.error.required');
    if (!subject.trim()) next.subject = t('courses.error.required');
    if (!body.trim()) next.body = t('courses.error.required');
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        label={t('branches.field.name')}
        required
        maxLength={120}
        value={name}
        placeholder={t('messages.templates.namePlaceholder')}
        error={
          errors.name ??
          (taken ? t('messages.templates.taken', { name: name.trim() }) : fields.name)
        }
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        label={t('messages.field.subject')}
        required
        maxLength={200}
        value={subject}
        error={errors.subject ?? fields.subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <Field label={t('messages.field.body')} required error={errors.body ?? fields.body}>
        {(props) => (
          <textarea
            {...props}
            rows={6}
            maxLength={10_000}
            value={body}
            className={cn(props.className, 'h-auto min-h-[140px] py-2.5 sm:h-auto')}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>
      {!taken ? (
        <StaleOrError error={save.error} onReload={() => void refresh().then(onClose)} />
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {t(template ? 'branches.save' : 'messages.templates.add')}
        </Button>
      </div>
    </form>
  );
}

function DeleteTemplate({ template, onClose }: { template: MessageTemplate; onClose: () => void }) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshMessages();
  const run = useMutation({
    mutationFn: () => api('DELETE', orgApiPath(membership, `/message-templates/${template.id}`)),
    onSuccess: async () => {
      await refresh();
      toast(t('branches.deleted', { name: template.name }));
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('messages.templates.deleteTitle', { name: template.name })}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={run.isPending} onClick={() => run.mutate()}>
            {t('messages.templates.delete')}
          </Button>
        </>
      }
    >
      <p className="text-body text-text">{t('messages.templates.deleteBody')}</p>
      <StaleOrError error={run.error} onReload={() => void refresh().then(onClose)} />
    </Dialog>
  );
}

/** Automatic (owner): which automatic emails go out, when reminders are sent, and reply-to. */
export function AutomaticTab() {
  const settings = useNotificationSettings();
  if (settings.isError) {
    return <PageError error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  if (settings.isPending) {
    return (
      <Card flush>
        <SkeletonRows rows={4} />
      </Card>
    );
  }
  return <AutomaticForm settings={settings.data} />;
}

/** Days after the due date a reminder can go out on: the due date itself to a month after. */
const REMINDER_DAYS = Array.from({ length: 31 }, (_, i) => i);
const MAX_REMINDERS = 5;

function AutomaticForm({ settings }: { settings: NotificationSettings }) {
  const { membership } = useOrg();
  const format = useFormat();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => ({
    sessionChanges: settings.sessionChanges,
    invoiceIssued: settings.invoiceIssued,
    overdueReminders: settings.overdueReminders,
    overdueReminderDays: [...settings.overdueReminderDays].sort((a, b) => a - b),
    reminderHour: settings.reminderHour,
    replyToEmail: settings.replyToEmail ?? '',
  }));
  const set = (changes: Partial<typeof form>) => setForm({ ...form, ...changes });
  const save = useMutation({
    mutationFn: () =>
      api<NotificationSettings>('PUT', orgApiPath(membership, '/notification-settings'), {
        body: { ...form, replyToEmail: form.replyToEmail.trim() || null },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['notification-settings', membership.org.id], saved);
      toast(t('messages.automatic.saved'));
    },
  });
  const fields = fieldErrors(save.error);
  const dayLabel = (n: number) =>
    n === 0 ? t('messages.automatic.dueDate') : t(n === 1 ? 'terms.days.one' : 'terms.days', { n });
  const hour = (h: number) => format.time(`${String(h).padStart(2, '0')}:00`);
  const days = form.overdueReminderDays;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form noValidate onSubmit={submit}>
      <Card flush>
        <h2 className="border-b border-border px-4 py-4 text-section font-medium text-text">
          {t('messages.automatic.title')}
        </h2>
        <div className="flex flex-col divide-y divide-border">
          <Row>
            <Toggle
              checked={form.sessionChanges}
              onChange={(on) => set({ sessionChanges: on })}
              label={t('messages.automatic.sessionChanges')}
            />
          </Row>
          <Row>
            <Toggle
              checked={form.invoiceIssued}
              onChange={(on) => set({ invoiceIssued: on })}
              label={t('messages.automatic.invoiceIssued')}
            />
          </Row>
          <Row>
            <Toggle
              checked={form.overdueReminders}
              onChange={(on) => set({ overdueReminders: on })}
              label={t('messages.automatic.overdue')}
              hint={
                form.overdueReminders && days.length
                  ? t('messages.automatic.overdueHint', {
                      days: days.join(', '),
                      time: hour(form.reminderHour),
                    })
                  : undefined
              }
            />
            {form.overdueReminders ? (
              <div className="mt-3 flex flex-col gap-3 pl-[52px]">
                <div className="flex flex-wrap items-center gap-2">
                  {days.map((n) => (
                    <span
                      key={n}
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-info-soft pr-1 pl-3 text-label font-medium text-info"
                    >
                      {dayLabel(n)}
                      <button
                        type="button"
                        aria-label={t('messages.remove', { name: dayLabel(n) })}
                        onClick={() => set({ overdueReminderDays: days.filter((d) => d !== n) })}
                        className="grid size-7 place-items-center rounded-full hover:bg-white/60"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  ))}
                  {days.length < MAX_REMINDERS ? (
                    <label className="relative inline-flex h-8 items-center gap-1 rounded-full px-2 text-label font-semibold text-brand hover:bg-brand-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand">
                      <Plus className="size-4" aria-hidden />
                      {t('messages.automatic.addDay')}
                      <select
                        value=""
                        onChange={(e) =>
                          e.target.value !== '' &&
                          set({
                            overdueReminderDays: [...days, Number(e.target.value)].sort(
                              (a, b) => a - b,
                            ),
                          })
                        }
                        className="absolute inset-0 cursor-pointer opacity-0"
                      >
                        <option value="">{t('messages.automatic.addDay')}</option>
                        {REMINDER_DAYS.filter((n) => !days.includes(n)).map((n) => (
                          <option key={n} value={n}>
                            {dayLabel(n)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                {fields.overdueReminderDays ? (
                  <p className="text-meta text-danger">{fields.overdueReminderDays}</p>
                ) : null}
                <Field label={t('messages.automatic.sendAt')} error={fields.reminderHour}>
                  {(props) => (
                    <select
                      {...props}
                      value={form.reminderHour}
                      onChange={(e) => set({ reminderHour: Number(e.target.value) })}
                      className={cn(props.className, 'sm:max-w-[200px]')}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {hour(h)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            ) : null}
          </Row>
          <Row>
            <TextField
              label={t('messages.automatic.replyTo')}
              type="email"
              maxLength={254}
              value={form.replyToEmail}
              placeholder="office@example.com"
              helper={t('messages.automatic.replyToHelp')}
              error={fields.replyToEmail}
              onChange={(e) => set({ replyToEmail: e.target.value })}
            />
          </Row>
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-meta text-muted">{t('messages.automatic.note')}</p>
          <Button type="submit" loading={save.isPending}>
            {t('messages.automatic.save')}
          </Button>
        </div>
      </Card>
      {save.error && !Object.keys(fields).length ? (
        <Notice tone="danger" className="mt-4">
          {errorMessage(save.error)}
        </Notice>
      ) : null}
    </form>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3.5">{children}</div>;
}
