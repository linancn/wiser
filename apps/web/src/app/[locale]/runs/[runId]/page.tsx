import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReadModelUnavailable } from '@/components/read-model-state';
import { RunOverview } from '@/components/run-overview';
import { getDictionary, isLocale } from '@/lib/i18n';
import { getWebReadModelSource } from '@/lib/read-model-source.server';

interface RunOverviewPageProps {
  params: Promise<{ locale: string; runId: string }>;
}

export async function generateMetadata({
  params,
}: RunOverviewPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).runOverview.heading };
}

export default async function RunOverviewPage({
  params,
}: RunOverviewPageProps) {
  const { locale, runId } = await params;
  if (!isLocale(locale)) notFound();
  const source = await getWebReadModelSource();
  const result = await source.readRunWorkspace(runId);
  if (result.status === 'unavailable') {
    return <ReadModelUnavailable locale={locale} {...result} />;
  }
  return (
    <RunOverview
      locale={locale}
      run={result.data.run}
      scenario={result.data.scenario}
    />
  );
}
