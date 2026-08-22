import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';
import {
  CurrentUserControl,
  CurrentUserFallback,
} from '@/components/current-user-control';
import { getDictionary, isLocale, LOCALES } from '@/lib/i18n';

import '../globals.css';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

const themeInitializer = `
  (function () {
    try {
      var stored = localStorage.getItem('wiser-theme');
      var theme = stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch (_) {
      document.documentElement.dataset.theme = 'light';
      document.documentElement.style.colorScheme = 'light';
    }
  })();
`;

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#edf5f6' },
    { media: '(prefers-color-scheme: dark)', color: '#071a21' },
  ],
};

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: Omit<LocaleLayoutProps, 'children'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dictionary = getDictionary(locale);
  return {
    title: {
      default: dictionary.meta.title,
      template: `%s | ${dictionary.brand.name}`,
    },
    description: dictionary.meta.description,
    alternates: {
      languages: {
        'zh-CN': '/zh-CN',
        en: '/en',
      },
    },
    icons: [{ rel: 'icon', url: '/favicon.svg', type: 'image/svg+xml' }],
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body>
        <AppShell
          locale={locale}
          authControl={
            <Suspense fallback={<CurrentUserFallback locale={locale} />}>
              <CurrentUserControl locale={locale} />
            </Suspense>
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
