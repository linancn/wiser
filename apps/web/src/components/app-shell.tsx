'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { getDictionary, switchLocalePath, type Locale } from '@/lib/i18n';
import styles from './app-shell.module.css';
import { ThemeToggle } from './theme-toggle';

function RiverMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 52 52" aria-hidden="true">
      <path d="M5 30c8 0 9-12 18-12s9 12 18 12c3 0 5-1 7-4" />
      <path className={styles.bank} d="M8 39h36" />
      <circle cx="23" cy="18" r="3.5" />
    </svg>
  );
}

export function AppShell({
  authControl,
  children,
  locale,
}: {
  authControl?: ReactNode;
  children: ReactNode;
  locale: Locale;
}) {
  const dictionary = getDictionary(locale);
  const pathname = usePathname();
  const otherLocale: Locale = locale === 'zh-CN' ? 'en' : 'zh-CN';
  const languageHref = switchLocalePath(pathname, otherLocale);
  const dataFoundationActive = pathname.includes('/data-foundation');
  const platformActive =
    pathname.includes('/login') || pathname.includes('/auth/');

  return (
    <div className={styles.shell} lang={locale}>
      <a className={styles.skip} href="#main-content">
        {dictionary.shell.skip}
      </a>
      <header className={styles.header}>
        <Link className={styles.brand} href={`/${locale}/scenarios`}>
          <RiverMark />
          <span>
            <strong>{dictionary.brand.name}</strong>
            <small>{dictionary.brand.product}</small>
          </span>
        </Link>
        <nav className={styles.nav} aria-label={dictionary.shell.mainNav}>
          {dataFoundationActive ? (
            <Link href={`/${locale}/data-foundation`} aria-current="page">
              {dictionary.nav.overview}
            </Link>
          ) : (
            <>
              <Link
                href={`/${locale}/scenarios`}
                aria-current={
                  pathname.includes('/scenarios') ? 'page' : undefined
                }
              >
                {dictionary.nav.scenarios}
              </Link>
              <Link
                href={`/${locale}/runs`}
                aria-current={pathname.includes('/runs') ? 'page' : undefined}
              >
                {dictionary.nav.runs}
              </Link>
            </>
          )}
        </nav>
        <div className={styles.actions}>
          {authControl}
          <ThemeToggle locale={locale} />
          <Link
            className={styles.language}
            href={languageHref}
            hrefLang={otherLocale}
            aria-label={`${dictionary.shell.language}：${dictionary.shell.otherLanguage}`}
          >
            {dictionary.shell.otherLanguage}
          </Link>
        </div>
      </header>
      <nav
        className={styles.systemNav}
        aria-label={dictionary.systems.navigation}
      >
        <strong>{dictionary.systems.label}</strong>
        <Link
          href={`/${locale}/scenarios`}
          aria-current={
            dataFoundationActive || platformActive ? undefined : 'page'
          }
        >
          {dictionary.systems.agentExcon}
        </Link>
        <Link
          href={`/${locale}/data-foundation`}
          aria-current={dataFoundationActive ? 'page' : undefined}
        >
          {dictionary.systems.dataFoundation}
        </Link>
      </nav>
      {children}
      <footer className={styles.footer}>
        <span>{dictionary.footer.product}</span>
        <span>{dictionary.footer.boundary}</span>
      </footer>
    </div>
  );
}
