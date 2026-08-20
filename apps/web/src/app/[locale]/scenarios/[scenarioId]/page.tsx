import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReadModelUnavailable } from '@/components/read-model-state';
import { ScenarioOrchestration } from '@/components/scenario-orchestration';
import { getDictionary, isLocale } from '@/lib/i18n';
import { getWebReadModelSource } from '@/lib/read-model-source.server';

interface ScenarioPageProps {
  params: Promise<{ locale: string; scenarioId: string }>;
}

export async function generateMetadata({
  params,
}: ScenarioPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).orchestration.heading };
}

export default async function ScenarioPage({ params }: ScenarioPageProps) {
  const { locale, scenarioId } = await params;
  if (!isLocale(locale)) notFound();
  const source = await getWebReadModelSource();
  const result = await source.readScenarioWorkspace(scenarioId);
  if (result.status === 'unavailable') {
    return <ReadModelUnavailable locale={locale} {...result} />;
  }
  return (
    <ScenarioOrchestration
      gaps={result.gaps}
      locale={locale}
      runs={result.data.runs}
      scenario={result.data.scenario}
    />
  );
}
