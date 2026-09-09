'use client';
import { useState } from 'react';
import { getDictionary, type Locale } from '@/lib/i18n';
import { contentFieldLabel } from '@/lib/data-content-presentation';
import styles from './data-resource-content.module.css';
export function DataContentValue({
  value,
  locale,
  expanded = false,
  labels = {},
  depth = 0,
  field = '',
}: {
  readonly value: unknown;
  readonly locale: Locale;
  readonly expanded?: boolean;
  readonly labels?: Readonly<Record<string, string>>;
  readonly depth?: number;
  readonly field?: string;
}) {
  const copy = getDictionary(locale).dataFoundation.content;
  const [open, setOpen] = useState(expanded);
  const [limit, setLimit] = useState(30);
  if (value === null || value === undefined)
    return <span className={styles.muted}>{copy.notProvided}</span>;
  if (typeof value === 'boolean')
    return <span>{value ? copy.yes : copy.no}</span>;
  if (typeof value === 'string' || typeof value === 'number') {
    const codes: Readonly<Record<string, string>> = copy.codes;
    const text =
      typeof value === 'string' &&
      ['__kind', 'type', 'source', 'sourcename'].includes(field.toLowerCase())
        ? (codes[value] ?? value)
        : String(value);
    return (
      <span
        className={styles.value}
        title={text !== String(value) ? String(value) : undefined}
      >
        {text}
      </span>
    );
  }
  const entries = Array.isArray(value)
    ? value.map((entry: unknown, index) => [String(index + 1), entry] as const)
    : Object.entries(value as Record<string, unknown>);
  if (depth >= 8) return <p>{copy.nestedLimit}</p>;
  return (
    <details
      className={styles.object}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {copy.items.replace('{count}', entries.length.toLocaleString(locale))}
      </summary>
      {open ? (
        <>
          <dl>
            {entries.slice(0, limit).map(([key, entry]) => (
              <div key={key}>
                <dt title={key}>
                  {contentFieldLabel(key, labels[key] ?? key, locale)}
                </dt>
                <dd>
                  <DataContentValue
                    value={entry}
                    locale={locale}
                    depth={depth + 1}
                    field={key}
                  />
                </dd>
              </div>
            ))}
          </dl>
          {entries.length > limit ? (
            <button type="button" onClick={() => setLimit(limit + 30)}>
              {copy.showMore}
            </button>
          ) : null}
        </>
      ) : null}
    </details>
  );
}
