import Link from 'next/link';
import type { DataCatalogItemDto } from '@/lib/data-foundation';
import { getDictionary, type Locale } from '@/lib/i18n';
import { DataEmpty, StatusBadge } from './data-foundation-workspace';
import styles from './data-catalog-table.module.css';

export function DataCatalogTable({
  items,
  locale,
}: {
  readonly items: readonly DataCatalogItemDto[];
  readonly locale: Locale;
}) {
  const copy = getDictionary(locale).dataFoundation;
  if (items.length === 0)
    return (
      <DataEmpty title={copy.catalogPage.tableLabel} copy={copy.common.empty} />
    );
  return (
    <>
      <p className={styles.hint}>{copy.catalogPage.governanceHint}</p>
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
                    {item.name}
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
                <td>{copy.status.security[item.securityLevel]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
