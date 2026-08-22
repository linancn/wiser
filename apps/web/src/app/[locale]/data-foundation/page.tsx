import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  MetricStrip,
  SectionHeading,
  WorkspaceLinks,
} from '@/components/data-foundation-workspace';
import { getDataFoundationDal } from '@/lib/data-foundation-dal.server';
import {
  dataFoundationMetadata,
  handleDataPageError,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface DataFoundationPageProps {
  readonly params: Promise<{ locale: string }>;
}

async function loadOverview() {
  const dal = await getDataFoundationDal();
  const [health, catalog, capabilities] = await Promise.all([
    dal.health(),
    dal.catalog({ first: 6 }),
    dal.capabilities(),
  ]);
  return {
    health,
    catalogCount: catalog.items.length,
    capabilityCount: capabilities.capabilities.length,
  };
}

export async function generateMetadata({ params }: DataFoundationPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.overviewPage.metaTitle,
  );
}

export default async function DataFoundationPage({
  params,
}: DataFoundationPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  let result: Awaited<ReturnType<typeof loadOverview>> | undefined;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    result = await loadOverview();
  } catch (error) {
    failure = handleDataPageError(error, locale, `/${locale}/data-foundation`);
  }

  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.overviewPage.eyebrow}
        title={copy.overviewPage.title}
        lede={copy.overviewPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {result === undefined ? null : (
        <>
          <DataSection>
            <SectionHeading title={copy.overviewPage.healthTitle} />
            <MetricStrip
              metrics={[
                {
                  label: copy.common.state,
                  value:
                    result.health.status === 'ready'
                      ? copy.overviewPage.ready
                      : copy.overviewPage.degraded,
                  state:
                    result.health.status === 'ready' ? 'success' : 'warning',
                },
                {
                  label: copy.overviewPage.database,
                  value: result.health.database
                    ? copy.overviewPage.connected
                    : copy.overviewPage.disconnected,
                  state: result.health.database ? 'success' : 'danger',
                },
                {
                  label: copy.overviewPage.objectStore,
                  value: result.health.objectStore
                    ? copy.overviewPage.connected
                    : copy.overviewPage.disconnected,
                  state: result.health.objectStore ? 'success' : 'danger',
                },
                {
                  label: copy.overviewPage.worker,
                  value: result.health.worker
                    ? copy.overviewPage.connected
                    : copy.overviewPage.disconnected,
                  state: result.health.worker ? 'success' : 'danger',
                },
                {
                  label: copy.overviewPage.catalogCount,
                  value: result.catalogCount,
                },
                {
                  label: copy.overviewPage.capabilityCount,
                  value: result.capabilityCount,
                },
              ]}
            />
          </DataSection>
          <DataSection>
            <SectionHeading title={copy.overviewPage.operatingTitle} />
            <WorkspaceLinks
              links={[
                {
                  href: `/${locale}/data-foundation/catalog`,
                  label: copy.overviewPage.catalogAction,
                  detail: copy.domains[0]?.copy ?? copy.common.notProvided,
                },
                {
                  href: `/${locale}/data-foundation/ingestions`,
                  label: copy.overviewPage.ingestionAction,
                  detail: copy.domains[1]?.copy ?? copy.common.notProvided,
                },
                {
                  href: `/${locale}/data-foundation/search`,
                  label: copy.overviewPage.searchAction,
                  detail: copy.domains[2]?.copy ?? copy.common.notProvided,
                },
                {
                  href: `/${locale}/data-foundation/map`,
                  label: copy.overviewPage.mapAction,
                  detail: copy.mapPage.lede,
                },
              ]}
            />
          </DataSection>
        </>
      )}
    </DataPageMain>
  );
}
