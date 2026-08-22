import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  CoverageGap,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  SectionHeading,
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

interface LineagePageProps {
  readonly params: Promise<{ locale: string; dataItemId: string }>;
}

export async function generateMetadata({ params }: LineagePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.lineagePage.metaTitle,
  );
}

export default async function LineagePage({ params }: LineagePageProps) {
  const { dataItemId: rawDataItemId, locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const dataItemId = parseDataRouteUuid(rawDataItemId);
  const route = `/${locale}/data-foundation/lineage/${rawDataItemId}`;
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
  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.lineagePage.eyebrow}
        title={detail?.item.name ?? copy.lineagePage.title}
        lede={copy.lineagePage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {detail === undefined || versions === undefined ? null : (
        <>
          <DataSection>
            <SectionHeading title={copy.lineagePage.anchorsTitle} />
            <VersionList locale={locale} versions={versions.items} />
          </DataSection>
          <DataSection>
            <SectionHeading title={copy.lineagePage.graphTitle} />
            <CoverageGap
              title={copy.lineagePage.graphTitle}
              copy={copy.lineagePage.gapCopy}
            />
          </DataSection>
          <Link
            href={`/${locale}/data-foundation/catalog/${detail.item.dataItemId}`}
          >
            {copy.common.inspect}
          </Link>
        </>
      )}
    </DataPageMain>
  );
}
