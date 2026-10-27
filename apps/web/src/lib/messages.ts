import type {
  Message,
  MessageDetail,
  MessageKind,
  MessageTemplate,
  NotificationSettings,
  StaffMember,
} from '@edustrux/shared';
import { utcToLocal } from '@edustrux/shared/dates';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '../i18n';
import { api } from './api';
import { useAllClasses, useSubjects, useTeachers } from './classes';
import { useFormat } from './format';
import { orgApiPath, useOrg } from './org';
import { namesOf, query, useBranches, useGradeLevels, type Page } from './people';
import { can } from './roles';

/** The messages the caller can read, newest first, a page at a time (`kind` narrows them). */
export function useMessages(kind: MessageKind | '') {
  const { membership } = useOrg();
  return useInfiniteQuery({
    queryKey: ['messages', membership.org.id, { kind }],
    queryFn: ({ pageParam, signal }) =>
      api<Page<Message>>(
        'GET',
        orgApiPath(membership, `/messages${query({ limit: 25, kind, cursor: pageParam })}`),
        { signal },
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** One message with each recipient's email status. */
export function useMessage(id: string) {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['messages', membership.org.id, id],
    queryFn: ({ signal }) =>
      api<MessageDetail>('GET', orgApiPath(membership, `/messages/${id}`), { signal }),
  });
}

/** The org's saved templates, for everyone who sends messages. */
export function useTemplates() {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['message-templates', membership.org.id],
    queryFn: ({ signal }) =>
      api<Page<MessageTemplate>>('GET', orgApiPath(membership, '/message-templates?limit=200'), {
        signal,
      }),
    enabled: can(membership.role, 'messages:write'),
    staleTime: 60_000,
  });
}

/** Which automatic messages go out, and when. */
export function useNotificationSettings() {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['notification-settings', membership.org.id],
    queryFn: ({ signal }) =>
      api<NotificationSettings>('GET', orgApiPath(membership, '/notification-settings'), {
        signal,
      }),
  });
}

/** After sending, or a change to the templates: the lists that show them. */
export function useRefreshMessages() {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['messages', 'message-templates'].map((name) =>
        queryClient.invalidateQueries({ queryKey: [name, membership.org.id] }),
      ),
    );
}

/**
 * "All families", "Albany", "Year 9 Maths +1" or "3 families": who a message went to, from the
 * names the caller can already read. A custom audience is a count of families.
 */
export function useAudienceLabel() {
  const { membership } = useOrg();
  const branches = useBranches();
  const grades = useGradeLevels();
  const subjects = useSubjects();
  const classes = useAllClasses();
  const teachers = useTeachers();
  const lists: Record<string, (id: string) => string> = {
    branch: namesOf(branches.data?.data),
    grade: namesOf(grades.data?.data),
    subject: namesOf(subjects.data?.data),
    class: namesOf(classes.data?.data),
    teacher: namesOf(teachers.data?.data),
  };
  return (audience: Message['audience']) => {
    const { type, ids } = audience;
    if (type === 'all') return t('messages.audience.all');
    if (type === 'custom') {
      return t(ids.length === 1 ? 'messages.audience.families.one' : 'messages.audience.families', {
        n: ids.length,
      });
    }
    if (type === 'teacher' && ids.length === 1 && ids[0] === membership.id) {
      return t('messages.audience.myClasses');
    }
    const first = lists[type]?.(ids[0] ?? '') || t(`messages.to.${type as 'branch'}`);
    return ids.length > 1 ? `${first} +${ids.length - 1}` : first;
  };
}

/**
 * Who sent a message: "System" for an automatic one, the caller for their own, else the staff
 * member's name for those who can read the team.
 */
export function useSenderName() {
  const { me, membership } = useOrg();
  const staff = useQuery({
    queryKey: ['staff', membership.org.id, { all: true }],
    queryFn: ({ signal }) =>
      api<Page<StaffMember>>('GET', orgApiPath(membership, '/staff?limit=200'), { signal }),
    enabled: can(membership.role, 'staff:read'),
    staleTime: 60_000,
  });
  return (message: Message) => {
    if (message.kind === 'automatic' || !message.sentByMembershipId) return t('messages.system');
    if (message.sentByMembershipId === membership.id) return me.name ?? me.email ?? '';
    const sender = staff.data?.data.find((m) => m.id === message.sentByMembershipId);
    return sender?.name ?? sender?.email ?? '';
  };
}

/** "Today 3:40 pm", "Mon 26 Oct" in the last week, else the date: when a message was sent. */
export function useSentAt() {
  const { org } = useOrg();
  const format = useFormat();
  const zone = org?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (instant: string) => {
    const { date, time } = utcToLocal(instant, zone);
    if (date === format.today) return t('messages.today', { time: format.time(time) });
    return format.daysUntil(date) >= -6 ? format.day(date) : format.date(date);
  };
}
