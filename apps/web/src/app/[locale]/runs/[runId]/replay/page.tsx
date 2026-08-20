import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReadModelUnavailable } from '@/components/read-model-state';
import { RunReplay } from '@/components/run-replay';
import { getDictionary, isLocale } from '@/lib/i18n';
import { getWebReadModelSource } from '@/lib/read-model-source.server';

interface ReplayPageProps {
  params: Promise<{ locale: string; runId: string }>;
}

export async function generateMetadata({
  params,
}: ReplayPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).replay.heading };
}

export default async function ReplayPage({ params }: ReplayPageProps) {
  const { locale, runId } = await params;
  if (!isLocale(locale)) notFound();
  const source = await getWebReadModelSource();
  const result = await source.readRunWorkspace(runId);
  if (result.status === 'unavailable') {
    return <ReadModelUnavailable locale={locale} {...result} />;
  }
  return (
    <RunReplay
      gaps={result.gaps}
      locale={locale}
      replayByPerspective={result.data.replayByPerspective}
      run={result.data.run}
      scenario={result.data.scenario}
    />
  );
}
