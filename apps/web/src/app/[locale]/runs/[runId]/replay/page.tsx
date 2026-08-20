import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { RunReplay } from '@/components/run-replay';
import { getDictionary, isLocale } from '@/lib/i18n';
import { exerciseRuns, getRunById, getScenarioById } from '@/lib/platform';

interface ReplayPageProps {
  params: Promise<{ locale: string; runId: string }>;
}

export function generateStaticParams() {
  return exerciseRuns.map((run) => ({ runId: run.id }));
}

export async function generateMetadata({
  params,
}: ReplayPageProps): Promise<Metadata> {
  const { locale, runId } = await params;
  if (!isLocale(locale)) return {};
  const run = getRunById(runId);
  return {
    title:
      run === undefined
        ? getDictionary(locale).replay.heading
        : `${run.name[locale]} · ${getDictionary(locale).replay.heading}`,
  };
}

export default async function ReplayPage({ params }: ReplayPageProps) {
  const { locale, runId } = await params;
  if (!isLocale(locale)) notFound();
  const run = getRunById(runId);
  if (run === undefined) notFound();
  const scenario = getScenarioById(run.scenarioId);
  if (scenario === undefined) notFound();
  return <RunReplay locale={locale} run={run} scenario={scenario} />;
}
