import Link from 'next/link';

import { getDictionary, type Locale } from '@/lib/i18n';
import type {
  ReadModelGap,
  ReadModelUnavailableReason,
  WebDataMode,
} from '@/lib/read-model-source';

export function ReadModelUnavailable({
  locale,
  mode,
  reason,
}: {
  locale: Locale;
  mode: WebDataMode;
  reason: ReadModelUnavailableReason;
}) {
  const dictionary = getDictionary(locale);
  const reference = mode === 'reference';
  const reasonKey = reason === 'not_found' ? 'notFound' : reason;
  return (
    <main id="main-content" className="page-main source-state-page">
      <section className="source-unavailable" role="alert">
        <div className="source-state-gauge" aria-hidden="true">
          <i />
          <span>0%</span>
        </div>
        <div>
          <p className="eyebrow">
            {dictionary.dataSource.unavailableEyebrow} · <code>{reason}</code>
          </p>
          <h1>
            {reference
              ? dictionary.dataSource.referenceUnavailableHeading
              : dictionary.dataSource.unavailableHeading}
          </h1>
          <p>
            {reference
              ? dictionary.dataSource.referenceUnavailableCopy
              : dictionary.dataSource.unavailableCopy}
          </p>
          <dl>
            <div>
              <dt>{dictionary.dataSource.diagnostic}</dt>
              <dd>
                <code>
                  {reference
                    ? dictionary.dataSource.referenceDiagnostic
                    : dictionary.dataSource.reasons[reasonKey]}
                </code>
              </dd>
            </div>
            <div>
              <dt>{dictionary.dataSource.action}</dt>
              <dd>
                {reference
                  ? dictionary.dataSource.referenceAction
                  : dictionary.dataSource.liveAction}
              </dd>
            </div>
          </dl>
          <Link className="primary-action" href={`/${locale}/scenarios`}>
            {dictionary.dataSource.returnCatalog}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
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
            <code>{gap.code}</code>
            <strong>{gap.title[locale]}</strong>
            <p>{gap.detail[locale]}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
