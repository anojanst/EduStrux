import type { PortalMessage } from '@edustrux/shared';
import { utcToLocal } from '@edustrux/shared/dates';
import { useClerk } from '@clerk/react';
import { ChevronRight, LogOut, Mail, UserRound, UsersRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { PageError } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { t } from '../../i18n';
import { useFormat } from '../../lib/format';
import { useOrg } from '../../lib/org';
import { usePortalChildren, usePortalMessages, usePortalPaths } from '../../lib/portal';
import { SkeletonRows } from '../people/parts';
import { PortalHeading } from './parts';

/** "Today", or the day a message was sent, in the org's timezone. */
function useSentOn() {
  const { org } = useOrg();
  const format = useFormat();
  const zone = org?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (instant: string) => {
    const date = utcToLocal(instant, zone).date;
    return date === format.today ? t('portal.today') : format.day(date);
  };
}

/**
 * The family's messages (TUI-126, Figma "Messages"): announcements and automatic messages, newest
 * first. The portal can't reply; a message opens to read in full.
 */
export function PortalMessages() {
  const { membership } = useOrg();
  const messages = usePortalMessages();
  const sentOn = useSentOn();
  const [open, setOpen] = useState<PortalMessage | null>(null);
  const list = messages.data?.data ?? [];

  return (
    <div className="max-w-[880px]">
      <PortalHeading overline={t('portal.messages.overline')} title={t('nav.messages')} />
      {messages.isError ? (
        <PageError error={messages.error} onRetry={() => void messages.refetch()} />
      ) : (
        <Card flush className="overflow-hidden">
          {messages.isPending ? (
            <SkeletonRows rows={3} />
          ) : list.length === 0 ? (
            <p className="flex flex-col items-center px-5 py-10 text-center text-body text-muted">
              <Mail className="mb-2 size-5 text-brand" aria-hidden />
              {t('portal.messages.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {list.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(message)}
                    className="grid min-h-[72px] w-full grid-cols-[1fr_auto_20px] items-center gap-2.5 px-3.5 py-3 text-left hover:bg-canvas"
                  >
                    <span className="flex min-w-0 flex-col">
                      <b className="truncate text-label font-semibold text-text">
                        {message.subject}
                      </b>
                      <small className="mt-1 text-meta text-muted">{membership.org.name}</small>
                      <span className="mt-1 truncate text-label text-muted">{message.body}</span>
                    </span>
                    <time className="self-start pt-0.5 text-meta text-muted">
                      {sentOn(message.createdAt)}
                    </time>
                    <ChevronRight className="size-4 text-subtle" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <p className="mt-3 text-meta text-muted">{t('portal.messages.reply')}</p>

      {open ? (
        <Dialog
          open
          wide
          onClose={() => setOpen(null)}
          title={open.subject}
          subtitle={`${membership.org.name} · ${sentOn(open.createdAt)}`}
        >
          <p className="text-body whitespace-pre-line text-text">{open.body}</p>
          <p className="mt-5 text-meta text-muted">{t('portal.messages.reply')}</p>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * More (TUI-126, Figma "More"): the parent's profile, their family, and signing out. Consents
 * and the centre's contact details wait for their own screens.
 */
export function PortalMore() {
  const { me } = useOrg();
  const { signOut } = useClerk();
  const paths = usePortalPaths();
  const children = usePortalChildren();
  const kids = children.data?.data ?? [];
  const families = [...new Set(kids.map((k) => k.familyName))];

  return (
    <div className="max-w-[880px]">
      <PortalHeading overline={t('portal.more.overline')} title={t('nav.more')} />
      <div className="flex flex-col gap-2.5">
        <MoreRow
          Icon={UserRound}
          title={t('portal.more.profile')}
          meta={[me.name, me.email].filter(Boolean).join(' · ')}
          to={paths.profile}
        />
        {kids.length ? (
          <MoreRow
            Icon={UsersRound}
            title={t('portal.more.family')}
            meta={[
              families.map((name) => t('portal.more.familyName', { name })).join(', '),
              t(kids.length === 1 ? 'portal.more.children.one' : 'portal.more.children', {
                n: kids.length,
              }),
            ].join(' · ')}
          />
        ) : null}
      </div>
      <Button
        variant="secondary"
        className="mt-2.5 h-11 w-full"
        icon={<LogOut className="size-4" />}
        onClick={() => void signOut()}
      >
        {t('common.signOut')}
      </Button>
    </div>
  );
}

function MoreRow({
  Icon,
  title,
  meta,
  to,
}: {
  Icon: typeof Mail;
  title: string;
  meta: ReactNode;
  to?: string;
}) {
  const row =
    'grid min-h-[66px] grid-cols-[24px_1fr_20px] items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-2.5';
  const body = (
    <>
      <Icon className="size-5 text-brand" aria-hidden />
      <span className="flex min-w-0 flex-col">
        <b className="text-label font-semibold text-text">{title}</b>
        <small className="mt-1 truncate text-meta text-muted">{meta}</small>
      </span>
      {to ? <ChevronRight className="size-4 text-subtle" aria-hidden /> : <span />}
    </>
  );
  return to ? (
    <Link to={to} className={`${row} hover:bg-canvas`}>
      {body}
    </Link>
  ) : (
    <div className={row}>{body}</div>
  );
}
