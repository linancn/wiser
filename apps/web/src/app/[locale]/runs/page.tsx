import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { RunList } from '@/components/run-list';
import { getDictionary, isLocale } from '@/lib/i18n';

interface RunsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: RunsPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).runList.heading };
}

export default async function RunsPage({ params }: RunsPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <RunList locale={locale} />;
}
