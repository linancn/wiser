'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ExplorationResultSchema,
  type ExplorationResult,
  type ExplorationResource,
  type QuerySpec,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-explorer.module.css';

export function DataExplorer({
  locale,
  initialResult,
  initialFailure,
  initialText,
}: {
  readonly locale: Locale;
  readonly initialResult: ExplorationResult | null;
  readonly initialFailure: 'expired' | 'unavailable' | null;
  readonly initialText: string;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer;
  const [result, setResult] = useState(initialResult);
  const [text, setText] = useState(initialResult?.spec.text ?? initialText);
  const [quality, setQuality] = useState(
    initialResult?.spec.qualityGrades?.[0] ?? '',
  );
  const [selected, setSelected] = useState<ExplorationResource | null>(null);
  const [failure, setFailure] = useState(initialFailure);
  const [busy, setBusy] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const number = new Intl.NumberFormat(locale);

  async function query(input: unknown, targetPage: number, reset: boolean) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch('/api/data-foundation/explore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        setFailure(
          [404, 409, 422].includes(response.status) ? 'expired' : 'unavailable',
        );
        return;
      }
      const next = ExplorationResultSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      setResult(next);
      setPage(targetPage);
      if (reset) {
        setSelected(null);
        setCursors([undefined]);
      } else
        setCursors((current) => {
          const updated = [...current];
          updated[targetPage + 1] = next.nextCursor;
          return updated;
        });
      const parameters = new URLSearchParams({ query: next.queryId });
      if (next.spec.text) parameters.set('q', next.spec.text);
      if (next.spec.qualityGrades?.[0])
        parameters.set('quality', next.spec.qualityGrades[0]);
      window.history.replaceState(
        null,
        '',
        `/${locale}/data-foundation/explore?${parameters}`,
      );
    } catch {
      if (!controller.signal.aborted) setFailure('unavailable');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const spec: QuerySpec = {
      ...(text.trim() ? { text: text.trim() } : {}),
      ...(quality ? { qualityGrades: [quality as 'A' | 'B' | 'C'] } : {}),
    };
    void query({ spec, view: 'resources', first: 25 }, 0, true);
  }
  function nextPage() {
    if (!result?.nextCursor) return;
    setCursors((current) => {
      const updated = [...current];
      updated[page + 1] = result.nextCursor;
      return updated;
    });
    void query(
      {
        queryId: result.queryId,
        view: 'resources',
        first: 25,
        after: result.nextCursor,
      },
      page + 1,
      false,
    );
  }

  return (
    <main
      id="main-content"
      className={`page-main ${styles.explorer}`}
      data-testid="data-explorer"
      data-query-id={result?.queryId ?? ''}
    >
      <header className={styles.heading}>
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <span className={styles.scope}>{copy.scope}</span>
      </header>
      <form className={styles.query} onSubmit={submit}>
        <label className={styles.search}>
          <span className={styles.visuallyHidden}>{copy.queryLabel}</span>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={copy.placeholder}
            maxLength={512}
          />
        </label>
        <label>
          <span className={styles.visuallyHidden}>{copy.quality}</span>
          <select
            value={quality}
            onChange={(event) => setQuality(event.target.value)}
          >
            <option value="">{copy.allQuality}</option>
            {(['A', 'B', 'C'] as const).map((grade) => (
              <option key={grade} value={grade}>
                {copy.quality} {grade}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">{busy ? copy.querying : copy.queryAction}</button>
      </form>
      <div className={styles.status} aria-live="polite">
        <strong data-testid="explorer-total">
          {result === null ? '—' : number.format(result.totalCount)}{' '}
          {copy.resources}
        </strong>
        <span>{result?.spec.text ?? copy.allResources}</span>
        <span>{busy ? copy.querying : copy.versionPinned}</span>
      </div>
      {failure === null ? null : (
        <div role="alert" className={styles.failure}>
          {copy[failure]}
        </div>
      )}
      <div className={styles.workspace}>
        <section
          className={styles.results}
          data-testid="explorer-results"
          aria-label={copy.resources}
          aria-busy={busy}
        >
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{copy.name}</th>
                  <th scope="col">{copy.provider}</th>
                  <th scope="col">{copy.records}</th>
                  <th scope="col">{copy.spatial}</th>
                </tr>
              </thead>
              <tbody>
                {result?.resources.map((resource) => (
                  <tr
                    key={resource.versionId}
                    data-selected={selected?.versionId === resource.versionId}
                  >
                    <td>
                      <button
                        className={styles.resource}
                        aria-pressed={
                          selected?.versionId === resource.versionId
                        }
                        onClick={() => setSelected(resource)}
                      >
                        {resource.name}
                      </button>
                    </td>
                    <td>{resource.provider}</td>
                    <td>
                      {resource.recordCount === null
                        ? copy.readiness[resource.readiness.records]
                        : number.format(resource.recordCount)}
                    </td>
                    <td>
                      {resource.featureCount === null
                        ? copy.readiness[resource.readiness.spatial]
                        : number.format(resource.featureCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result?.resources.length === 0 ? (
            <div className={styles.empty}>
              <h2>{copy.emptyTitle}</h2>
              <p>{copy.emptyDescription}</p>
            </div>
          ) : null}
          <footer className={styles.pagination}>
            <button
              disabled={busy || page === 0 || result === null}
              onClick={() => {
                if (result)
                  void query(
                    {
                      queryId: result.queryId,
                      view: 'resources',
                      first: 25,
                      after: cursors[page - 1],
                    },
                    page - 1,
                    false,
                  );
              }}
            >
              {copy.previous}
            </button>
            <span>
              {copy.page} {page + 1}
            </span>
            <button disabled={busy || !result?.nextCursor} onClick={nextPage}>
              {copy.next}
            </button>
          </footer>
        </section>
        <aside
          className={styles.inspector}
          data-testid="explorer-inspector"
          aria-label={copy.details}
        >
          {selected === null ? (
            <div className={styles.empty}>
              <h2>{copy.selectTitle}</h2>
              <p>{copy.selectDescription}</p>
            </div>
          ) : (
            <>
              <div className={styles.inspectorHeading}>
                <h2>{selected.name}</h2>
                <button
                  aria-label={copy.close}
                  onClick={() => setSelected(null)}
                >
                  ×
                </button>
              </div>
              <dl>
                <dt>{copy.provider}</dt>
                <dd>{selected.provider}</dd>
                <dt>{copy.version}</dt>
                <dd>
                  <code>{selected.versionId}</code>
                </dd>
                <dt>{copy.assets}</dt>
                <dd>{number.format(selected.assetCount)}</dd>
                <dt>{copy.records}</dt>
                <dd>
                  {copy.readiness[selected.readiness.records]} ·{' '}
                  {selected.recordCount === null
                    ? copy.unknown
                    : number.format(selected.recordCount)}
                </dd>
                <dt>{copy.spatial}</dt>
                <dd>
                  {copy.readiness[selected.readiness.spatial]} ·{' '}
                  {selected.featureCount === null
                    ? copy.unknown
                    : number.format(selected.featureCount)}
                </dd>
                <dt>{copy.graph}</dt>
                <dd>{copy.readiness[selected.readiness.graph]}</dd>
              </dl>
              <Link
                href={`/${locale}/data-foundation/catalog/${selected.dataItemId}?version=${selected.versionId}`}
              >
                {copy.openData}
              </Link>
              <details>
                <summary>{copy.limitations}</summary>
                <ul>
                  {selected.limitations.map((value, index) => (
                    <li key={index}>{value}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
