'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { getDictionary, switchLocalePath, type Locale } from '@/lib/i18n';
import {
  activeSystemForPath,
  contextRoutesForPath,
  isContextRouteActive,
  isPrimarySystemActive,
  PRIMARY_SYSTEMS,
} from '@/lib/navigation';
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
  const activeSystem = activeSystemForPath(pathname);
  const contextRoutes = contextRoutesForPath(pathname);
  const contextLabel =
    activeSystem === 'data-foundation'
      ? dictionary.systems.dataFoundation
      : dictionary.systems.agentExcon;

  return (
    <div className={styles.shell} lang={locale}>
      <a className={styles.skip} href="#main-content">
        {dictionary.shell.skip}
      </a>
      <header className={styles.header}>
        <Link className={styles.brand} href={`/${locale}`}>
          <RiverMark />
          <span>
            <strong>{dictionary.brand.name}</strong>
            <small>{dictionary.brand.product}</small>
          </span>
        </Link>
        <nav
          className={styles.systemNav}
          aria-label={dictionary.systems.navigation}
        >
          {PRIMARY_SYSTEMS.map((system) => (
            <Link
              key={system.id}
              href={`/${locale}${system.path}`}
              aria-current={
                isPrimarySystemActive(pathname, system.id) ? 'page' : undefined
              }
            >
              {dictionary.systems[system.labelKey]}
            </Link>
          ))}
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
      {contextRoutes.length === 0 ? null : (
        <nav
          className={styles.contextNav}
          aria-label={
            activeSystem === 'data-foundation'
              ? dictionary.dataFoundation.navigation.label
              : dictionary.shell.mainNav
          }
        >
          <div className={styles.contextTrack}>
            <span className={styles.contextLabel}>{contextLabel}</span>
            {contextRoutes.map((route, index) => {
              const previous = contextRoutes[index - 1];
              const showGroup =
                activeSystem === 'data-foundation' &&
                route.group !== 'overview' &&
                route.group !== previous?.group;
              const routeLabel =
                activeSystem === 'data-foundation'
                  ? dictionary.dataFoundation.navigation[
                      route.key as keyof typeof dictionary.dataFoundation.navigation
                    ]
                  : dictionary.nav[route.key as 'runs' | 'scenarios'];
              return (
                <span className={styles.contextItem} key={route.key}>
                  {showGroup ? (
                    <span className={styles.contextGroup}>
                      {
                        dictionary.dataFoundation.navigationGroups[
                          route.group as 'explore' | 'manage' | 'services'
                        ]
                      }
                    </span>
                  ) : null}
                  <Link
                    href={`/${locale}${
                      activeSystem === 'data-foundation'
                        ? `/data-foundation${route.path}`
                        : route.path
                    }`}
                    aria-current={
                      isContextRouteActive(pathname, route) ? 'page' : undefined
                    }
                  >
                    {routeLabel}
                  </Link>
                </span>
              );
            })}
          </div>
        </nav>
      )}
      {children}
      <footer className={styles.footer}>
        <span>{dictionary.footer.product}</span>
        <span>{dictionary.footer.boundary}</span>
      </footer>
    </div>
  );
}
