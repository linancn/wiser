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

interface KnowledgePageProps {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{
    q?: string | string[];
    after?: string | string[];
  }>;
}

export async function generateMetadata({ params }: KnowledgePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.knowledgePage.metaTitle,
  );
}

export default async function KnowledgePage({
  params,
  searchParams,
}: KnowledgePageProps) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const route = `/${locale}/data-foundation/knowledge`;
  const query = parseSearchQuery(search.q);
  const after = search.after;
  const pageHref = (cursor?: string) => {
    const params = new URLSearchParams({ q: query ?? '' });
    if (cursor) params.set('after', cursor);
    return `${route}?${params}`;
  };
  let nextCursor: string | undefined;
  let results: readonly DisplaySearchResult[] | undefined;
  let capabilityAvailable = false;
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
      capabilityAvailable = registry.capabilities.some(
        (capability) => capability.id === 'data.knowledge.search',
      );
      if (!capabilityAvailable) throw dataPageFailure('contract', 502);
    } else {
      const page = await dal.knowledge(query, after);
      results = await nameSearchResults(page, dal);
      nextCursor = page.nextCursor;
    }
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }
  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.knowledgePage.eyebrow}
        title={copy.knowledgePage.title}
        lede={copy.knowledgePage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      <QueryForm
        action={route}
        name="q"
        label={copy.knowledgePage.queryLabel}
        placeholder={copy.knowledgePage.queryPlaceholder}
        defaultValue={query ?? ''}
        submitLabel={copy.common.searchAction}
        resetHref={route}
        resetLabel={copy.common.resetAction}
      />
      {failure === undefined ? null : (
        <DataFailureState locale={locale} error={failure} />
      )}
      {!capabilityAvailable ? null : (
        <DataEmpty
          title={copy.knowledgePage.queryLabel}
          copy={copy.knowledgePage.prompt}
        />
      )}
      {results === undefined ? null : (
        <DataSection>
          <SectionHeading
            title={copy.knowledgePage.resultsTitle}
            lede={`${copy.catalogPage.resultCount} · ${results.length}`}
          />
          <SearchResultList
            locale={locale}
            items={results}
            title={copy.knowledgePage.resultsTitle}
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
