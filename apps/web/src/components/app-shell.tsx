'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { getDictionary, switchLocalePath, type Locale } from '@/lib/i18n';

function RiverMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 52 52" aria-hidden="true">
      <path
        className="brand-water"
        d="M5 30c8 0 9-12 18-12s9 12 18 12c3 0 5-1 7-4"
      />
      <path className="brand-bank" d="M8 39h36" />
      <circle cx="23" cy="18" r="3.5" />
    </svg>
  );
}

export function AppShell({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Locale;
}) {
  const dictionary = getDictionary(locale);
  const pathname = usePathname();
  const otherLocale: Locale = locale === 'zh-CN' ? 'en' : 'zh-CN';
  const languageHref = switchLocalePath(pathname, otherLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <div className="app-shell" lang={locale}>
      <a className="skip-link" href="#main-content">
        {dictionary.shell.skip}
      </a>
      <header className="app-header">
        <Link className="brand-lockup" href={`/${locale}/scenarios`}>
          <RiverMark />
          <span>
            <strong>{dictionary.brand.name}</strong>
            <small>{dictionary.brand.product}</small>
          </span>
        </Link>
        <nav className="global-nav" aria-label={dictionary.brand.product}>
          <Link href={`/${locale}/scenarios`}>{dictionary.nav.scenarios}</Link>
          <Link href={`/${locale}/runs`}>{dictionary.nav.runs}</Link>
          <Link href={`/${locale}/runs/run-yongding-spring-042/trace`}>
            {dictionary.nav.trace}
          </Link>
        </nav>
        <div className="header-actions">
          <span className="demo-source" title={dictionary.shell.demoDetail}>
            <i aria-hidden="true" />
            {dictionary.shell.demo}
          </span>
          <Link
            className="language-switch"
            href={languageHref}
            hrefLang={otherLocale}
            aria-label={`${dictionary.shell.language}：${dictionary.shell.otherLanguage}`}
          >
            {dictionary.shell.otherLanguage}
          </Link>
        </div>
      </header>
      <div className="boundary-strip" role="note">
        <span>{dictionary.shell.participantBoundary}</span>
        <span>{dictionary.shell.observerBoundary}</span>
      </div>
      {children}
      <footer className="app-footer">
        <span>{dictionary.footer.product}</span>
        <span>{dictionary.footer.boundary}</span>
      </footer>
    </div>
  );
}
