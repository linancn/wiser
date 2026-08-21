import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReadModelUnavailable } from '@/components/read-model-state';
import { RunCollaboration } from '@/components/run-collaboration';
import { getDictionary, isLocale } from '@/lib/i18n';
import { getWebReadModelSource } from '@/lib/read-model-source.server';

interface CollaborationPageProps {
  params: Promise<{ locale: string; runId: string }>;
}

export async function generateMetadata({
  params,
}: CollaborationPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).collaboration.heading };
}

export default async function CollaborationPage({
  params,
}: CollaborationPageProps) {
  const { locale, runId } = await params;
  if (!isLocale(locale)) notFound();
  const source = await getWebReadModelSource();
  const result = await source.readRunWorkspace(runId);
  if (result.status === 'unavailable') {
    return <ReadModelUnavailable locale={locale} {...result} />;
  }
  return (
    <RunCollaboration
      gaps={result.gaps}
      interactions={result.data.interactions}
      liveMode={result.mode === 'live'}
      locale={locale}
      run={result.data.run}
      scenario={result.data.scenario}
    />
  );
}
