import type { AudienceType, Message, SearchResults } from '@edustrux/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AppWindow, Mail, Megaphone, Plus, Search, UserRound, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, TextField } from '../../components/ui/Field';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { errorMessage } from '../../components/PageState';
import { api, ApiError, fieldErrors } from '../../lib/api';
import { useAllClasses, useSubjects, useTeachers } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useRefreshMessages, useTemplates } from '../../lib/messages';
import { orgApiPath, useOrg } from '../../lib/org';
import { query, useBranches, useGradeLevels } from '../../lib/people';
import { can } from '../../lib/roles';

const SUBJECT_MAX = 200;
const BODY_MAX = 10_000;

/** "+ New › Announcement" and the Messages page both open this. */
export function NewAnnouncementDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Dialog
      open={open}
      wide={!confirming}
      onClose={onClose}
      title={t(confirming ? 'messages.confirm.title' : 'messages.new')}
      subtitle={t(confirming ? 'messages.confirm.subtitle' : 'messages.newHelp')}
    >
      <Compose onClose={onClose} confirming={confirming} setConfirming={setConfirming} />
    </Dialog>
  );
}

type Option = { id: string; name: string };

/**
 * The audiences a role can pick, with the names to choose from. A teacher writes to their own
 * classes; other staff to any audience, and the API keeps it to the families they reach.
 */
function useAudiences() {
  const { membership } = useOrg();
  const branches = useBranches();
  const grades = useGradeLevels();
  const subjects = useSubjects();
  const classes = useAllClasses();
  const teachers = useTeachers();
  const teacher = !can(membership.role, 'classes:write');
  const scoped = membership.branchIds;
  const options: Partial<Record<AudienceType, Option[]>> = {
    branch: (branches.data?.data ?? []).filter((b) => !scoped || scoped.includes(b.id)),
    grade: grades.data?.data ?? [],
    subject: subjects.data?.data ?? [],
    class: classes.data?.data ?? [],
    teacher: teachers.data?.data ?? [],
  };
  const types: AudienceType[] = teacher
    ? ['teacher', 'class']
    : ['all', 'branch', 'grade', 'subject', 'class', 'teacher', 'custom'];
  return { types, options, teacher };
}

function Compose({
  onClose,
  confirming,
  setConfirming,
}: {
  onClose: () => void;
  confirming: boolean;
  setConfirming: (on: boolean) => void;
}) {
  const { membership, org } = useOrg();
  const toast = useToast();
  const refresh = useRefreshMessages();
  const templates = useTemplates();
  const { types, options, teacher } = useAudiences();
  const [templateId, setTemplateId] = useState('');
  const [type, setType] = useState<AudienceType>(types[0]!);
  const [ids, setIds] = useState<string[]>(teacher ? [membership.id] : []);
  const [families, setFamilies] = useState<Option[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState(true);
  const [portal, setPortal] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const list = new Intl.ListFormat(org?.locale ?? 'en-NZ');
  const channels = [...(email ? ['email' as const] : []), ...(portal ? ['portal' as const] : [])];
  const mine = teacher && type === 'teacher';

  const send = useMutation({
    mutationFn: () =>
      api<Message>('POST', orgApiPath(membership, '/messages'), {
        body: {
          subject: subject.trim(),
          body: body.trim(),
          ...(templateId ? { templateId } : {}),
          audience: { type, ids: type === 'all' ? [] : ids },
          channels,
        },
      }),
    onSuccess: async (message) => {
      await refresh();
      toast(
        t(message.recipientCount === 1 ? 'messages.sent.one' : 'messages.sent', {
          n: message.recipientCount,
        }),
      );
      onClose();
    },
    onError: () => setConfirming(false),
  });
  const fields = fieldErrors(send.error);
  const refused =
    send.error instanceof ApiError && send.error.status === 422
      ? send.error.message
      : send.error && !Object.keys(fields).length
        ? errorMessage(send.error)
        : null;

  const pick = (next: AudienceType) => {
    setType(next);
    setIds(teacher && next === 'teacher' ? [membership.id] : []);
    setFamilies([]);
  };
  const nameOf = (id: string) =>
    (type === 'custom' ? families : (options[type] ?? [])).find((o) => o.id === id)?.name ?? '';

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (type !== 'all' && ids.length === 0) next.audience = t('messages.error.audience');
    if (!subject.trim()) next.subject = t('courses.error.required');
    if (!body.trim()) next.body = t('courses.error.required');
    if (channels.length === 0) next.channels = t('messages.error.channels');
    setErrors(next);
    if (!Object.keys(next).length) {
      send.reset();
      setConfirming(true);
    }
  }

  if (confirming) {
    const who =
      type === 'all'
        ? t('messages.confirm.all')
        : mine
          ? t('messages.confirm.mine')
          : list.format(ids.map(nameOf));
    const how = channels.length === 2 ? 'both' : channels[0]!;
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <span className="mb-1 grid size-10 place-items-center rounded-lg bg-brand-soft text-brand">
          <Megaphone className="size-5" aria-hidden />
        </span>
        <p className="text-[18px] leading-6 text-text">
          {t('messages.confirm.question', { who, how: t(`messages.confirm.how.${how}`) })}
        </p>
        <p className="text-label text-muted">
          {t('messages.confirm.body', { subject: subject.trim() })}
        </p>
        <div className="mt-4 flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button
            variant="secondary"
            disabled={send.isPending}
            onClick={() => setConfirming(false)}
          >
            {t('messages.confirm.back')}
          </Button>
          <Button loading={send.isPending} onClick={() => send.mutate()}>
            {t('messages.send')}
          </Button>
        </div>
      </div>
    );
  }

  const templateList = templates.data?.data ?? [];
  const choices = (options[type] ?? []).filter((o) => !ids.includes(o.id));

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {templateList.length ? (
        <Field label={t('messages.field.template')} helper={t('messages.field.templateHelp')}>
          {(props) => (
            <select
              {...props}
              value={templateId}
              onChange={(e) => {
                const template = templateList.find((x) => x.id === e.target.value);
                setTemplateId(e.target.value);
                if (template) {
                  setSubject(template.subject);
                  setBody(template.body);
                }
              }}
            >
              <option value="">{t('messages.field.noTemplate')}</option>
              {templateList.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}

      <fieldset>
        <legend className="mb-1.5 text-label font-medium text-text">
          {t('messages.field.to')}
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {types.map((value) => (
            <label
              key={value}
              className={cn(
                'flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-label has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand',
                type === value
                  ? 'border-brand bg-brand-soft font-semibold text-brand'
                  : 'border-border-strong bg-surface text-text hover:bg-canvas',
              )}
            >
              <input
                type="radio"
                name="audience"
                checked={type === value}
                onChange={() => pick(value)}
                className="sr-only"
              />
              {t(teacher && value === 'teacher' ? 'messages.to.mine' : `messages.to.${value}`)}
            </label>
          ))}
        </div>
        {type !== 'all' && !mine ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {ids.map((id) => (
              <span
                key={id}
                className="inline-flex h-8 items-center gap-1 rounded-full bg-info-soft pr-1 pl-3 text-label font-medium text-info"
              >
                {nameOf(id)}
                <button
                  type="button"
                  aria-label={t('messages.remove', { name: nameOf(id) })}
                  onClick={() => setIds(ids.filter((x) => x !== id))}
                  className="grid size-7 place-items-center rounded-full hover:bg-white/60"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            ))}
            {type === 'custom' ? (
              <FamilySearch
                exclude={ids}
                onPick={(family) => {
                  setIds([...ids, family.id]);
                  setFamilies([...families, family]);
                }}
              />
            ) : (
              <label className="relative inline-flex h-8 items-center gap-1 rounded-full px-2 text-label font-semibold text-brand hover:bg-brand-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand">
                <Plus className="size-4" aria-hidden />
                {t(`messages.add.${type as 'branch'}`)}
                <select
                  value=""
                  disabled={choices.length === 0}
                  onChange={(e) => e.target.value && setIds([...ids, e.target.value])}
                  className="absolute inset-0 cursor-pointer opacity-0"
                >
                  <option value="">{t(`messages.add.${type as 'branch'}`)}</option>
                  {choices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ) : null}
        {errors.audience ? <p className="mt-1.5 text-meta text-danger">{errors.audience}</p> : null}
      </fieldset>
      {refused ? <Notice tone="danger">{refused}</Notice> : null}

      <TextField
        label={t('messages.field.subject')}
        required
        maxLength={SUBJECT_MAX}
        value={subject}
        error={errors.subject ?? fields.subject}
        helper={`${subject.length} / ${SUBJECT_MAX}`}
        onChange={(e) => setSubject(e.target.value)}
      />
      <Field
        label={t('messages.field.body')}
        required
        error={errors.body ?? fields.body}
        helper={`${body.length.toLocaleString()} / ${BODY_MAX.toLocaleString()}`}
      >
        {(props) => (
          <textarea
            {...props}
            rows={6}
            maxLength={BODY_MAX}
            value={body}
            className={cn(props.className, 'h-auto min-h-[140px] py-2.5 sm:h-auto')}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>

      <fieldset>
        <legend className="mb-1.5 text-label font-medium text-text">
          {t('messages.field.sendBy')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['email', email, setEmail, Mail],
              ['portal', portal, setPortal, AppWindow],
            ] as const
          ).map(([name, on, set, Icon]) => (
            <label
              key={name}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-label text-text hover:bg-canvas"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => set(e.target.checked)}
                className="size-4 accent-brand"
              />
              <Icon className="size-4 text-muted" aria-hidden />
              {t(`messages.channel.${name}`)}
            </label>
          ))}
        </div>
        {errors.channels ? <p className="mt-1.5 text-meta text-danger">{errors.channels}</p> : null}
        <p className="mt-2 text-meta text-muted">{t('messages.field.sendByHelp')}</p>
      </fieldset>

      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit">{t('messages.send')}</Button>
      </div>
    </form>
  );
}

/** Find a family by name, for a message to chosen families. */
function FamilySearch({
  exclude,
  onPick,
}: {
  exclude: string[];
  onPick: (family: Option) => void;
}) {
  const { membership } = useOrg();
  const [q, setQ] = useState('');
  const term = q.trim();
  const results = useQuery({
    queryKey: ['search', membership.org.id, term, 8],
    queryFn: ({ signal }) =>
      api<SearchResults>('GET', orgApiPath(membership, `/search${query({ q: term, limit: 8 })}`), {
        signal,
      }),
    enabled: term.length >= 2,
  });
  const found = (results.data?.families ?? []).filter((f) => !exclude.includes(f.id));
  return (
    <div className="relative w-full sm:w-72">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
        aria-hidden
      />
      <input
        type="search"
        aria-label={t('messages.add.custom')}
        placeholder={t('messages.add.custom')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="h-11 w-full rounded-lg border border-border-strong bg-surface pr-3 pl-9 text-body text-text placeholder:text-subtle focus:outline-2 focus:outline-brand sm:h-9"
      />
      {term.length >= 2 && results.isSuccess ? (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-pop">
          {found.length === 0 ? (
            <li className="px-3 py-2.5 text-label text-muted">{t('messages.noFamilies')}</li>
          ) : (
            found.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick({ id: f.id, name: t('messages.familyName', { name: f.name }) });
                    setQ('');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-label text-text hover:bg-canvas"
                >
                  <UserRound className="size-4 text-muted" aria-hidden />
                  {t('messages.familyName', { name: f.name })}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
