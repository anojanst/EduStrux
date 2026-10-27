import type {
  Family,
  Message,
  MessageKind,
  MessageRecipient,
  RecipientEmailStatus,
} from '@edustrux/shared';
import { MESSAGE_KINDS } from '@edustrux/shared';
import { utcToLocal } from '@edustrux/shared/dates';
import { useQuery } from '@tanstack/react-query';
import { AppWindow, Mail, Megaphone, Plus, Zap } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageError, PageHeader } from '../../components/PageState';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import {
  useAudienceLabel,
  useMessage,
  useMessages,
  useSenderName,
  useSentAt,
} from '../../lib/messages';
import { orgApiPath, useOrg } from '../../lib/org';
import { type Page } from '../../lib/people';
import { can } from '../../lib/roles';
import { EmptyState, SkeletonRows } from '../people/parts';
import { AutomaticTab, TemplatesTab } from './MessageSettings';
import { NewAnnouncementDialog } from './NewAnnouncement';

const TABS = ['sent', 'templates', 'automatic'] as const;
type Tab = (typeof TABS)[number];

/**
 * Messages (TUI-128): the announcements staff send to families and the automatic emails, with
 * each one's delivery. The owner also keeps the templates and sets the automatic messages.
 * Parents read theirs in the portal.
 */
export function MessagesPage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'messages:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <Messages />;
}

function Messages() {
  const { membership } = useOrg();
  const [params, setParams] = useSearchParams();
  const [composing, setComposing] = useState(false);
  const owner = can(membership.role, 'org:write');
  const sends = can(membership.role, 'messages:write');
  const tabs = owner ? TABS : (['sent'] as const);
  const tab: Tab = tabs.find((name) => name === params.get('tab')) ?? 'sent';

  return (
    <>
      <PageHeader
        overline={t('messages.overline')}
        title={t('nav.messages')}
        subtitle={t('messages.subtitle')}
        action={
          sends ? (
            <Button
              className="w-full sm:w-auto"
              icon={<Plus className="size-4" />}
              onClick={() => setComposing(true)}
            >
              {t('messages.new')}
            </Button>
          ) : null
        }
      />
      {tabs.length > 1 ? (
        <div role="tablist" className="mb-4 flex gap-6 border-b border-border">
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setParams(name === 'sent' ? {} : { tab: name }, { replace: true })}
              className={cn(
                '-mb-px h-11 border-b-2 px-0.5 text-body',
                tab === name
                  ? 'border-brand font-semibold text-brand'
                  : 'border-transparent text-muted hover:text-text',
              )}
            >
              {t(`messages.tab.${name}`)}
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'sent' ? (
        <SentTab filters={owner} onNew={sends ? () => setComposing(true) : undefined} />
      ) : tab === 'templates' ? (
        <TemplatesTab />
      ) : (
        <AutomaticTab />
      )}
      <NewAnnouncementDialog open={composing} onClose={() => setComposing(false)} />
    </>
  );
}

/**
 * The messages sent, newest first. The owner, who also sees the automatic ones, can filter to
 * announcements or automatic; anyone else sees only the announcements they sent.
 */
function SentTab({ filters, onNew }: { filters: boolean; onNew?: () => void }) {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<Message | null>(null);
  const sentLine = useSentLine();
  const kind = (filters && MESSAGE_KINDS.find((k) => k === params.get('kind'))) || '';
  const list = useMessages(kind);
  const messages = list.data?.pages.flatMap((p) => p.data) ?? [];

  const setKind = (next: MessageKind | '') =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next) out.set('kind', next);
        else out.delete('kind');
        return out;
      },
      { replace: true },
    );

  return (
    <>
      {filters ? (
        <div
          role="group"
          aria-label={t('messages.filter')}
          className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          {(['', ...MESSAGE_KINDS] as const).map((value) => (
            <button
              key={value || 'all'}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={cn(
                'h-9 shrink-0 rounded-full border px-3.5 text-label whitespace-nowrap transition-colors',
                kind === value
                  ? 'border-brand bg-brand-soft font-semibold text-brand'
                  : 'border-border-strong bg-surface text-secondary-text hover:bg-canvas',
              )}
            >
              {t(value ? `messages.kind.${value}` : 'billing.filter.all')}
            </button>
          ))}
        </div>
      ) : null}
      {list.isError ? (
        <PageError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <Card flush className="overflow-hidden">
          {list.isPending ? (
            <SkeletonRows rows={5} />
          ) : messages.length === 0 ? (
            <EmptyState
              Icon={Megaphone}
              title={t('messages.empty')}
              body={t('messages.emptyBody')}
              action={
                onNew ? (
                  <Button icon={<Plus className="size-4" />} onClick={onNew}>
                    {t('messages.new')}
                  </Button>
                ) : null
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {messages.map((message) => (
                <li key={message.id}>
                  <MessageRow message={message} onOpen={() => setOpen(message)} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {list.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('common.loadMore')}
          </Button>
        </div>
      ) : null}
      <Dialog
        open={open !== null}
        wide
        onClose={() => setOpen(null)}
        title={open?.subject ?? ''}
        subtitle={open ? sentLine(open) : undefined}
      >
        {open ? <MessageBody id={open.id} message={open} /> : null}
      </Dialog>
    </>
  );
}

/** "Email", "Parent portal" or both, as icons with their names for screen readers. */
function Channels({ message }: { message: Message }) {
  return (
    <span className="flex items-center gap-1.5 text-muted">
      {message.channels.map((channel) => {
        const Icon = channel === 'email' ? Mail : AppWindow;
        return (
          <span key={channel} title={t(`messages.channel.${channel}`)}>
            <Icon className="size-4" aria-hidden />
            <span className="sr-only">{t(`messages.channel.${channel}`)}</span>
          </span>
        );
      })}
    </span>
  );
}

const count = (n: number) => t(n === 1 ? 'messages.recipients.one' : 'messages.recipients', { n });

/** A sent message (Figma `msg-row`): what it was, who it went to, how, and when. */
function MessageRow({ message, onOpen }: { message: Message; onOpen: () => void }) {
  const audience = useAudienceLabel();
  const sender = useSenderName();
  const sentAt = useSentAt();
  const automatic = message.kind === 'automatic';
  const Icon = automatic ? Zap : Megaphone;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-3 text-left hover:bg-canvas xl:grid-cols-[36px_minmax(0,1fr)_minmax(0,180px)_52px_100px_116px] xl:px-4"
    >
      <span
        className={cn(
          'grid size-9 place-items-center rounded-lg',
          automatic ? 'bg-canvas text-muted' : 'bg-brand-soft text-brand',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col items-start gap-1">
        <b className="max-w-full truncate text-body font-semibold text-text">{message.subject}</b>
        <span className="max-w-full truncate text-meta text-muted">{message.body}</span>
        {message.event ? <Badge>{t(`messages.event.${message.event}`)}</Badge> : null}
      </span>
      <span className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-2 xl:col-start-auto xl:row-start-auto [&>span:first-child]:max-w-full">
        <Badge tone="info">
          <span className="truncate">{audience(message.audience)}</span>
        </Badge>
        <span className="xl:hidden">
          <Channels message={message} />
        </span>
        <span className="text-meta text-muted xl:hidden">{count(message.recipientCount)}</span>
      </span>
      <span className="hidden xl:block">
        <Channels message={message} />
      </span>
      <span className="hidden text-meta text-muted xl:block">{count(message.recipientCount)}</span>
      <span className="col-start-3 row-start-1 flex flex-col items-end self-start text-right xl:col-start-auto xl:row-start-auto xl:self-center">
        <time className="text-meta font-semibold whitespace-nowrap text-text">
          {sentAt(message.createdAt)}
        </time>
        <small className="text-meta text-muted">{sender(message)}</small>
      </span>
    </button>
  );
}

/** "Sent Mon 26 Oct, 3:40 pm by Olivia Chen · Email and portal". */
function useSentLine() {
  const { org } = useOrg();
  const format = useFormat();
  const sender = useSenderName();
  const zone = org?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (message: Message) => {
    const { date, time } = utcToLocal(message.createdAt, zone);
    const how = message.channels.length === 2 ? 'both' : message.channels[0]!;
    const sent = t('messages.sentLine', {
      when: `${format.day(date)}, ${format.time(time)}`,
      who: sender(message),
    });
    return `${sent} · ${t(`messages.how.${how}`)}`;
  };
}

const STATUS_TONES: Record<
  RecipientEmailStatus,
  'success' | 'info' | 'neutral' | 'danger' | 'warning'
> = {
  delivered: 'success',
  sent: 'info',
  queued: 'neutral',
  bounced: 'danger',
  failed: 'danger',
  complained: 'warning',
  skipped: 'neutral',
};

/** The delivery tiles in reading order; the first four show whatever their count. */
const TILES: RecipientEmailStatus[] = [
  'delivered',
  'sent',
  'bounced',
  'skipped',
  'queued',
  'failed',
  'complained',
];
const ALWAYS = TILES.slice(0, 4);

/** Every page of the families the caller reaches, to name each recipient's family. */
async function allFamilies(path: string, signal: AbortSignal) {
  const families: Family[] = [];
  let cursor = '';
  do {
    const url = `${path}?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page = await api<Page<Family>>('GET', url, { signal });
    families.push(...page.data);
    cursor = page.nextCursor ?? '';
  } while (cursor);
  return families;
}

/** The message in full, its delivery counts and each recipient (Figma `msg-detail`). */
function MessageBody({ id, message }: { id: string; message: Message }) {
  const { membership } = useOrg();
  const detail = useMessage(id);
  const [status, setStatus] = useState<RecipientEmailStatus | ''>('');
  const families = useQuery({
    queryKey: ['families', membership.org.id, { all: true }],
    queryFn: ({ signal }) => allFamilies(orgApiPath(membership, '/families'), signal),
    enabled: can(membership.role, 'people:read'),
    staleTime: 60_000,
  });
  const familyName = new Map(families.data?.map((f) => [f.id, f.name]));
  const emailed = message.channels.includes('email');

  return (
    <>
      <p className="text-body whitespace-pre-line text-text">{message.body}</p>
      {detail.isError ? (
        <PageError error={detail.error} onRetry={() => void detail.refetch()} />
      ) : detail.isPending ? (
        <div className="mt-5">
          <SkeletonRows rows={3} />
        </div>
      ) : (
        <>
          {emailed ? (
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {TILES.filter((s) => ALWAYS.includes(s) || detail.data.delivery[s] > 0).map((s) => (
                <div
                  key={s}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border p-3"
                >
                  <span className="flex flex-col items-start gap-2">
                    <span className="text-meta text-muted">{t(`messages.status.${s}`)}</span>
                    <Badge tone={STATUS_TONES[s]}>{t(`messages.status.${s}`)}</Badge>
                  </span>
                  <strong className="text-[20px] leading-7 font-semibold text-text tabular-nums">
                    {detail.data.delivery[s]}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-5 text-meta text-muted">{t('messages.portalOnly')}</p>
          )}
          <div className="mt-6 mb-2.5 flex items-center justify-between gap-3">
            <h3 className="text-section font-medium text-text">{t('messages.recipientsTitle')}</h3>
            {emailed ? (
              <select
                aria-label={t('messages.statusFilter')}
                value={status}
                onChange={(e) => setStatus(e.target.value as RecipientEmailStatus | '')}
                className="h-11 rounded-lg border border-border-strong bg-surface px-3 text-label text-text sm:h-9"
              >
                <option value="">{t('messages.allStatuses')}</option>
                {TILES.filter((s) => detail.data.delivery[s] > 0).map((s) => (
                  <option key={s} value={s}>
                    {t(`messages.status.${s}`)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <Recipients
            recipients={detail.data.recipients.filter((r) => !status || r.emailStatus === status)}
            familyName={(familyId) => {
              const name = familyName.get(familyId);
              return name ? t('messages.familyName', { name }) : '';
            }}
          />
        </>
      )}
    </>
  );
}

/** Each guardian it went to: their email, family, email status and when it was delivered. */
function Recipients({
  recipients,
  familyName,
}: {
  recipients: MessageRecipient[];
  familyName: (id: string) => string;
}) {
  const { org } = useOrg();
  const format = useFormat();
  const zone = org?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const deliveredAt = (instant: string | null) => {
    if (!instant) return '—';
    const { date, time } = utcToLocal(instant, zone);
    return date === format.today ? format.time(time) : `${format.day(date)} ${format.time(time)}`;
  };
  if (recipients.length === 0) {
    return <p className="py-4 text-body text-muted">{t('messages.noRecipients')}</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_130px_96px] gap-3 bg-canvas px-3.5 py-2 text-meta font-semibold text-muted md:grid">
        <span>{t('messages.col.email')}</span>
        <span>{t('messages.col.family')}</span>
        <span>{t('messages.col.status')}</span>
        <span>{t('messages.col.delivered')}</span>
      </div>
      <ul className="divide-y divide-border">
        {recipients.map((r) => (
          <li
            key={r.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3.5 py-2.5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_130px_96px]"
          >
            <span className="flex min-w-0 flex-col">
              <b className="truncate text-label font-semibold text-text">{r.email ?? '—'}</b>
              {r.error ? <small className="text-meta text-muted">{r.error}</small> : null}
              <small className="text-meta text-muted md:hidden">{familyName(r.familyId)}</small>
            </span>
            <span className="hidden truncate text-label text-text md:block">
              {familyName(r.familyId)}
            </span>
            <span className="row-span-2 justify-self-end md:row-span-1 md:justify-self-start">
              {r.emailStatus ? (
                <Badge tone={STATUS_TONES[r.emailStatus]}>
                  {t(
                    r.emailStatus === 'skipped'
                      ? 'messages.noEmail'
                      : `messages.status.${r.emailStatus}`,
                  )}
                </Badge>
              ) : (
                <Badge>{t('messages.channel.portal')}</Badge>
              )}
            </span>
            <span className="text-meta text-muted md:text-label">
              <span className="md:hidden">{t('messages.col.delivered')}: </span>
              {deliveredAt(r.deliveredAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
