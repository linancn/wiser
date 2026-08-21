'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { getDictionary, switchLocalePath, type Locale } from '@/lib/i18n';
import type { WebDataMode } from '@/lib/read-model-source';
import styles from './app-shell.module.css';

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
  children,
  locale,
  mode,
}: {
  children: ReactNode;
  locale: Locale;
  mode: WebDataMode;
}) {
  const dictionary = getDictionary(locale);
  const pathname = usePathname();
  const otherLocale: Locale = locale === 'zh-CN' ? 'en' : 'zh-CN';
  const languageHref = switchLocalePath(pathname, otherLocale);

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
          <Link
            href={`/${locale}/scenarios`}
            aria-current={pathname.includes('/scenarios') ? 'page' : undefined}
          >
            {dictionary.nav.scenarios}
          </Link>
          <Link
            href={`/${locale}/runs`}
            aria-current={pathname.includes('/runs') ? 'page' : undefined}
          >
            {dictionary.nav.runs}
          </Link>
        </nav>
        <div className={styles.actions}>
          <span
            className={styles.source}
            data-mode={mode}
            title={
              mode === 'reference'
                ? dictionary.shell.demoDetail
                : dictionary.shell.liveDetail
            }
          >
            {mode === 'reference'
              ? dictionary.shell.demo
              : dictionary.shell.live}
          </span>
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
      {children}
      <footer className={styles.footer}>
        <span>{dictionary.footer.product}</span>
        <span>{dictionary.footer.boundary}</span>
      </footer>
    </div>
  );
}
