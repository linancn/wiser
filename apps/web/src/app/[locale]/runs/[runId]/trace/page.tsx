import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReadModelUnavailable } from '@/components/read-model-state';
import { RunTrace } from '@/components/run-trace';
import { getDictionary, isLocale } from '@/lib/i18n';
import { getWebReadModelSource } from '@/lib/read-model-source.server';

interface TracePageProps {
  params: Promise<{ locale: string; runId: string }>;
}

export async function generateMetadata({
  params,
}: TracePageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).trace.heading };
}

export default async function TracePage({ params }: TracePageProps) {
  const { locale, runId } = await params;
  if (!isLocale(locale)) notFound();
  const source = await getWebReadModelSource();
  const result = await source.readRunWorkspace(runId);
  if (result.status === 'unavailable') {
    return <ReadModelUnavailable locale={locale} {...result} />;
  }
  return (
    <RunTrace
      gaps={result.gaps}
      locale={locale}
      run={result.data.run}
      scenario={result.data.scenario}
    />
  );
}
