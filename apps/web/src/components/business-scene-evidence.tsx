'use client';
import Link from 'next/link';
import type { RelationAssertion } from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import { businessRecordFocus } from '@/lib/business-graph';
import { withRecordFocus } from '@/lib/exploration-record-focus';
import { relationViewHref } from '@/lib/relation-navigation';
export function BusinessSceneEvidence({
  row,
  locale,
  recordHref,
}: {
  row: RelationAssertion;
  locale: Locale;
  recordHref: (view: 'records' | 'map') => string;
}) {
  const dictionary = getDictionary(locale).knowledgeRelations,
    copy = dictionary.scene;
  const q = row.candidate.qualifiers;
  return (
    <section aria-label={copy.relationSelected}>
      <h3>
        {row.candidate.subject.label} →{' '}
        {dictionary.predicates[row.candidate.predicate]} →{' '}
        {row.candidate.object.label}
      </h3>
      <p>{dictionary.relationMeaning[row.candidate.predicate]}</p>
      <p>
        {copy.review} · {dictionary.statuses[row.status]}
      </p>
      {q.context ? (
        <p>
          {dictionary.timeRoles[q.context.timeRole]} ·{' '}
          {q.context.validFrom ?? q.observedAt ?? dictionary.timeRoles.UNKNOWN}{' '}
          — {q.context.validTo ?? ''}
          <br />
          {q.context.applicability}
        </p>
      ) : null}
      {q.spatialScope ? <p>{q.spatialScope}</p> : null}
      {q.limitations.map((text, i) => (
        <p key={i}>{text}</p>
      ))}
      <Link
        href={`/${locale}/data-foundation/catalog/${row.dataItemId}?version=${row.versionId}`}
      >
        {copy.source}
      </Link>
      {[row.candidate.subject, row.candidate.object].map((entity, i) => {
        const focus = businessRecordFocus(row, entity);
        return focus ? (
          <p key={i}>
            <Link href={withRecordFocus(recordHref('records'), focus)}>
              {copy.record}
            </Link>{' '}
            ·{' '}
            <Link href={withRecordFocus(recordHref('map'), focus)}>
              {copy.map}
            </Link>
          </p>
        ) : null;
      })}
      <h4>{copy.allEvidence}</h4>
      {row.candidate.evidence.map((e, i) => (
        <section key={i}>
          <p>
            {dictionary.polarities[e.polarity]} · {e.locator}
          </p>
          {e.excerpt ? <blockquote>{e.excerpt}</blockquote> : null}
          <Link
            href={`/api/data-foundation/assets/${e.source?.versionId ?? row.versionId}/${e.assetId}`}
          >
            {copy.original}
          </Link>
        </section>
      ))}
      {row.candidate.supersedesId ? (
        <p>
          <Link
            href={relationViewHref(
              `http://local/${locale}/data-foundation/catalog/${row.dataItemId}?version=${row.versionId}`,
              {
                dataItemId: row.dataItemId,
                versionId: row.versionId,
                sources: [],
                status: row.status,
                preview: row.status === 'PENDING_REVIEW',
                entity: null,
                pages: 1,
                assertionId: row.candidate.supersedesId,
                revisionMode: 'all',
              },
            )}
          >
            {copy.supersedes}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
