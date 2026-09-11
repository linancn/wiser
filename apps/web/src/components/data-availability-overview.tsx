'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  AssessmentOverviewOutputSchema,
  type AssessmentOverview,
  type IntakeDeclaration,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import { dataResourceName } from '@/lib/data-foundation-presentation';
import styles from './data-reconciliation.module.css';
export function DataAvailabilityOverview({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: string;
}) {
  const dict = getDictionary(locale),
    copy = dict.availabilityOverview,
    labels = dict.assessment;
  const [target, setTarget] = useState<IntakeDeclaration['target']>('DATASET');
  const [result, setResult] = useState<AssessmentOverview | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const [action, setAction] = useState<string | undefined>(undefined);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function load(selected?: string, after?: string) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setFailed(false);
    setAction(selected);
    try {
      const response = await fetch('/api/data-foundation/assessment/overview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target,
          first: 25,
          ...(query ? { query } : {}),
          ...(selected ? { action: selected } : {}),
          ...(after ? { after } : {}),
        }),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        setResult(null);
        throw Error('unavailable');
      }
      const value = AssessmentOverviewOutputSchema.parse(await response.json());
      if (!controller.signal.aborted) setResult(value);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const actionLabel = (key: string) =>
    key === 'UNCHECKED'
      ? copy.unchecked
      : labels.actions[key as keyof typeof labels.actions];
  return (
    <details className={styles.frame}>
      <summary>{copy.title}</summary>
      <div className={styles.body}>
        <p>{copy.hint}</p>
        <label>
          {labels.target}
          <select
            value={target}
            disabled={busy}
            onChange={(e) => {
              setTarget(e.target.value as IntakeDeclaration['target']);
              setResult(null);
              setAction(undefined);
            }}
          >
            {Object.entries(labels.targets).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void load()}>
          {busy ? labels.busy : copy.load}
        </button>
        {failed ? <p role="alert">{labels.failure}</p> : null}
        {result ? (
          <>
            <p>{copy.scope}</p>
            <dl className={styles.metrics}>
              <div>
                <dt>{copy.denominator}</dt>
                <dd>{result.totalCount}</dd>
              </div>
              <div>
                <dt>{copy.checked}</dt>
                <dd>
                  {result.checkedCount} / {result.totalCount}
                </dd>
              </div>
              <div>
                <dt>{copy.unchecked}</dt>
                <dd>
                  {result.uncheckedCount} / {result.totalCount}
                </dd>
              </div>
            </dl>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={busy}
                aria-pressed={!action}
                onClick={() => void load()}
              >
                {copy.all}
              </button>
              {result.counts.map((count) => (
                <button
                  type="button"
                  key={count.action}
                  disabled={busy}
                  aria-pressed={action === count.action}
                  onClick={() => void load(count.action)}
                >
                  {actionLabel(count.action)} · {count.count}
                </button>
              ))}
            </div>
            <p>
              {copy.selected}: {result.selectedCount}
            </p>
            {result.items.length === 0 ? (
              <p>{copy.empty}</p>
            ) : (
              <div
                className={styles.table}
                tabIndex={0}
                role="region"
                aria-label={copy.list}
              >
                <table>
                  <thead>
                    <tr>
                      <th>{copy.list}</th>
                      <th>{labels.acquisition}</th>
                      <th>{labels.coverage}</th>
                      <th>{labels.checkedAt}</th>
                      <th>{labels.next}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => (
                      <tr key={item.dataItemId}>
                        <td>
                          <Link
                            href={`/${locale}/data-foundation/catalog/${item.dataItemId}?version=${item.versionId}`}
                          >
                            {dataResourceName(item.name)}
                          </Link>
                        </td>
                        <td>
                          {item.acquisition
                            ? labels.acquisitions[item.acquisition]
                            : copy.unchecked}
                        </td>
                        <td>
                          {item.coverage
                            ? labels.coverages[item.coverage]
                            : copy.unchecked}
                        </td>
                        <td>
                          {item.checkedAt ? (
                            <time dateTime={item.checkedAt}>
                              {new Date(item.checkedAt).toLocaleString(locale, {
                                timeZone: 'UTC',
                              })}{' '}
                              UTC
                            </time>
                          ) : (
                            copy.unchecked
                          )}
                        </td>
                        <td>{actionLabel(item.nextAction)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.nextCursor ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void load(action, result.nextCursor)}
              >
                {copy.more}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
