import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  GeoFeatureList,
  Notice,
  QueryForm,
  SectionHeading,
} from '@/components/data-foundation-workspace';
import {
  bboxGeometry,
  parseGeoBbox,
  type GeoQueryDto,
} from '@/lib/data-foundation';
import { getDataFoundationDal } from '@/lib/data-foundation-dal.server';
import {
  dataFoundationMetadata,
  dataPageFailure,
  handleDataPageError,
  invalidDataPageRequest,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface GeoPageProps {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ bbox?: string | string[] }>;
}

export async function generateMetadata({ params }: GeoPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.geoPage.metaTitle,
  );
}

export default async function GeoPage({ params, searchParams }: GeoPageProps) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const route = `/${locale}/data-foundation/geo`;
  const bbox = parseGeoBbox(search.bbox);
  let result: GeoQueryDto | undefined;
  let capabilityAvailable = false;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (bbox === null) throw invalidDataPageRequest();
    const dal = await getDataFoundationDal();
    if (bbox === undefined) {
      const registry = await dal.capabilities();
      capabilityAvailable = registry.capabilities.some(
        (capability) => capability.id === 'data.geo.query',
      );
      if (!capabilityAvailable) throw dataPageFailure('contract', 502);
    } else {
      result = await dal.geo(bboxGeometry(bbox));
    }
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }
  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.geoPage.eyebrow}
        title={copy.geoPage.title}
        lede={copy.geoPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      <QueryForm
        action={route}
        name="bbox"
        label={copy.geoPage.bboxLabel}
        placeholder={copy.geoPage.bboxPlaceholder}
        defaultValue={typeof search.bbox === 'string' ? search.bbox : ''}
        hint={copy.geoPage.bboxHint}
        submitLabel={copy.common.searchAction}
        resetHref={route}
        resetLabel={copy.common.resetAction}
      />
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {!capabilityAvailable ? null : (
        <Notice
          title={copy.common.capabilityAvailable}
          copy={copy.geoPage.prompt}
        />
      )}
      {result === undefined ? null : (
        <DataSection>
          <SectionHeading title={copy.geoPage.resultsTitle} />
          <GeoFeatureList locale={locale} features={result.features} />
        </DataSection>
      )}
    </DataPageMain>
  );
}
