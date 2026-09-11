import { notFound } from 'next/navigation';
import Link from 'next/link';

import { DataFoundationMap } from '@/components/data-foundation-map';
import {
  AuthorityFlag,
  DataEmpty,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  MapQueryForm,
  DataDisclosure,
  ExplorationEntry,
  SectionHeading,
} from '@/components/data-foundation-workspace';
import {
  bboxGeometry,
  isMapDisplayableFeature,
  parseGeoBbox,
  parseMapVersionSelection,
  resolveMapTileUrls,
  toMapFeatureCollection,
  type DataItemVersionDto,
  type DataItemDetailDto,
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
    dataItem?: string | string[];
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
  let bbox = parseGeoBbox(search.bbox);
  const selection = parseMapVersionSelection(search.dataItem, search.version);
  let crs: 'EPSG:4326' | 'EPSG:4490' | null =
    search.crs === undefined
      ? 'EPSG:4326'
      : search.crs === 'EPSG:4326' || search.crs === 'EPSG:4490'
        ? search.crs
        : null;
  const selectedVersionId = selection?.versionId;
  let result: GeoQueryDto | undefined;
  let stac: StacFeatureCollectionDto = { extents: [] };
  let authoritativeVersion: DataItemVersionDto | undefined;
  let selectedName: string | undefined;
  let capabilityAvailable = false;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (bbox === null || selection === null || crs === null) {
      throw invalidDataPageRequest();
    }
    const dal = await getDataFoundationDal();
    let selectedDetail: DataItemDetailDto | undefined;
    if (bbox === undefined && selection !== undefined) {
      selectedDetail = await dal.dataItem(
        selection.dataItemId,
        selection.versionId,
      );
      if (
        selectedDetail.selectedVersion?.dataItemId !== selection.dataItemId ||
        selectedDetail.selectedVersion.versionId !== selection.versionId
      )
        throw dataPageFailure('contract', 502);
      const query = await dal.explore({
        spec: { versions: [selection] },
        view: 'resources',
        first: 1,
      });
      const map = await dal.explore({
        queryId: query.queryId,
        view: 'map',
        first: 1,
      });
      bbox = map.spatial?.bounds ?? undefined;
      if (bbox !== undefined) {
        const [west, south, east, north] = bbox;
        // A query viewport needs area even when the source is a single point.
        bbox = [
          west === east ? Math.max(-180, west - 0.001) : west,
          south === north ? Math.max(-90, south - 0.001) : south,
          west === east ? Math.min(180, east + 0.001) : east,
          south === north ? Math.min(90, north + 0.001) : north,
        ];
        crs = 'EPSG:4326';
      }
    }
    if (bbox === undefined) {
      const registry = await dal.capabilities();
      capabilityAvailable = registry.capabilities.some(
        (capability) => capability.id === 'data.geo.query',
      );
      if (!capabilityAvailable) throw dataPageFailure('contract', 502);
    } else {
      const [geoResult, stacResult, detail] = await Promise.all([
        dal.geo({
          geometry: bboxGeometry(bbox, crs),
          ...(selectedVersionId === undefined
            ? {}
            : { versionId: selectedVersionId }),
        }),
        dal.stacItems({ bbox }),
        selection === undefined
          ? Promise.resolve(undefined)
          : selectedDetail === undefined
            ? dal.dataItem(selection.dataItemId, selection.versionId)
            : Promise.resolve(selectedDetail),
      ]);
      result = geoResult;
      stac = stacResult;
      authoritativeVersion = detail?.selectedVersion;
      selectedName = detail?.item.name;
      if (
        selection !== undefined &&
        (authoritativeVersion?.dataItemId !== selection.dataItemId ||
          authoritativeVersion.versionId !== selection.versionId)
      ) {
        throw dataPageFailure('contract', 502);
      }
    }
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }
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
  const tileUrls = resolveMapTileUrls(
    selection ?? undefined,
    authoritativeVersion,
  );

  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.mapPage.eyebrow}
        title={copy.mapPage.title}
        lede={copy.mapPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      <ExplorationEntry locale={locale} view="map" />
      <DataDisclosure
        title={copy.presentation.advanced}
        open={search.bbox !== undefined || search.version !== undefined}
      >
        <MapQueryForm
          action={route}
          bbox={typeof search.bbox === 'string' ? search.bbox : ''}
          bboxHint={copy.geoPage.bboxHint}
          bboxLabel={copy.mapPage.bboxLabel}
          bboxPlaceholder={copy.mapPage.bboxPlaceholder}
          crs={crs ?? 'EPSG:4326'}
          crsLabel={copy.mapPage.crsLabel}
          dataItem={typeof search.dataItem === 'string' ? search.dataItem : ''}
          version={typeof search.version === 'string' ? search.version : ''}
          versionLabel={copy.mapPage.versionLabel}
          versionPlaceholder={copy.mapPage.versionPlaceholder}
          submitLabel={copy.common.searchAction}
          resetLabel={copy.common.resetAction}
        />
      </DataDisclosure>
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {!capabilityAvailable ? null : (
        <DataEmpty title={copy.mapPage.title} copy={copy.mapPage.prompt} />
      )}
      {result === undefined ? null : (
        <DataSection>
          <SectionHeading title={copy.mapPage.mapTitle} />
          {selection && authoritativeVersion ? (
            <Link
              href={`/${locale}/data-foundation/catalog/${selection.dataItemId}?version=${selection.versionId}`}
            >
              {copy.explorer.openData}
            </Link>
          ) : null}
          {displayable.length === 0 &&
          stacExtents.length === 0 &&
          selectedVersionId === undefined ? (
            <DataEmpty
              title={copy.mapPage.mapTitle}
              copy={copy.mapPage.noFeatures}
            />
          ) : (
            <DataFoundationMap
              locale={locale}
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
              selectedName={
                authoritativeVersion
                  ? `${selectedName ?? ''} · v${authoritativeVersion.version}`
                  : undefined
              }
              vectorTileUrl={tileUrls.vectorTileUrl}
              rasterTileUrl={tileUrls.rasterTileUrl}
              requestedBounds={bbox ?? undefined}
            />
          )}
          {unsupportedCount === 0 ? null : (
            <DataEmpty
              title={copy.common.coordinates}
              copy={copy.mapPage.unsupportedCrs}
            />
          )}
        </DataSection>
      )}
    </DataPageMain>
  );
}
