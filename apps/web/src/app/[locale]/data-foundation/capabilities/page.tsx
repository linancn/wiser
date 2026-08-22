import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  CapabilityList,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  MetricStrip,
  SectionHeading,
} from '@/components/data-foundation-workspace';
import type { CapabilityRegistryDto } from '@/lib/data-foundation';
import { getDataFoundationDal } from '@/lib/data-foundation-dal.server';
import {
  dataFoundationMetadata,
  handleDataPageError,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface CapabilitiesPageProps {
  readonly params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: CapabilitiesPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.capabilitiesPage.metaTitle,
  );
}

export default async function CapabilitiesPage({
  params,
}: CapabilitiesPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const route = `/${locale}/data-foundation/capabilities`;
  let registry: CapabilityRegistryDto | undefined;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    const dal = await getDataFoundationDal();
    registry = await dal.capabilities();
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }
  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.capabilitiesPage.eyebrow}
        title={copy.capabilitiesPage.title}
        lede={copy.capabilitiesPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {registry === undefined ? null : (
        <DataSection>
          <SectionHeading title={copy.capabilitiesPage.title} />
          <MetricStrip
            metrics={[
              {
                label: copy.capabilitiesPage.registryVersion,
                value: registry.registryVersion,
              },
              {
                label: copy.overviewPage.capabilityCount,
                value: registry.capabilities.length,
              },
            ]}
          />
          <CapabilityList locale={locale} registry={registry} />
        </DataSection>
      )}
    </DataPageMain>
  );
}
