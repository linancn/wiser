import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  Notice,
  QueryForm,
  SearchResultList,
  SectionHeading,
} from '@/components/data-foundation-workspace';
import { parseSearchQuery, type SearchPageDto } from '@/lib/data-foundation';
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
  readonly searchParams: Promise<{ q?: string | string[] }>;
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
  let results: SearchPageDto | undefined;
  let capabilityId: string | undefined;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (query === null) throw invalidDataPageRequest();
    const dal = await getDataFoundationDal();
    if (query.length === 0) {
      const registry = await dal.capabilities();
      capabilityId = registry.capabilities.find(
        (capability) => capability.id === 'data.search.federated',
      )?.id;
      if (capabilityId === undefined) throw dataPageFailure('contract', 502);
    } else {
      results = await dal.search(query);
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
        <Notice
          title={copy.common.capabilityAvailable}
          copy={copy.searchPage.prompt}
        />
      )}
      {results === undefined ? null : (
        <DataSection>
          <SectionHeading title={copy.searchPage.resultsTitle} />
          <SearchResultList
            locale={locale}
            items={results.items}
            title={copy.searchPage.resultsTitle}
          />
        </DataSection>
      )}
    </DataPageMain>
  );
}
