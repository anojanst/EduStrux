import { CalendarCheck, Receipt, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '../components/Logo';
import { t } from '../i18n';

/**
 * Sign-in, sign-up, invitations and onboarding: a teal brand panel beside the form on wide
 * screens; on phones just the logo above it.
 */
export function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <aside className="hidden w-[420px] shrink-0 flex-col justify-between bg-sidebar p-10 text-sidebar-text lg:flex">
        <Logo inverted />
        {aside ?? <DefaultAside />}
        <p className="text-meta text-sidebar-text/80">{t('auth.aside.footer')}</p>
      </aside>
      <main className="flex flex-1 flex-col items-center px-4 py-8 sm:px-8 sm:py-12 lg:justify-center">
        <div className="mb-8 lg:hidden">
          <Logo />
        </div>
        <div className="w-full max-w-[440px]">{children}</div>
      </main>
    </div>
  );
}

function DefaultAside() {
  const points = [
    { Icon: CalendarCheck, text: t('auth.aside.timetable') },
    { Icon: Receipt, text: t('auth.aside.billing') },
    { Icon: Users, text: t('auth.aside.families') },
  ];
  return (
    <div>
      <h2 className="text-title font-normal text-white">{t('auth.aside.title')}</h2>
      <ul className="mt-8 flex flex-col gap-5">
        {points.map(({ Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-body">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-raised text-white">
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="pt-1.5">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
