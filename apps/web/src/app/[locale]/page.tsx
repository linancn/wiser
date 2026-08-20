import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ControlRoom } from '@/components/control-room';
import { getDictionary, isLocale, LOCALES } from '@/lib/i18n';

interface LocalePageProps {
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LocalePageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const dictionary = getDictionary(locale);
  return {
    title: dictionary.meta.title,
    description: dictionary.meta.description,
    alternates: {
      canonical: `/${locale}`,
      languages: { 'zh-CN': '/zh-CN', en: '/en' },
    },
  };
}

export default async function LocalePage({ params }: LocalePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <ControlRoom locale={locale} />;
}
