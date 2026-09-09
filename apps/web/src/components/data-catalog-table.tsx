import { dataResourceName } from '@/lib/data-foundation-presentation';
import Link from 'next/link';
import type { DataCatalogItemDto } from '@/lib/data-foundation';
import { getDictionary, type Locale } from '@/lib/i18n';
import { DataEmpty, StatusBadge } from './data-foundation-workspace';
import styles from './data-catalog-table.module.css';

export function DataCatalogTable({
  items,
  locale,
  qualityReview = false,
}: {
  readonly items: readonly DataCatalogItemDto[];
  readonly locale: Locale;
  readonly qualityReview?: boolean;
}) {
  const copy = getDictionary(locale).dataFoundation;
  if (items.length === 0)
    return (
      <DataEmpty title={copy.catalogPage.tableLabel} copy={copy.common.empty} />
    );
  return (
    <>
      <p className={styles.hint}>{copy.presentation.checkHint}</p>
      <div
        className={styles.frame}
        tabIndex={0}
        role="region"
        aria-label={copy.catalogPage.tableLabel}
      >
        <table aria-label={copy.catalogPage.tableLabel}>
          <thead>
            <tr>
              <th scope="col">{copy.explorer.name}</th>
              <th scope="col">{copy.common.source}</th>
              <th scope="col">{copy.common.publication}</th>
              <th scope="col">{copy.common.quality}</th>
              {qualityReview ? (
                <th scope="col">{copy.common.acceptance}</th>
              ) : null}
              <th scope="col">{copy.common.security}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.dataItemId} data-testid="data-item-row">
                <th scope="row">
                  <Link
                    href={`/${locale}/data-foundation/catalog/${item.dataItemId}`}
                  >
                    {dataResourceName(item.name)}
                  </Link>
                </th>
                <td>{item.sourceOrganization}</td>
                <td>
                  <StatusBadge
                    code={item.publicationStatus}
                    label={copy.status.publication[item.publicationStatus]}
                  />
                </td>
                <td>{item.qualityGrade}</td>
                {qualityReview ? (
                  <td>
                    <StatusBadge
                      code={item.acceptanceStatus}
                      label={copy.status.acceptance[item.acceptanceStatus]}
                    />
                  </td>
                ) : null}
                <td>{copy.status.security[item.securityLevel]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
