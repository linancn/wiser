import { notFound } from 'next/navigation';

import { DataFoundationMap } from '@/components/data-foundation-map';
import {
  AuthorityFlag,
  DataEmpty,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  Notice,
  QueryForm,
  SectionHeading,
} from '@/components/data-foundation-workspace';
import {
  bboxGeometry,
  isMapDisplayableFeature,
  parseGeoBbox,
  toMapFeatureCollection,
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

interface MapPageProps {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ bbox?: string | string[] }>;
}

export async function generateMetadata({ params }: MapPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.mapPage.metaTitle,
  );
}

export default async function MapPage({ params, searchParams }: MapPageProps) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const route = `/${locale}/data-foundation/map`;
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
  const displayable = result?.features.filter(isMapDisplayableFeature) ?? [];
  const unsupportedCount = (result?.features.length ?? 0) - displayable.length;

  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.mapPage.eyebrow}
        title={copy.mapPage.title}
        lede={copy.mapPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      <QueryForm
        action={route}
        name="bbox"
        label={copy.mapPage.bboxLabel}
        placeholder={copy.mapPage.bboxPlaceholder}
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
          copy={copy.mapPage.prompt}
        />
      )}
      {result === undefined ? null : (
        <DataSection>
          <SectionHeading title={copy.mapPage.mapTitle} />
          {displayable.length === 0 ? (
            <DataEmpty
              title={copy.mapPage.mapTitle}
              copy={copy.mapPage.noFeatures}
            />
          ) : (
            <DataFoundationMap
              ariaLabel={copy.mapPage.mapAria}
              features={toMapFeatureCollection({ features: displayable })}
            />
          )}
          <Notice
            title={copy.common.apiCoverage}
            copy={copy.mapPage.baseLayerGap}
          />
          {unsupportedCount === 0 ? null : (
            <Notice
              title={copy.common.coordinates}
              copy={copy.mapPage.unsupportedCrs}
            />
          )}
        </DataSection>
      )}
    </DataPageMain>
  );
}
