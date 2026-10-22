import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { t, type MessageKey } from '../../i18n';
import { cn } from '../../lib/cn';
import { useOrg } from '../../lib/org';
import { OrganisationsSection } from './OrganisationsSection';
import { ProfileSection } from './ProfileSection';
import { ReverifyProvider } from './reverify';
import { SecuritySection } from './SecuritySection';

const SECTIONS = [
  { id: 'profile', label: 'profile.nav.profile', body: 'profile.section.profile' },
  { id: 'security', label: 'profile.nav.security', body: 'profile.section.security' },
  {
    id: 'organisations',
    label: 'profile.nav.organisations',
    body: 'profile.section.organisations',
  },
] as const satisfies readonly { id: string; label: MessageKey; body: MessageKey }[];
type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * The user's own account, in the app's design (the Figma Make profile page): Profile, Sign-in
 * and security, Organisations. On wide screens a menu on the left shows one section at a time
 * (`?section=`); on phones every section is stacked and the menu is a row of chips that jumps
 * to each. Clerk holds the account; sensitive changes ask "Confirm it's you" in our own dialog.
 */
export function ProfilePage() {
  const { me } = useOrg();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const requested = params.get('section');
  const selected: SectionId = SECTIONS.some((s) => s.id === requested)
    ? (requested as SectionId)
    : 'profile';

  function choose(id: SectionId) {
    setParams(id === 'profile' ? {} : { section: id }, { replace: true });
    // On phones every section is on the page: take the reader to it.
    if (window.matchMedia?.('(max-width: 767px)').matches) {
      document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  const content: Record<SectionId, ReactNode> = {
    profile: <ProfileSection fallbackEmail={me.email} />,
    security: <SecuritySection />,
    organisations: <OrganisationsSection />,
  };

  return (
    <ReverifyProvider>
      <div className="md:pt-1">
        <header className="mb-5 md:mb-7">
          <p className="text-meta font-bold tracking-[0.05em] text-brand uppercase">
            {t('profile.overline')}
          </p>
          <h1 className="mt-1.5 text-[23px] leading-[30px] font-normal tracking-[-0.02em] text-text md:text-title">
            {t('profile.title')}
          </h1>
        </header>

        <div className="md:grid md:grid-cols-[190px_minmax(0,720px)] md:items-start md:gap-[42px]">
          <nav
            aria-label={t('profile.nav.label')}
            className="-mx-4 mb-[22px] flex gap-[7px] overflow-x-auto px-4 [scrollbar-width:none] md:sticky md:top-6 md:mx-0 md:mb-0 md:flex-col md:gap-[3px] md:px-0"
          >
            {SECTIONS.map((section) => {
              const active = section.id === selected;
              return (
                <button
                  key={section.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => choose(section.id)}
                  className={cn(
                    'min-h-11 shrink-0 rounded-lg px-3.5 text-left text-label whitespace-nowrap transition-colors duration-150 md:min-h-10 md:px-3',
                    'max-md:border max-md:bg-surface',
                    active
                      ? 'bg-brand-soft font-semibold text-brand max-md:border-[#b8d4d2] max-md:bg-brand-soft'
                      : 'text-muted hover:text-text max-md:border-border',
                  )}
                >
                  {t(section.label)}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0">
            {SECTIONS.map((section) => (
              <section
                key={section.id}
                id={`section-${section.id}`}
                aria-labelledby={`section-${section.id}-title`}
                className={cn(
                  'mb-[34px] scroll-mt-20 md:mb-0',
                  section.id === selected ? 'md:block' : 'md:hidden',
                )}
              >
                <div className="mb-[15px]">
                  <h2
                    id={`section-${section.id}-title`}
                    className="text-section font-medium text-text"
                  >
                    {t(section.label)}
                  </h2>
                  <p className="mt-1 text-meta text-muted">{t(section.body)}</p>
                </div>
                {content[section.id]}
              </section>
            ))}
            <Button
              variant="secondary"
              className="mt-2.5 h-11 w-full md:hidden"
              icon={<LogOut className="size-4" />}
              onClick={() => {
                queryClient.clear();
                void signOut();
              }}
            >
              {t('common.signOut')}
            </Button>
          </div>
        </div>
      </div>
    </ReverifyProvider>
  );
}
