import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ScenarioOrchestration } from '@/components/scenario-orchestration';
import { getDictionary, isLocale } from '@/lib/i18n';
import { getScenarioById, scenarios } from '@/lib/platform';

interface ScenarioPageProps {
  params: Promise<{ locale: string; scenarioId: string }>;
}

export function generateStaticParams() {
  return scenarios.map((scenario) => ({ scenarioId: scenario.id }));
}

export async function generateMetadata({
  params,
}: ScenarioPageProps): Promise<Metadata> {
  const { locale, scenarioId } = await params;
  if (!isLocale(locale)) return {};
  const scenario = getScenarioById(scenarioId);
  return {
    title:
      scenario?.shortName[locale] ??
      getDictionary(locale).orchestration.heading,
  };
}

export default async function ScenarioPage({ params }: ScenarioPageProps) {
  const { locale, scenarioId } = await params;
  if (!isLocale(locale)) notFound();
  const scenario = getScenarioById(scenarioId);
  if (scenario === undefined) notFound();
  return <ScenarioOrchestration locale={locale} scenario={scenario} />;
}
