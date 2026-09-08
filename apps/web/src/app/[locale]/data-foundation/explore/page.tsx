import { notFound } from 'next/navigation';
import {
  ExplorationQueryInputSchema,
  type ExplorationResult,
} from '@wiser/data-contracts';
import { DataExplorer } from '@/components/data-explorer';
import {
  getDataFoundationDal,
  DataFoundationApiError,
} from '@/lib/data-foundation-dal.server';
import {
  handleDataPageError,
  dataFoundationMetadata,
} from '@/lib/data-foundation-page.server';
import { getDictionary, isLocale } from '@/lib/i18n';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string | string[];
    query?: string | string[];
    quality?: string | string[];
  }>;
}
export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale)
    ? dataFoundationMetadata(
        locale,
        getDictionary(locale).dataFoundation.explorer.title,
      )
    : {};
}
export default async function ExplorePage({ params, searchParams }: Props) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  let result: ExplorationResult | null = null;
  let failure: 'expired' | 'unavailable' | null = null;
  const text =
    typeof search.q === 'string' && search.q.length <= 512 ? search.q : '';
  try {
    const input = ExplorationQueryInputSchema.safeParse({
      ...(search.query === undefined
        ? {
            spec: {
              ...(text.trim() ? { text: text.trim() } : {}),
              ...(search.quality ? { qualityGrades: [search.quality] } : {}),
            },
          }
        : { queryId: search.query }),
      view: 'resources',
      first: 25,
    });
    if (!input.success)
      throw new DataFoundationApiError('invalid-request', 422);
    result = await (await getDataFoundationDal()).explore(input.data);
  } catch (error) {
    if (
      error instanceof DataFoundationApiError &&
      error.kind === 'authentication'
    )
      handleDataPageError(error, locale, `/${locale}/data-foundation/explore`);
    failure =
      error instanceof DataFoundationApiError &&
      [404, 409, 422].includes(error.status)
        ? 'expired'
        : 'unavailable';
  }
  return (
    <DataExplorer
      locale={locale}
      initialResult={result}
      initialFailure={failure}
      initialText={text}
    />
  );
}
