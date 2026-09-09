import { notFound } from 'next/navigation';
import Link from 'next/link';
import styles from '@/components/data-catalog-table.module.css';

import {
  AuthorityFlag,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  DataEmpty,
  QueryForm,
  SearchResultList,
  SectionHeading,
} from '@/components/data-foundation-workspace';
import { parseSearchQuery } from '@/lib/data-foundation';
import { nameSearchResults } from '@/lib/data-foundation-search.server';
import type { DisplaySearchResult } from '@/lib/data-foundation-presentation';
import { getDataFoundationDal } from '@/lib/data-foundation-dal.server';
import {
  dataFoundationMetadata,
  dataPageFailure,
  handleDataPageError,
  invalidDataPageRequest,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface SearchPageProps {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{
    q?: string | string[];
    after?: string | string[];
  }>;
}

export async function generateMetadata({ params }: SearchPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.searchPage.metaTitle,
  );
}

export default async function SearchPage({
  params,
  searchParams,
}: SearchPageProps) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const route = `/${locale}/data-foundation/search`;
  const query = parseSearchQuery(search.q);
  const after = search.after;
  const pageHref = (cursor?: string) => {
    const params = new URLSearchParams({ q: query ?? '' });
    if (cursor) params.set('after', cursor);
    return `${route}?${params}`;
  };
  let nextCursor: string | undefined;
  let results: readonly DisplaySearchResult[] | undefined;
  let capabilityId: string | undefined;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (query === null) throw invalidDataPageRequest();
    if (
      after !== undefined &&
      (typeof after !== 'string' ||
        !after.length ||
        after.length > 8192 ||
        !query.length)
    )
      throw invalidDataPageRequest();
    const dal = await getDataFoundationDal();
    if (query.length === 0) {
      const registry = await dal.capabilities();
      capabilityId = registry.capabilities.find(
        (capability) => capability.id === 'data.search.federated',
      )?.id;
      if (capabilityId === undefined) throw dataPageFailure('contract', 502);
    } else {
      const page = await dal.search(query, after);
      results = await nameSearchResults(page, dal);
      nextCursor = page.nextCursor;
    }
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }
  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.searchPage.eyebrow}
        title={copy.searchPage.title}
        lede={copy.searchPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      <QueryForm
        action={route}
        name="q"
        label={copy.searchPage.queryLabel}
        placeholder={copy.searchPage.queryPlaceholder}
        defaultValue={query ?? ''}
        submitLabel={copy.common.searchAction}
        resetHref={route}
        resetLabel={copy.common.resetAction}
      />
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {capabilityId === undefined ? null : (
        <DataEmpty
          title={copy.searchPage.queryLabel}
          copy={copy.searchPage.prompt}
        />
      )}
      {results === undefined ? null : (
        <DataSection>
          <SectionHeading
            title={copy.searchPage.resultsTitle}
            lede={`${copy.catalogPage.resultCount} · ${results.length}`}
          />
          <SearchResultList
            locale={locale}
            items={results}
            title={copy.searchPage.resultsTitle}
          />
          <nav
            className={styles.pagination}
            aria-label={copy.catalogPage.pagination}
          >
            {after === undefined ? null : (
              <Link href={pageHref()}>{copy.catalogPage.firstPage}</Link>
            )}
            {nextCursor === undefined ? null : (
              <Link href={pageHref(nextCursor)}>
                {copy.catalogPage.nextPage}
              </Link>
            )}
          </nav>
        </DataSection>
      )}
    </DataPageMain>
  );
}
