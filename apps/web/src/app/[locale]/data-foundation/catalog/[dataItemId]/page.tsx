import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  DataDisclosure,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  FieldGrid,
  ProtocolValue,
  SectionHeading,
  StatusBadge,
  VersionList,
} from '@/components/data-foundation-workspace';
import {
  parseDataRouteUuid,
  type DataItemDetailDto,
  type DataItemVersionPageDto,
} from '@/lib/data-foundation';
import { getDataFoundationDal } from '@/lib/data-foundation-dal.server';
import {
  dataFoundationMetadata,
  dataPageFailure,
  handleDataPageError,
  invalidDataPageRequest,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface DataItemPageProps {
  readonly params: Promise<{ locale: string; dataItemId: string }>;
  readonly searchParams: Promise<{ version?: string | string[] }>;
}

export async function generateMetadata({ params }: DataItemPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.itemPage.metaTitle,
  );
}

export default async function DataItemPage({
  params,
  searchParams,
}: DataItemPageProps) {
  const [{ dataItemId: rawDataItemId, locale }, search] = await Promise.all([
    params,
    searchParams,
  ]);
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const dataItemId = parseDataRouteUuid(rawDataItemId);
  const versionId =
    search.version === undefined
      ? undefined
      : (parseDataRouteUuid(search.version) ?? null);
  const route = `/${locale}/data-foundation/catalog/${rawDataItemId}`;
  let detail: DataItemDetailDto | undefined;
  let versions: DataItemVersionPageDto | undefined;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (dataItemId === null || versionId === null) {
      throw invalidDataPageRequest();
    }
    const dal = await getDataFoundationDal();
    [detail, versions] = await Promise.all([
      dal.dataItem(dataItemId, versionId),
      dal.versions(dataItemId),
    ]);
    if (
      versionId !== undefined &&
      detail.selectedVersion?.versionId !== versionId
    ) {
      throw dataPageFailure('contract', 502);
    }
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }

  const item = detail?.item;
  const selectedVersion = detail?.selectedVersion;
  const mapSearch = new URLSearchParams();
  if (selectedVersion !== undefined && item !== undefined) {
    mapSearch.set('dataItem', item.dataItemId);
    mapSearch.set('version', selectedVersion.versionId);
  }
  if (item?.spatialExtent !== undefined) {
    mapSearch.set('bbox', item.spatialExtent.bbox.join(','));
    if (
      item.spatialExtent.crs === 'EPSG:4326' ||
      item.spatialExtent.crs === 'EPSG:4490'
    ) {
      mapSearch.set('crs', item.spatialExtent.crs);
    }
  }
  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.itemPage.eyebrow}
        title={item?.name ?? copy.itemPage.titleFallback}
        lede={copy.catalogPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {item === undefined || versions === undefined ? null : (
        <>
          <DataSection>
            <SectionHeading title={copy.itemPage.authorityTitle} />
            <p>{copy.presentation.checkHint}</p>
            <FieldGrid
              fields={[
                {
                  label: copy.common.source,
                  value: item.sourceOrganization,
                },

                {
                  label: copy.common.security,
                  value: (
                    <StatusBadge
                      code={(selectedVersion ?? item).securityLevel}
                      label={
                        copy.status.security[
                          (selectedVersion ?? item).securityLevel
                        ]
                      }
                    />
                  ),
                },
                {
                  label: copy.common.quality,
                  value: (
                    <StatusBadge
                      code={(selectedVersion ?? item).qualityGrade}
                      label={`${copy.common.quality} ${(selectedVersion ?? item).qualityGrade}`}
                    />
                  ),
                },
                {
                  label: copy.common.acceptance,
                  value: (
                    <StatusBadge
                      code={(selectedVersion ?? item).acceptanceStatus}
                      label={
                        copy.status.acceptance[
                          (selectedVersion ?? item).acceptanceStatus
                        ]
                      }
                    />
                  ),
                },
                {
                  label: copy.common.publication,
                  value: (
                    <StatusBadge
                      code={(selectedVersion ?? item).publicationStatus}
                      label={
                        copy.status.publication[
                          (selectedVersion ?? item).publicationStatus
                        ]
                      }
                    />
                  ),
                },
                {
                  label: copy.common.processing,
                  value:
                    copy.status.processing[
                      (selectedVersion ?? item).processingStage
                    ],
                },
                {
                  label: copy.common.coordinates,
                  value:
                    item.sourceCrs ??
                    item.canonicalCrs ??
                    copy.common.notProvided,
                },
                ...(selectedVersion === undefined
                  ? []
                  : [
                      {
                        label: copy.itemPage.selectedVersion,
                        value: (
                          <ProtocolValue>
                            v{selectedVersion.version}
                          </ProtocolValue>
                        ),
                      },
                    ]),
              ]}
            />
            <DataDisclosure title={copy.presentation.technical}>
              <FieldGrid
                fields={[
                  {
                    label: copy.common.dataItemId,
                    value: <ProtocolValue>{item.dataItemId}</ProtocolValue>,
                  },
                  {
                    label: copy.common.authorization,
                    value: (
                      <ProtocolValue>{item.authorizationScope}</ProtocolValue>
                    ),
                  },
                  {
                    label: copy.common.ownerProject,
                    value: <ProtocolValue>{item.ownerProjectId}</ProtocolValue>,
                  },
                ]}
              />
            </DataDisclosure>
            {selectedVersion === undefined ? null : (
              <Link
                href={`/${locale}/data-foundation/explore?dataItem=${item.dataItemId}&version=${selectedVersion.versionId}`}
              >
                {copy.common.openResource}
              </Link>
            )}
          </DataSection>
          <DataSection>
            <SectionHeading title={copy.itemPage.versionsTitle} />
            <VersionList
              hrefBase={route}
              locale={locale}
              selectedVersionId={selectedVersion?.versionId}
              versions={versions.items}
            />
            {selectedVersion === undefined ? null : (
              <Link
                href={`/${locale}/data-foundation/map?${mapSearch.toString()}`}
              >
                {copy.itemPage.openOnMap}
              </Link>
            )}
          </DataSection>
          {selectedVersion === undefined ? null : (
            <Link
              href={`/${locale}/data-foundation/explore?dataItem=${item.dataItemId}&version=${selectedVersion.versionId}&view=graph`}
            >
              {copy.common.openLineage}
            </Link>
          )}
          <Link href={`/${locale}/data-foundation/catalog`}>
            {copy.common.backToCatalog}
          </Link>
        </>
      )}
    </DataPageMain>
  );
}
