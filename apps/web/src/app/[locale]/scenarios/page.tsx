import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ScenarioCenter } from '@/components/scenario-center';
import { getDictionary, isLocale } from '@/lib/i18n';

interface ScenarioCenterPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: ScenarioCenterPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).scenarioCenter.heading };
}

export default async function ScenarioCenterPage({
  params,
}: ScenarioCenterPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ScenarioCenter locale={locale} />;
}
