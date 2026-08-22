'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { DATA_FOUNDATION_ROUTES } from '@/lib/data-foundation';
import { getDictionary, type Locale } from '@/lib/i18n';

import styles from './data-foundation-nav.module.css';

function activeRoute(pathname: string, locale: Locale, path: string): boolean {
  const base = `/${locale}/data-foundation`;
  if (path === '') return pathname === base;
  if (path === '/catalog') {
    return (
      pathname.startsWith(`${base}/catalog`) ||
      pathname.startsWith(`${base}/lineage`)
    );
  }
  if (path === '/ingestions') {
    return (
      pathname.startsWith(`${base}/ingestions`) ||
      pathname.startsWith(`${base}/operations`)
    );
  }
  return pathname === `${base}${path}`;
}

export function DataFoundationNav({ locale }: { readonly locale: Locale }) {
  const pathname = usePathname();
  const copy = getDictionary(locale).dataFoundation.navigation;
  const base = `/${locale}/data-foundation`;

  return (
    <nav className={styles.nav} aria-label={copy.label}>
      <div className={styles.track}>
        {DATA_FOUNDATION_ROUTES.map((route) => (
          <Link
            key={route.key}
            href={`${base}${route.path}`}
            aria-current={
              activeRoute(pathname, locale, route.path) ? 'page' : undefined
            }
          >
            {copy[route.key]}
          </Link>
        ))}
      </div>
    </nav>
  );
}
