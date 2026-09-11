import { DataAvailabilityOverview } from '@/components/data-availability-overview';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { DataCatalogTable } from '@/components/data-catalog-table';
import styles from '@/components/data-catalog-table.module.css';

import {
  AuthorityFlag,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
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
  readonly searchParams: Promise<{
    q?: string | string[];
    after?: string | string[];
  }>;
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
  const after = rawSearch.after;
  const pageHref = (cursor?: string) => {
    const search = new URLSearchParams();
    if (query) search.set('q', query);
    if (cursor) search.set('after', cursor);
    return `${route}${search.size ? `?${search.toString()}` : ''}`;
  };
  let page:
    | Awaited<
        ReturnType<Awaited<ReturnType<typeof getDataFoundationDal>>['catalog']>
      >
    | undefined;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (query === null || query.length > 512) throw invalidDataPageRequest();
    if (
      after !== undefined &&
      (typeof after !== 'string' || after.length < 1 || after.length > 8192)
    )
      throw invalidDataPageRequest();
    const dal = await getDataFoundationDal();
    page = await dal.catalog({
      first: 25,
      ...(after === undefined ? {} : { after }),
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
      <DataAvailabilityOverview
        key={query ?? ''}
        locale={locale}
        query={query ?? ''}
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
          <SectionHeading
            title={copy.catalogPage.tableLabel}
            lede={`${copy.catalogPage.resultCount} · ${page.items.length}`}
          />
          <DataCatalogTable locale={locale} items={page.items} />
          <nav
            className={styles.pagination}
            aria-label={copy.catalogPage.pagination}
          >
            {after === undefined ? null : (
              <Link href={pageHref()}>{copy.catalogPage.firstPage}</Link>
            )}
            {page.nextCursor === undefined ? null : (
              <Link href={pageHref(page.nextCursor)}>
                {copy.catalogPage.nextPage}
              </Link>
            )}
          </nav>
        </DataSection>
      )}
    </DataPageMain>
  );
}
