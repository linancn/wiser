import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  DataFailureState,
  DataItemList,
  DataPageHeader,
  DataPageMain,
  DataSection,
  MetricStrip,
  QueryForm,
  SectionHeading,
} from '@/components/data-foundation-workspace';
import { parseSearchQuery } from '@/lib/data-foundation';
import { getDataFoundationDal } from '@/lib/data-foundation-dal.server';
import {
  dataFoundationMetadata,
  handleDataPageError,
  invalidDataPageRequest,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface CatalogPageProps {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ q?: string | string[] }>;
}

export async function generateMetadata({ params }: CatalogPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.catalogPage.metaTitle,
  );
}

export default async function CatalogPage({
  params,
  searchParams,
}: CatalogPageProps) {
  const [{ locale }, rawSearch] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const route = `/${locale}/data-foundation/catalog`;
  const query = parseSearchQuery(rawSearch.q);
  let page:
    | Awaited<
        ReturnType<Awaited<ReturnType<typeof getDataFoundationDal>>['catalog']>
      >
    | undefined;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (query === null || query.length > 512) throw invalidDataPageRequest();
    const dal = await getDataFoundationDal();
    page = await dal.catalog({
      first: 50,
      ...(query.length === 0 ? {} : { query }),
    });
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }

  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.catalogPage.eyebrow}
        title={copy.catalogPage.title}
        lede={copy.catalogPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      <QueryForm
        action={route}
        name="q"
        label={copy.catalogPage.queryLabel}
        placeholder={copy.catalogPage.queryPlaceholder}
        defaultValue={query ?? ''}
        submitLabel={copy.common.searchAction}
        resetHref={route}
        resetLabel={copy.common.resetAction}
      />
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {page === undefined ? null : (
        <DataSection>
          <SectionHeading title={copy.catalogPage.tableLabel} />
          <MetricStrip
            metrics={[
              {
                label: copy.catalogPage.resultCount,
                value: page.items.length,
              },
            ]}
          />
          <DataItemList locale={locale} items={page.items} />
        </DataSection>
      )}
    </DataPageMain>
  );
}
