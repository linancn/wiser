import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { RunTrace } from '@/components/run-trace';
import { getDictionary, isLocale } from '@/lib/i18n';
import { exerciseRuns, getRunById, getScenarioById } from '@/lib/platform';

interface TracePageProps {
  params: Promise<{ locale: string; runId: string }>;
}

export function generateStaticParams() {
  return exerciseRuns.map((run) => ({ runId: run.id }));
}

export async function generateMetadata({
  params,
}: TracePageProps): Promise<Metadata> {
  const { locale, runId } = await params;
  if (!isLocale(locale)) return {};
  const run = getRunById(runId);
  return { title: run?.name[locale] ?? getDictionary(locale).trace.heading };
}

export default async function TracePage({ params }: TracePageProps) {
  const { locale, runId } = await params;
  if (!isLocale(locale)) notFound();
  const run = getRunById(runId);
  if (run === undefined) notFound();
  const scenario = getScenarioById(run.scenarioId);
  if (scenario === undefined) notFound();
  return <RunTrace locale={locale} run={run} scenario={scenario} />;
}
