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

interface KnowledgePageProps {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ q?: string | string[] }>;
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
  let results: SearchPageDto | undefined;
  let capabilityAvailable = false;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (query === null) throw invalidDataPageRequest();
    const dal = await getDataFoundationDal();
    if (query.length === 0) {
      const registry = await dal.capabilities();
      capabilityAvailable = registry.capabilities.some(
        (capability) => capability.id === 'data.knowledge.search',
      );
      if (!capabilityAvailable) throw dataPageFailure('contract', 502);
    } else {
      results = await dal.knowledge(query);
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
        <Notice
          title={copy.common.capabilityAvailable}
          copy={copy.knowledgePage.prompt}
        />
      )}
      {results === undefined ? null : (
        <DataSection>
          <SectionHeading title={copy.knowledgePage.resultsTitle} />
          <SearchResultList
            locale={locale}
            items={results.items}
            title={copy.knowledgePage.resultsTitle}
          />
        </DataSection>
      )}
    </DataPageMain>
  );
}
