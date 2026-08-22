import { notFound } from 'next/navigation';

import {
  AuthorityFlag,
  DataFailureState,
  DataPageHeader,
  DataPageMain,
  DataSection,
  GraphResultView,
  Notice,
  QueryForm,
} from '@/components/data-foundation-workspace';
import { parseGraphEntity, type GraphResultDto } from '@/lib/data-foundation';
import { getDataFoundationDal } from '@/lib/data-foundation-dal.server';
import {
  dataFoundationMetadata,
  dataPageFailure,
  handleDataPageError,
  invalidDataPageRequest,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface GraphPageProps {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ entity?: string | string[] }>;
}

export async function generateMetadata({ params }: GraphPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return dataFoundationMetadata(
    locale,
    getDictionary(locale).dataFoundation.graphPage.metaTitle,
  );
}

export default async function GraphPage({
  params,
  searchParams,
}: GraphPageProps) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;
  const route = `/${locale}/data-foundation/graph`;
  const entity = parseGraphEntity(search.entity);
  let result: GraphResultDto | undefined;
  let capabilityAvailable = false;
  let failure: ReturnType<typeof handleDataPageError> | undefined;
  try {
    if (entity === null) throw invalidDataPageRequest();
    const dal = await getDataFoundationDal();
    if (entity.length === 0) {
      const registry = await dal.capabilities();
      capabilityAvailable = registry.capabilities.some(
        (capability) => capability.id === 'data.graph.expand',
      );
      if (!capabilityAvailable) throw dataPageFailure('contract', 502);
    } else {
      result = await dal.graph(entity);
    }
  } catch (error) {
    failure = handleDataPageError(error, locale, route);
  }
  return (
    <DataPageMain>
      <DataPageHeader
        eyebrow={copy.graphPage.eyebrow}
        title={copy.graphPage.title}
        lede={copy.graphPage.lede}
        aside={<AuthorityFlag locale={locale} />}
      />
      <QueryForm
        action={route}
        name="entity"
        label={copy.graphPage.entityLabel}
        placeholder={copy.graphPage.entityPlaceholder}
        defaultValue={entity ?? ''}
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
          copy={copy.graphPage.prompt}
        />
      )}
      {result === undefined ? null : (
        <DataSection>
          <GraphResultView locale={locale} result={result} />
        </DataSection>
      )}
    </DataPageMain>
  );
}
