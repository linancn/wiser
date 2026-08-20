import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReadModelUnavailable } from '@/components/read-model-state';
import { RunList } from '@/components/run-list';
import { getDictionary, isLocale } from '@/lib/i18n';
import { getWebReadModelSource } from '@/lib/read-model-source.server';

interface RunsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: RunsPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).runList.heading };
}

export default async function RunsPage({ params }: RunsPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const result = await getWebReadModelSource().readRunCatalog();
  if (result.status === 'unavailable') {
    return <ReadModelUnavailable locale={locale} {...result} />;
  }
  return (
    <RunList
      gaps={result.gaps}
      locale={locale}
      runs={result.data.runs}
      scenarios={result.data.scenarios}
    />
  );
}
