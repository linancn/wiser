import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  CapabilityList,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  Notice,
  QueryForm,
  SectionHeading,
} from '@/components/data-foundation-workspace';
import {
  parseDataRouteUuid,
  type CapabilityRegistryDto,
} from '@/lib/data-foundation';
import { getDataFoundationDal } from '@/lib/data-foundation-dal.server';
import {
  dataFoundationMetadata,
  handleDataPageError,
  invalidDataPageRequest,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface IngestionsPageProps {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ id?: string | string[] }>;
}

export async function generateMetadata({ params }: IngestionsPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.ingestionsPage.metaTitle,
  );
}

export default async function IngestionsPage({
  params,
  searchParams,
}: IngestionsPageProps) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const route = `/${locale}/data-foundation/ingestions`;
  const rawId = search.id;
  const ingestionId =
    rawId === undefined ? undefined : parseDataRouteUuid(rawId);
  let registry: CapabilityRegistryDto | undefined;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (rawId !== undefined && ingestionId === null) {
      throw invalidDataPageRequest();
    }
    const dal = await getDataFoundationDal();
    const all = await dal.capabilities();
    registry = {
      registryVersion: all.registryVersion,
      capabilities: all.capabilities.filter((capability) =>
        capability.id.startsWith('data.ingestion.'),
      ),
    };
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }

  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.ingestionsPage.eyebrow}
        title={copy.ingestionsPage.title}
        lede={copy.ingestionsPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      <QueryForm
        action={route}
        name="id"
        label={copy.ingestionsPage.idLabel}
        placeholder={copy.ingestionsPage.idPlaceholder}
        defaultValue={typeof rawId === 'string' ? rawId : ''}
        submitLabel={copy.ingestionsPage.openAction}
        resetHref={route}
        resetLabel={copy.common.resetAction}
      />
      {ingestionId === undefined || ingestionId === null ? null : (
        <Link href={`${route}/${ingestionId}`}>
          {copy.ingestionsPage.openAction}
        </Link>
      )}
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {registry === undefined ? null : (
        <>
          <Notice
            title={copy.ingestionsPage.listGapTitle}
            copy={copy.ingestionsPage.listGapCopy}
          />
          <DataSection>
            <SectionHeading title={copy.ingestionsPage.registeredTitle} />
            <CapabilityList locale={locale} registry={registry} />
          </DataSection>
        </>
      )}
    </DataPageMain>
  );
}
