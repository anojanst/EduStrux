import type { SearchResults } from '@edustrux/shared';
import { useQuery } from '@tanstack/react-query';
import { CornerDownLeft, Search, UserRound, UsersRound, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { t } from '../i18n';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { orgApiPath, useOrg } from '../lib/org';
import { query, usePeoplePaths } from '../lib/people';
import { Avatar } from './ui/Avatar';
import { Spinner } from './ui/Spinner';

type Item = {
  key: string;
  group: string;
  title: string;
  meta: string;
  to: string;
  kind: 'family' | 'student' | 'guardian';
};

/**
 * The global search (ui-design.md §5): families, students and guardians the caller reaches, from
 * `GET /search`. Opened from the top bar or with Ctrl/⌘ K; arrow keys move, Enter opens.
 */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const { membership } = useOrg();
  const navigate = useNavigate();
  const paths = usePeoplePaths();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 200);
    return () => clearTimeout(timer);
  }, [typed]);
  useEffect(() => input.current?.focus(), []);

  const results = useQuery({
    queryKey: ['search', membership.org.id, q, 5],
    queryFn: ({ signal }) =>
      api<SearchResults>('GET', orgApiPath(membership, `/search${query({ q, limit: 5 })}`), {
        signal,
      }),
    enabled: q.length > 0,
  });

  const items: Item[] = results.data
    ? [
        ...results.data.families.map((f) => ({
          key: f.id,
          kind: 'family' as const,
          group: t('search.families'),
          title: t('people.familyName', { name: f.name }),
          meta: f.bankReference ? t('people.bankReference', { ref: f.bankReference }) : '',
          to: paths.family(f.id),
        })),
        ...results.data.students.map((s) => ({
          key: s.id,
          kind: 'student' as const,
          group: t('search.students'),
          title: `${s.firstName} ${s.lastName}`,
          meta: t('people.familyName', { name: s.familyName }),
          to: paths.student(s.id),
        })),
        ...results.data.guardians.map((g) => ({
          key: g.id,
          kind: 'guardian' as const,
          group: t('search.guardians'),
          title: `${g.firstName} ${g.lastName}`,
          meta: [t('people.familyName', { name: g.familyName }), g.phone]
            .filter(Boolean)
            .join(' · '),
          to: paths.family(g.familyId),
        })),
      ]
    : [];
  useEffect(() => setActive(0), [results.data]);

  function open(item: Item | undefined) {
    if (!item) return;
    onClose();
    navigate(item.to);
  }

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label={t('common.close')}
        tabIndex={-1}
        className="absolute inset-0 bg-[rgba(12,26,28,0.48)]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('search.title')}
        className="absolute inset-0 flex flex-col bg-surface md:inset-auto md:top-[12vh] md:left-1/2 md:max-h-[70vh] md:w-[600px] md:-translate-x-1/2 md:rounded-xl md:shadow-pop"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, items.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            open(items[active]);
          }
        }}
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <Search className="size-5 text-subtle" aria-hidden />
          <input
            ref={input}
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-activedescendant={items[active] ? `${listId}-${items[active].key}` : undefined}
            aria-label={t('search.title')}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t('search.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-subtle md:text-[15px]"
          />
          {results.isFetching ? <Spinner className="size-4 text-muted" /> : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="grid size-9 place-items-center rounded-lg text-muted hover:bg-canvas md:hidden"
          >
            <X className="size-5" aria-hidden />
          </button>
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-meta text-muted md:block">
            Esc
          </kbd>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!q ? (
            <p className="px-3 py-6 text-center text-body text-muted">{t('search.hint')}</p>
          ) : results.isError ? (
            <p className="px-3 py-6 text-center text-body text-muted">{t('error.generic')}</p>
          ) : results.data && items.length === 0 ? (
            <p className="px-3 py-6 text-center text-body text-muted">{t('search.none', { q })}</p>
          ) : (
            <ul id={listId} role="listbox" aria-label={t('search.title')}>
              {items.map((item, i) => (
                <li key={item.key} role="presentation">
                  {i === 0 || items[i - 1]!.group !== item.group ? (
                    <p className="px-3 pt-3 pb-1 text-meta font-semibold tracking-[0.05em] text-muted uppercase">
                      {item.group}
                    </p>
                  ) : null}
                  <div
                    id={`${listId}-${item.key}`}
                    role="option"
                    aria-selected={i === active}
                    tabIndex={-1}
                    onMouseMove={() => setActive(i)}
                    onClick={() => open(item)}
                    className={cn(
                      'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2',
                      i === active ? 'bg-brand-soft' : null,
                    )}
                  >
                    {item.kind === 'student' ? (
                      <Avatar name={item.title} className="size-8 text-meta" />
                    ) : (
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                        {item.kind === 'family' ? (
                          <UsersRound className="size-4" aria-hidden />
                        ) : (
                          <UserRound className="size-4" aria-hidden />
                        )}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <b className="truncate text-body font-semibold text-text">{item.title}</b>
                      {item.meta ? (
                        <small className="truncate text-meta text-muted">{item.meta}</small>
                      ) : null}
                    </span>
                    {i === active ? (
                      <CornerDownLeft className="hidden size-4 text-muted md:block" aria-hidden />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="hidden shrink-0 border-t border-border px-4 py-2.5 text-meta text-muted md:block">
          {t('search.keys')}
        </p>
      </div>
    </div>
  );
}
