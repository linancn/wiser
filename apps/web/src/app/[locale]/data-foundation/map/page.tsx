import { notFound } from 'next/navigation';

import { DataFoundationMap } from '@/components/data-foundation-map';
import {
  AuthorityFlag,
  DataEmpty,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  MapQueryForm,
  Notice,
  SectionHeading,
} from '@/components/data-foundation-workspace';
import {
  bboxGeometry,
  isMapDisplayableFeature,
  parseDataRouteUuid,
  parseGeoBbox,
  toMapFeatureCollection,
  type GeoQueryDto,
  type StacFeatureCollectionDto,
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
  readonly searchParams: Promise<{
    bbox?: string | string[];
    crs?: string | string[];
    version?: string | string[];
  }>;
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
  const versionId =
    search.version === undefined
      ? undefined
      : (parseDataRouteUuid(search.version) ?? null);
  const crs =
    search.crs === undefined
      ? 'EPSG:4326'
      : search.crs === 'EPSG:4326' || search.crs === 'EPSG:4490'
        ? search.crs
        : null;
  let result: GeoQueryDto | undefined;
  let stac: StacFeatureCollectionDto = { extents: [] };
  let capabilityAvailable = false;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (bbox === null || versionId === null || crs === null) {
      throw invalidDataPageRequest();
    }
    const dal = await getDataFoundationDal();
    if (bbox === undefined) {
      const registry = await dal.capabilities();
      capabilityAvailable = registry.capabilities.some(
        (capability) => capability.id === 'data.geo.query',
      );
      if (!capabilityAvailable) throw dataPageFailure('contract', 502);
    } else {
      [result, stac] = await Promise.all([
        dal.geo(bboxGeometry(bbox, crs)),
        dal.stacItems({ bbox }),
      ]);
    }
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }
  const selectedVersionId = versionId ?? undefined;
  const versionFeatures =
    result?.features.filter(
      (feature) =>
        selectedVersionId === undefined ||
        feature.versionId === selectedVersionId,
    ) ?? [];
  const displayable = versionFeatures.filter(isMapDisplayableFeature);
  const stacExtents = stac.extents.filter(
    (extent) =>
      selectedVersionId === undefined || extent.versionId === selectedVersionId,
  );
  const unsupportedCount = versionFeatures.length - displayable.length;

  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.mapPage.eyebrow}
        title={copy.mapPage.title}
        lede={copy.mapPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      <MapQueryForm
        action={route}
        bbox={typeof search.bbox === 'string' ? search.bbox : ''}
        bboxHint={copy.geoPage.bboxHint}
        bboxLabel={copy.mapPage.bboxLabel}
        bboxPlaceholder={copy.mapPage.bboxPlaceholder}
        crs={crs ?? 'EPSG:4326'}
        crsLabel={copy.mapPage.crsLabel}
        version={typeof search.version === 'string' ? search.version : ''}
        versionLabel={copy.mapPage.versionLabel}
        versionPlaceholder={copy.mapPage.versionPlaceholder}
        submitLabel={copy.common.searchAction}
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
          {displayable.length === 0 &&
          stacExtents.length === 0 &&
          selectedVersionId === undefined ? (
            <DataEmpty
              title={copy.mapPage.mapTitle}
              copy={copy.mapPage.noFeatures}
            />
          ) : (
            <DataFoundationMap
              ariaLabel={copy.mapPage.mapAria}
              displayCrs={crs ?? 'EPSG:4326'}
              features={toMapFeatureCollection({ features: displayable })}
              labels={{
                layersLabel: copy.mapPage.layersLabel,
                authorityLayer: copy.mapPage.authorityLayer,
                stacLayer: copy.mapPage.stacLayer,
                vectorLayer: copy.mapPage.vectorLayer,
                rasterLayer: copy.mapPage.rasterLayer,
                selectedVersion: copy.mapPage.selectedVersion,
                noSelectedVersion: copy.mapPage.noSelectedVersion,
                displayCrs: copy.mapPage.displayCrs,
                controls: copy.mapPage.controls,
              }}
              stacExtents={stacExtents}
              selectedVersion={selectedVersionId}
              vectorTileUrl={
                selectedVersionId === undefined
                  ? undefined
                  : `/api/data-foundation/geo/tiles/vector/versions/${encodeURIComponent(selectedVersionId)}/{z}/{x}/{y}.pbf`
              }
              rasterTileUrl={
                selectedVersionId === undefined
                  ? undefined
                  : `/api/data-foundation/geo/tiles/raster/versions/${encodeURIComponent(selectedVersionId)}/WebMercatorQuad/{z}/{x}/{y}.png`
              }
            />
          )}
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
