import { getDictionary, type Locale } from '@/lib/i18n';
import type {
  ReadModelGap,
  ReadModelUnavailableReason,
  WebDataMode,
} from '@/lib/read-model-source';
import { FailureState } from './failure-state';

export function ReadModelUnavailable({
  locale,
  mode,
}: {
  locale: Locale;
  mode: WebDataMode;
  reason: ReadModelUnavailableReason;
}) {
  const dictionary = getDictionary(locale);
  const reference = mode === 'reference';
  return (
    <main id="main-content" className="page-main">
      <FailureState
        eyebrow={dictionary.dataSource.unavailableEyebrow}
        title={
          reference
            ? dictionary.dataSource.referenceUnavailableHeading
            : dictionary.dataSource.unavailableHeading
        }
        copy={
          reference
            ? dictionary.dataSource.referenceUnavailableCopy
            : dictionary.dataSource.unavailableCopy
        }
        guidance={
          reference
            ? dictionary.dataSource.referenceAction
            : dictionary.dataSource.liveAction
        }
        primaryAction={{
          href: `/${locale}/scenarios`,
          label: dictionary.dataSource.returnCatalog,
        }}
      />
    </main>
  );
}

export function ReadModelGaps({
  gaps,
  locale,
}: {
  gaps: readonly ReadModelGap[];
  locale: Locale;
}) {
  if (gaps.length === 0) return null;
  const dictionary = getDictionary(locale);
  return (
    <section className="coverage-vector" aria-labelledby="coverage-gap-heading">
      <div className="coverage-vector-heading">
        <div>
          <p className="eyebrow">{dictionary.dataSource.gapEyebrow}</p>
          <h2 id="coverage-gap-heading">{dictionary.dataSource.gapHeading}</h2>
        </div>
        <p>{dictionary.dataSource.gapCopy}</p>
      </div>
      <ol>
        {gaps.map((gap) => (
          <li key={gap.code}>
            <strong>{gap.title[locale]}</strong>
            <p>{gap.detail[locale]}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
