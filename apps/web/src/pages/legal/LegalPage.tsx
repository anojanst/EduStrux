import { ChevronDown } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Logo } from '../../components/Logo';
import { t } from '../../i18n';
import { LEGAL_DOCUMENTS, type LegalBlock, type LegalDocument } from './documents';

const LINKS: {
  slug: LegalDocument['slug'];
  label: 'legal.terms' | 'legal.privacy' | 'legal.dpa';
}[] = [
  { slug: 'terms', label: 'legal.terms' },
  { slug: 'privacy', label: 'legal.privacy' },
  { slug: 'dpa', label: 'legal.dpa' },
];

/**
 * A legal document (TUI-85) at /terms, /privacy or /dpa, public: no sign-in. The title and date,
 * a plain-English summary, then numbered sections, with a sticky list of them beside the text on
 * wide screens and a collapsible "On this page" above it on phones.
 */
export function LegalPage({ slug }: { slug: LegalDocument['slug'] }) {
  const doc = LEGAL_DOCUMENTS[slug];
  useEffect(() => {
    document.title = `${doc.title} · ${t('app.name')}`;
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [doc]);

  const contents = (
    <ol className="flex flex-col gap-1.5 text-label">
      {doc.sections.map((s, i) => (
        <li key={s.id}>
          <a href={`#${s.id}`} className="flex gap-2 text-muted hover:text-brand">
            <span className="w-5 shrink-0 text-subtle tabular-nums">{i + 1}.</span>{' '}
            <span>{s.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="min-h-dvh bg-surface text-text">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-8">
          <Link to="/" aria-label={t('app.name')}>
            <Logo />
          </Link>
          <Link to="/sign-in" className="text-label font-semibold text-brand hover:underline">
            {t('legal.signIn')}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
        <h1 className="font-brand text-[34px] leading-tight font-extrabold tracking-[-0.6px] sm:text-[44px]">
          {doc.title}
        </h1>
        <p className="mt-2 text-label text-muted">{t('legal.updated', { date: doc.updated })}</p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-16">
          <nav aria-label={t('legal.onThisPage')} className="hidden lg:block">
            <div className="sticky top-24">
              <p className="mb-3 text-meta font-semibold tracking-[0.05em] text-muted uppercase">
                {t('legal.onThisPage')}
              </p>
              {contents}
            </div>
          </nav>

          <article className="max-w-[68ch]">
            <section className="rounded-xl bg-brand-soft p-5 sm:p-6">
              <h2 className="text-label font-semibold text-brand">{t('legal.summary')}</h2>
              <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-body leading-relaxed">
                {doc.summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>

            <details className="group mt-6 rounded-xl border border-border lg:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-label font-semibold">
                {t('legal.onThisPage')}
                <ChevronDown
                  className="size-4 text-muted transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="border-t border-border px-4 py-3">{contents}</div>
            </details>

            {doc.sections.map((s, i) => (
              <section key={s.id} id={s.id} className="scroll-mt-24 pt-10">
                <h2 className="flex gap-3 text-section font-bold">
                  <span className="text-subtle tabular-nums">{i + 1}.</span> <span>{s.title}</span>
                </h2>
                <div className="mt-3 flex flex-col gap-3 text-[17px] leading-[1.7]">
                  {s.blocks.map((block, j) => (
                    <Block key={j} block={block} />
                  ))}
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>

      <LegalFooter />
    </div>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === 'string') return <p>{block}</p>;
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-6">
      {block.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function LegalFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-meta text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>{t('legal.madeIn')}</p>
        <LegalLinks />
      </div>
    </footer>
  );
}

/** The three documents as a row of links: the legal pages' footer, and under sign-in and sign-up. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label={t('legal.documents')} className={className}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted">
        {LINKS.map(({ slug, label }) => (
          <li key={slug}>
            <Link to={`/${slug}`} className="hover:text-brand hover:underline">
              {t(label)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
