import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  FieldGrid,
  OperationEventList,
  ProtocolValue,
  SectionHeading,
  StatusBadge,
  formatDataDate,
} from '@/components/data-foundation-workspace';
import {
  parseDataRouteUuid,
  type OperationDto,
  type OperationEventDto,
} from '@/lib/data-foundation';
import { getDataFoundationDal } from '@/lib/data-foundation-dal.server';
import {
  dataFoundationMetadata,
  handleDataPageError,
  invalidDataPageRequest,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface OperationPageProps {
  readonly params: Promise<{ locale: string; operationId: string }>;
}

export async function generateMetadata({ params }: OperationPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.operationPage.metaTitle,
  );
}

export default async function OperationPage({ params }: OperationPageProps) {
  const { locale, operationId: rawOperationId } = await params;
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const operationId = parseDataRouteUuid(rawOperationId);
  const route = `/${locale}/data-foundation/operations/${rawOperationId}`;
  let operation: OperationDto | undefined;
  let events: readonly OperationEventDto[] | undefined;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (operationId === null) throw invalidDataPageRequest();
    const dal = await getDataFoundationDal();
    [operation, events] = await Promise.all([
      dal.operation(operationId),
      dal.operationEvents(operationId),
    ]);
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }

  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.operationPage.eyebrow}
        title={copy.operationPage.title}
        lede={copy.operationPage.eventsLede}
        aside={<AuthorityFlag locale={locale} />}
      />
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {operation === undefined || events === undefined ? null : (
        <>
          <DataSection>
            <SectionHeading title={copy.operationPage.summaryTitle} />
            <FieldGrid
              fields={[
                {
                  label: copy.common.operationId,
                  value: <ProtocolValue>{operation.operationId}</ProtocolValue>,
                },
                {
                  label: copy.common.capability,
                  value: (
                    <ProtocolValue>{operation.capabilityId}</ProtocolValue>
                  ),
                },
                {
                  label: copy.common.state,
                  value: (
                    <StatusBadge
                      code={operation.status}
                      label={copy.status.operation[operation.status]}
                    />
                  ),
                },
                {
                  label: copy.common.progress,
                  value: `${operation.progressPercent}%`,
                },
                {
                  label: copy.common.version,
                  value: <ProtocolValue>v{operation.version}</ProtocolValue>,
                },
                {
                  label: copy.common.createdAt,
                  value: formatDataDate(operation.createdAt, locale),
                },
                {
                  label: copy.common.updatedAt,
                  value: formatDataDate(operation.updatedAt, locale),
                },
                {
                  label: copy.common.notAvailable,
                  value:
                    operation.error === undefined ? (
                      copy.common.notProvided
                    ) : (
                      <>
                        <ProtocolValue>{operation.error.code}</ProtocolValue>{' '}
                        {operation.error.retryable
                          ? copy.operationPage.retryable
                          : copy.operationPage.notRetryable}
                      </>
                    ),
                },
              ]}
            />
          </DataSection>
          <DataSection>
            <SectionHeading
              title={copy.operationPage.eventsTitle}
              lede={copy.operationPage.eventsLede}
            />
            <OperationEventList locale={locale} events={events} />
          </DataSection>
        </>
      )}
    </DataPageMain>
  );
}
