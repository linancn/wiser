import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReadModelUnavailable } from '@/components/read-model-state';
import { RunDiagnosticsWorkspace } from '@/components/run-diagnostics-workspace';
import { getDictionary, isLocale } from '@/lib/i18n';
import { getWebReadModelSource } from '@/lib/read-model-source.server';

interface DiagnosticsPageProps {
  params: Promise<{ locale: string; runId: string }>;
}

export async function generateMetadata({
  params,
}: DiagnosticsPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).diagnostics.heading };
}

export default async function DiagnosticsPage({
  params,
}: DiagnosticsPageProps) {
  const { locale, runId } = await params;
  if (!isLocale(locale)) notFound();
  const source = await getWebReadModelSource();
  const result = await source.readRunWorkspace(runId);
  if (result.status === 'unavailable') {
    return <ReadModelUnavailable locale={locale} {...result} />;
  }
  return (
    <RunDiagnosticsWorkspace
      locale={locale}
      run={result.data.run}
      scenario={result.data.scenario}
    />
  );
}
