import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';
import { getDictionary, isLocale, LOCALES } from '@/lib/i18n';
import { getWebDataMode } from '@/lib/read-model-source.server';

import '../globals.css';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

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
        'zh-CN': '/zh-CN/scenarios',
        en: '/en/scenarios',
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
    <html lang={locale} data-scroll-behavior="smooth">
      <body>
        <AppShell locale={locale} mode={await getWebDataMode()}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
