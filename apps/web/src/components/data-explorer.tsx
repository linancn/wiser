'use client';

import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  useReducer,
  useCallback,
  type FormEvent,
} from 'react';
import {
  ExplorationResultSchema,
  type ExplorationResult,
  type ExplorationResource,
  type ExplorationRecord,
  type ExplorationAnalysisAsset,
  type QuerySpec,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import { explorationSelectionReducer } from '@/lib/exploration-selection';
import {
  DataExplorerAnalysis,
  formatRecordValue,
} from './data-explorer-analysis';
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
  const [selection, dispatch] = useReducer(explorationSelectionReducer, {
    queryId: initialResult?.queryId ?? null,
    resource: null,
    record: null,
  });
  const selected = selection.resource;
  const selectedRecord = selection.record;
  const [view, setView] = useState<'resources' | 'records' | 'map'>(
    'resources',
  );
  const [recordAssets, setRecordAssets] = useState<
    readonly ExplorationAnalysisAsset[]
  >([]);
  const onAnalysisData = useCallback((data: ExplorationResult) => {
    if (data.assets) setRecordAssets(data.assets);
  }, []);
  const selectRecord = useCallback(
    (record: ExplorationRecord) => {
      if (result)
        dispatch({
          type: 'record',
          queryId: result.queryId,
          record,
          resource:
            result.resources.find(
              (resource) => resource.versionId === record.versionId,
            ) ?? null,
        });
    },
    [result],
  );
  const setSelected = (resource: ExplorationResource | null) => {
    if (result)
      dispatch({ type: 'resource', queryId: result.queryId, resource });
  };
  const [failure, setFailure] = useState(initialFailure);
  const [busy, setBusy] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (
      !result ||
      !selectedRecord ||
      recordAssets.some((asset) => asset.assetId === selectedRecord.assetId)
    )
      return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/data-foundation/explore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
          body: JSON.stringify({
            queryId: result.queryId,
            view: 'records',
            versionId: selectedRecord.versionId,
            assetId: selectedRecord.assetId,
            first: 1,
          }),
        });
        if (!response.ok) return;
        const data = ExplorationResultSchema.parse(await response.json());
        if (!controller.signal.aborted && data.assets)
          setRecordAssets(data.assets);
      } catch {
        /* The selected record remains readable while provenance can be retried. */
      }
    })();
    return () => controller.abort();
  }, [result, selectedRecord, recordAssets]);
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
        dispatch({ type: 'query', queryId: next.queryId });
        setRecordAssets([]);
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
        <div
          className={styles.viewTabs}
          role="tablist"
          aria-label={copy.viewLabel}
        >
          {(['resources', 'records', 'map'] as const).map((value) => (
            <button
              key={value}
              role="tab"
              id={`explorer-tab-${value}`}
              tabIndex={view === value ? 0 : -1}
              onKeyDown={(event) => {
                const values = ['resources', 'records', 'map'] as const;
                let index = values.indexOf(value);
                if (event.key === 'ArrowRight')
                  index = (index + 1) % values.length;
                else if (event.key === 'ArrowLeft')
                  index = (index + values.length - 1) % values.length;
                else if (event.key === 'Home') index = 0;
                else if (event.key === 'End') index = values.length - 1;
                else return;
                event.preventDefault();
                const next = values[index];
                setView(next);
                document.getElementById(`explorer-tab-${next}`)?.focus();
              }}
              aria-selected={view === value}
              aria-controls="explorer-view"
              onClick={() => setView(value)}
            >
              {value === 'resources'
                ? copy.resourceView
                : value === 'records'
                  ? copy.records
                  : copy.mapView}
            </button>
          ))}
        </div>
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
          id="explorer-view"
          role="tabpanel"
          aria-labelledby={`explorer-tab-${view}`}
        >
          {view === 'resources' ? (
            <>
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
                        data-selected={
                          selected?.versionId === resource.versionId
                        }
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
                <button
                  disabled={busy || !result?.nextCursor}
                  onClick={nextPage}
                >
                  {copy.next}
                </button>
              </footer>
            </>
          ) : result ? (
            <DataExplorerAnalysis
              key={result.queryId}
              locale={locale}
              queryId={result.queryId}
              view={view}
              versionId={
                selectedRecord?.versionId ?? selected?.versionId ?? null
              }
              selectedRecord={selectedRecord}
              onSelect={selectRecord}
              onData={onAnalysisData}
            />
          ) : null}
        </section>
        <aside
          className={styles.inspector}
          data-testid="explorer-inspector"
          aria-label={copy.details}
        >
          {selectedRecord !== null ? (
            <>
              <div className={styles.inspectorHeading}>
                <h2>{copy.recordDetails}</h2>
                <button
                  aria-label={copy.close}
                  onClick={() => setSelected(null)}
                >
                  ×
                </button>
              </div>
              <h3>
                {selectedRecord.sourceId ??
                  `${copy.records} ${selectedRecord.index}`}
              </h3>
              <dl>
                <dt>{copy.version}</dt>
                <dd>
                  <code>{selectedRecord.versionId}</code>
                </dd>
                {(
                  recordAssets.find(
                    (asset) => asset.assetId === selectedRecord.assetId,
                  )?.columns ??
                  Object.keys(selectedRecord.values).map((key) => ({
                    key,
                    label: key,
                  }))
                ).map((column) => (
                  <div key={column.key}>
                    <dt>{column.label}</dt>
                    <dd>
                      {formatRecordValue(selectedRecord.values[column.key])}
                    </dd>
                  </div>
                ))}
                <dt>{copy.sourceFile}</dt>
                <dd>
                  {recordAssets
                    .find((asset) => asset.assetId === selectedRecord.assetId)
                    ?.paths.join(', ') ?? copy.unknown}
                </dd>
                <dt>{copy.sourceHash}</dt>
                <dd>
                  <code>
                    {recordAssets.find(
                      (asset) => asset.assetId === selectedRecord.assetId,
                    )?.sourceHash ?? '—'}
                  </code>
                </dd>
              </dl>
              <Link
                href={`/${locale}/data-foundation/catalog/${selectedRecord.dataItemId}?version=${selectedRecord.versionId}`}
              >
                {copy.openData}
              </Link>
            </>
          ) : selected === null ? (
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
