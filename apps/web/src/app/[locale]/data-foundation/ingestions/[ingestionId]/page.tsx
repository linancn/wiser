import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  FieldGrid,
  IngestionRuntimeSummaries,
  IngestionStateRail,
  ProtocolValue,
  SectionHeading,
  StatusBadge,
  formatDataDate,
} from '@/components/data-foundation-workspace';
import { parseDataRouteUuid, type IngestionDto } from '@/lib/data-foundation';
import { getDataFoundationDal } from '@/lib/data-foundation-dal.server';
import {
  dataFoundationMetadata,
  handleDataPageError,
  invalidDataPageRequest,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface IngestionPageProps {
  readonly params: Promise<{ locale: string; ingestionId: string }>;
}

export async function generateMetadata({ params }: IngestionPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.ingestionPage.metaTitle,
  );
}

export default async function IngestionPage({ params }: IngestionPageProps) {
  const { ingestionId: rawIngestionId, locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const ingestionId = parseDataRouteUuid(rawIngestionId);
  const route = `/${locale}/data-foundation/ingestions/${rawIngestionId}`;
  let ingestion: IngestionDto | undefined;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (ingestionId === null) throw invalidDataPageRequest();
    const dal = await getDataFoundationDal();
    ingestion = await dal.ingestion(ingestionId);
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }

  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.ingestionPage.eyebrow}
        title={copy.ingestionPage.title}
        lede={copy.ingestionsPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {ingestion === undefined ? null : (
        <>
          <DataSection>
            <SectionHeading title={copy.ingestionPage.authorityTitle} />
            <FieldGrid
              fields={[
                {
                  label: copy.common.ingestionId,
                  value: <ProtocolValue>{ingestion.ingestionId}</ProtocolValue>,
                },
                {
                  label: copy.common.state,
                  value: (
                    <StatusBadge
                      code={ingestion.state}
                      label={copy.status.ingestion[ingestion.state]}
                    />
                  ),
                },
                {
                  label: copy.common.security,
                  value: (
                    <StatusBadge
                      code={ingestion.requestedSecurityLevel}
                      label={
                        copy.status.security[ingestion.requestedSecurityLevel]
                      }
                    />
                  ),
                },
                {
                  label: copy.common.ownerProject,
                  value: <ProtocolValue>{ingestion.projectId}</ProtocolValue>,
                },
                {
                  label: copy.common.assetIds,
                  value: ingestion.assetIds.length,
                },
                {
                  label: copy.common.intendedUses,
                  value: ingestion.intendedUses.join(' · '),
                },
                {
                  label: copy.common.version,
                  value: <ProtocolValue>v{ingestion.version}</ProtocolValue>,
                },
                {
                  label: copy.common.createdAt,
                  value: formatDataDate(ingestion.createdAt, locale),
                },
                {
                  label: copy.common.updatedAt,
                  value: formatDataDate(ingestion.updatedAt, locale),
                },
              ]}
            />
            {ingestion.operationId === undefined ? null : (
              <Link
                href={`/${locale}/data-foundation/operations/${ingestion.operationId}`}
              >
                {copy.common.openOperation}
              </Link>
            )}
          </DataSection>
          <DataSection>
            <SectionHeading title={copy.ingestionPage.stateMachineTitle} />
            <IngestionStateRail locale={locale} state={ingestion.state} />
          </DataSection>
          <DataSection>
            <SectionHeading title={copy.ingestionPage.runtimeTitle} />
            <IngestionRuntimeSummaries ingestion={ingestion} locale={locale} />
          </DataSection>
        </>
      )}
    </DataPageMain>
  );
}
