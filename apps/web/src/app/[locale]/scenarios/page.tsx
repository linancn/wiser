import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ScenarioCenter } from '@/components/scenario-center';
import { ReadModelUnavailable } from '@/components/read-model-state';
import { getDictionary, isLocale } from '@/lib/i18n';
import { getWebReadModelSource } from '@/lib/read-model-source.server';

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
  const result = await getWebReadModelSource().readScenarioCatalog();
  if (result.status === 'unavailable') {
    return <ReadModelUnavailable locale={locale} {...result} />;
  }
  return (
    <ScenarioCenter
      gaps={result.gaps}
      locale={locale}
      mode={result.mode}
      runs={result.data.runs}
      scenarios={result.data.scenarios}
    />
  );
}
