import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  CoverageGap,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  FieldGrid,
  PanelGrid,
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
  handleDataPageError,
  invalidDataPageRequest,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface DataItemPageProps {
  readonly params: Promise<{ locale: string; dataItemId: string }>;
}

export async function generateMetadata({ params }: DataItemPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.itemPage.metaTitle,
  );
}

export default async function DataItemPage({ params }: DataItemPageProps) {
  const { dataItemId: rawDataItemId, locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const dataItemId = parseDataRouteUuid(rawDataItemId);
  const route = `/${locale}/data-foundation/catalog/${rawDataItemId}`;
  let detail: DataItemDetailDto | undefined;
  let versions: DataItemVersionPageDto | undefined;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (dataItemId === null) throw invalidDataPageRequest();
    const dal = await getDataFoundationDal();
    [detail, versions] = await Promise.all([
      dal.dataItem(dataItemId),
      dal.versions(dataItemId),
    ]);
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }

  const item = detail?.item;
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
            <FieldGrid
              fields={[
                {
                  label: copy.common.dataItemId,
                  value: <ProtocolValue>{item.dataItemId}</ProtocolValue>,
                },
                {
                  label: copy.common.source,
                  value: item.sourceOrganization,
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
                {
                  label: copy.common.security,
                  value: (
                    <StatusBadge
                      code={item.securityLevel}
                      label={copy.status.security[item.securityLevel]}
                    />
                  ),
                },
                {
                  label: copy.common.quality,
                  value: (
                    <StatusBadge
                      code={item.qualityGrade}
                      label={`${copy.common.quality} ${item.qualityGrade}`}
                    />
                  ),
                },
                {
                  label: copy.common.acceptance,
                  value: (
                    <StatusBadge
                      code={item.acceptanceStatus}
                      label={copy.status.acceptance[item.acceptanceStatus]}
                    />
                  ),
                },
                {
                  label: copy.common.publication,
                  value: (
                    <StatusBadge
                      code={item.publicationStatus}
                      label={copy.status.publication[item.publicationStatus]}
                    />
                  ),
                },
                {
                  label: copy.common.processing,
                  value: copy.status.processing[item.processingStage],
                },
                {
                  label: copy.common.coordinates,
                  value:
                    item.sourceCrs ??
                    item.canonicalCrs ??
                    copy.common.notProvided,
                },
              ]}
            />
          </DataSection>
          <DataSection>
            <SectionHeading title={copy.itemPage.versionsTitle} />
            <VersionList locale={locale} versions={versions.items} />
          </DataSection>
          <DataSection>
            <SectionHeading title={copy.itemPage.governanceTitle} />
            <PanelGrid>
              <CoverageGap
                title={copy.itemPage.issues}
                copy={copy.common.notProvided}
              />
              <CoverageGap
                title={copy.itemPage.agentRuns}
                copy={copy.common.notProvided}
              />
              <CoverageGap
                title={copy.itemPage.projection}
                copy={copy.common.notProvided}
              />
              <article>
                <p>{copy.itemPage.lineage}</p>
                <Link
                  href={`/${locale}/data-foundation/lineage/${item.dataItemId}`}
                >
                  {copy.common.openLineage}
                </Link>
              </article>
            </PanelGrid>
          </DataSection>
          <Link href={`/${locale}/data-foundation/catalog`}>
            {copy.common.backToCatalog}
          </Link>
        </>
      )}
    </DataPageMain>
  );
}
