import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  CoverageGap,
  DataFailureState,
  DataItemList,
  DataPageHeader,
  DataPageMain,
  DataSection,
  SectionHeading,
} from '@/components/data-foundation-workspace';
import type { DataCatalogPageDto } from '@/lib/data-foundation';
import { getDataFoundationDal } from '@/lib/data-foundation-dal.server';
import {
  dataFoundationMetadata,
  handleDataPageError,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface QualityPageProps {
  readonly params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: QualityPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.qualityPage.metaTitle,
  );
}

export default async function QualityPage({ params }: QualityPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const route = `/${locale}/data-foundation/quality`;
  let catalog: DataCatalogPageDto | undefined;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    const dal = await getDataFoundationDal();
    catalog = await dal.catalog({ first: 50 });
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }
  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.qualityPage.eyebrow}
        title={copy.qualityPage.title}
        lede={copy.qualityPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {catalog === undefined ? null : (
        <>
          <DataSection>
            <SectionHeading title={copy.qualityPage.registerTitle} />
            <DataItemList locale={locale} items={catalog.items} />
          </DataSection>
          <DataSection>
            <SectionHeading title={copy.qualityPage.issuesTitle} />
            <CoverageGap
              title={copy.qualityPage.issuesTitle}
              copy={copy.qualityPage.issuesCopy}
            />
          </DataSection>
        </>
      )}
    </DataPageMain>
  );
}
