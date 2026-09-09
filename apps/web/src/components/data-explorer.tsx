'use client';
import { dataResourceName } from '@/lib/data-foundation-presentation';

import { graphNodeLabel } from '@/lib/data-graph-label';

import { DataExplorerInspector } from './data-explorer-inspector';
import { DataExplorerSaved } from './data-explorer-saved';
import { ExplorationViewContext } from './exploration-view-context';
import { createExplorationViewState } from '@/lib/exploration-view-state';
import { invalidatesExploration } from '@/lib/exploration-request';
import {
  explorationHref,
  explorationView,
  explorationViews,
  type ExplorationView,
} from '@/lib/exploration-navigation';
import Link from 'next/link';
import { sourceLimitationLabel } from '@/lib/data-foundation-presentation';
import { EXPLORATION_TOOLS } from '@/lib/navigation';
import { DataExplorerReadiness } from './data-explorer-readiness';
import dynamic from 'next/dynamic';
import { DataExplorerGraph } from './data-explorer-graph';
import {
  useMemo,
  useEffect,
  useRef,
  useState,
  useReducer,
  useCallback,
  type FormEvent,
} from 'react';
import {
  type OpenExplorationViewOutput,
  ExplorationResultSchema,
  ExplorationReadinessSchema,
  type ExplorationReadiness,
  type ExplorationResult,
  type ExplorationResource,
  type ExplorationRecord,
  type ExplorationGraphNode,
  type ExplorationAnalysisAsset,
  type QuerySpec,
  type ExplorationBounds,
  type RecordQuery,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import { explorationSelectionReducer } from '@/lib/exploration-selection';
import {
  DataExplorerAnalysis,
  formatRecordValue,
} from './data-explorer-analysis';
import styles from './data-explorer.module.css';

const DataExplorerAggregate = dynamic(
  () =>
    import('./data-explorer-aggregate').then(
      (module) => module.DataExplorerAggregate,
    ),
  { ssr: false },
);

export function DataExplorer({
  locale,
  initialResult,
  initialFailure,
  initialText,
  initialView = 'resources',
  initialSaved,
}: {
  readonly initialSaved?: OpenExplorationViewOutput;
  readonly locale: Locale;
  readonly initialResult: ExplorationResult | null;
  readonly initialFailure: 'expired' | 'unavailable' | null;
  readonly initialText: string;
  readonly initialView?: ExplorationView;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer;
  const [result, setResult] = useState(initialResult);
  const [text, setText] = useState(initialResult?.spec.text ?? initialText);
  const [quality, setQuality] = useState(
    initialResult?.spec.qualityGrades?.[0] ?? '',
  );
  const [provider, setProvider] = useState(
    initialResult?.spec.providers?.[0] ?? '',
  );
  const [kind, setKind] = useState(initialResult?.spec.kinds?.[0] ?? '');
  const [recordReadiness, setRecordReadiness] = useState<
    ExplorationReadiness | ''
  >(initialResult?.spec.readiness?.records?.[0] ?? '');
  const [spatialReadiness, setSpatialReadiness] = useState<
    ExplorationReadiness | ''
  >(initialResult?.spec.readiness?.spatial?.[0] ?? '');
  const [selection, dispatch] = useReducer(explorationSelectionReducer, {
    queryId: initialResult?.queryId ?? null,
    resource: initialSaved?.selectedResource ?? null,
    record: initialSaved?.selectedRecord ?? null,
    node: initialSaved?.selectedNode ?? null,
  });
  const selected = selection.resource;
  const selectedRecord = selection.record;
  const selectedNode = selection.node;
  const focusedVersion =
    selectedRecord?.versionId ??
    selectedNode?.versionId ??
    selected?.versionId ??
    result?.spec.versions?.[0]?.versionId ??
    null;
  const [view, setView] = useState<ExplorationView>(initialView);
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
  const selectNode = useCallback(
    (node: ExplorationGraphNode) => {
      if (result)
        dispatch({
          type: 'node',
          queryId: result.queryId,
          node,
          resource:
            result.resources.find(
              (resource) => resource.versionId === node.versionId,
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
  const [cursors, setCursors] = useState<(string | undefined)[]>(
    initialSaved?.viewSpec.navigation?.resources?.cursors.map(
      (value) => value ?? undefined,
    ) ?? [undefined],
  );
  const [page, setPage] = useState(
    initialSaved?.viewSpec.navigation?.resources?.page ?? 0,
  );
  const resourceFirst =
    initialSaved?.result.queryId === result?.queryId
      ? (initialSaved?.viewSpec.requests.resources?.first ?? 25)
      : 25;
  const viewState = useMemo(() => {
    if (!result) return null;
    const state = createExplorationViewState(
      result.queryId,
      initialSaved?.result.queryId === result.queryId
        ? initialSaved.viewSpec
        : undefined,
    );
    if (!state.initial.requests.statistics)
      state.report('statistics', {
        queryId: result.queryId,
        view: 'resources',
        first: 25,
      });
    return state;
  }, [result?.queryId, initialSaved]);
  if (result && viewState) {
    const request = {
      queryId: result.queryId,
      view: 'resources' as const,
      first: resourceFirst,
      ...(cursors[page] ? { after: cursors[page] } : {}),
    };
    viewState.report('resources', request, {
      page,
      cursors: cursors.map((value) => value ?? null),
    });
  }
  const capture = () => {
    if (busy || !viewState) return null;
    const source = selectedRecord ?? selectedNode ?? selected;
    return viewState.capture(
      view,
      source
        ? {
            dataItemId: source.dataItemId,
            versionId: source.versionId,
            ...(selectedRecord
              ? {
                  recordId: selectedRecord.recordId,
                  assetId: selectedRecord.assetId,
                }
              : {}),
            ...(selectedNode
              ? {
                  nodeId: selectedNode.id,
                  ...(selectedNode.assetId
                    ? { assetId: selectedNode.assetId }
                    : {}),
                }
              : {}),
          }
        : undefined,
    );
  };
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const activeQueryId = useRef(result?.queryId ?? null);
  activeQueryId.current = result?.queryId ?? null;
  const invalidate = useCallback((queryId: string, status = 410) => {
    if (activeQueryId.current !== queryId) return;
    activeQueryId.current = null;
    setResult(null);
    dispatch({ type: 'query', queryId: null });
    setRecordAssets([]);
    setCursors([undefined]);
    setPage(0);
    setView('resources');
    setFailure([401, 403].includes(status) ? 'unavailable' : 'expired');
  }, []);
  useEffect(() => {
    if (!result) return;
    const expires = Date.parse(result.expiresAt);
    const expire = () => invalidate(result.queryId);
    const timer = window.setTimeout(expire, Math.max(0, expires - Date.now()));
    const resume = () => {
      if (Date.now() >= expires) expire();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [result?.queryId, result?.expiresAt, invalidate]);

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
        if (!response.ok) {
          if (
            !controller.signal.aborted &&
            invalidatesExploration(response.status)
          )
            invalidate(result.queryId, response.status);
          return;
        }
        const data = ExplorationResultSchema.parse(await response.json());
        if (!controller.signal.aborted && data.assets)
          setRecordAssets(data.assets);
      } catch {
        /* The selected record remains readable while provenance can be retried. */
      }
    })();
    return () => controller.abort();
  }, [result, selectedRecord, recordAssets, invalidate]);
  const number = new Intl.NumberFormat(locale);

  async function query(
    input: unknown,
    targetPage: number,
    reset: boolean,
    restoreView?: ExplorationView,
    historyAction?: 'pushState' | 'replaceState',
  ) {
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
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (invalidatesExploration(response.status) && activeQueryId.current)
          invalidate(activeQueryId.current, response.status);
        setFailure(
          [404, 409, 410, 422].includes(response.status)
            ? 'expired'
            : 'unavailable',
        );
        return;
      }
      const next = ExplorationResultSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      setResult(next);
      setPage(targetPage);
      if (reset) {
        setView(restoreView ?? 'resources');
        dispatch({ type: 'query', queryId: next.queryId });
        setRecordAssets([]);
        setCursors([undefined]);
        setText(next.spec.text ?? '');
        setQuality(next.spec.qualityGrades?.[0] ?? '');
        setProvider(next.spec.providers?.[0] ?? '');
        setKind(next.spec.kinds?.[0] ?? '');
        setRecordReadiness(next.spec.readiness?.records?.[0] ?? '');
        setSpatialReadiness(next.spec.readiness?.spatial?.[0] ?? '');
      } else
        setCursors((current) => {
          const updated = [...current];
          updated[targetPage + 1] = next.nextCursor;
          return updated;
        });
      if (restoreView) setView(restoreView);
      const method =
        historyAction ??
        (reset && restoreView === undefined ? 'pushState' : 'replaceState');
      window.history[method](
        window.history.state,
        '',
        explorationHref(
          locale,
          next.queryId,
          restoreView ?? (reset ? 'resources' : view),
        ),
      );
    } catch {
      if (!controller.signal.aborted) setFailure('unavailable');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const restore = useRef<
    (queryId: string | null, nextView: ExplorationView) => void
  >(() => {});
  restore.current = (queryId, nextView) => {
    pending.current?.abort();
    setResult(null);
    dispatch({ type: 'query', queryId: null });
    setRecordAssets([]);
    setCursors([undefined]);
    setPage(0);
    setView(nextView);
    if (queryId)
      void query({ queryId, view: 'resources', first: 25 }, 0, true, nextView);
    else {
      setBusy(false);
      setFailure('expired');
    }
  };
  useEffect(() => {
    if (initialResult && !initialSaved)
      window.history.replaceState(
        window.history.state,
        '',
        explorationHref(locale, initialResult.queryId, initialView),
      );
    const back = () => {
      if (window.location.pathname !== `/${locale}/data-foundation/explore`)
        return;
      const parameters = new URLSearchParams(window.location.search);
      if (parameters.has('saved')) {
        window.location.reload();
        return;
      }
      restore.current(
        parameters.get('query'),
        explorationView(parameters.get('view')),
      );
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [locale, initialResult, initialView, initialSaved]);
  function changeView(nextView: ExplorationView) {
    setView(nextView);
    if (result)
      window.history.replaceState(
        window.history.state,
        '',
        explorationHref(locale, result.queryId, nextView),
      );
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const spec: QuerySpec = {
      ...(text.trim() ? { text: text.trim() } : {}),
      ...(provider.trim() ? { providers: [provider.trim()] } : {}),
      ...(kind
        ? { kinds: [kind as NonNullable<QuerySpec['kinds']>[number]] }
        : {}),
      ...(recordReadiness || spatialReadiness
        ? {
            readiness: {
              ...(recordReadiness ? { records: [recordReadiness] } : {}),
              ...(spatialReadiness ? { spatial: [spatialReadiness] } : {}),
            },
          }
        : {}),
      ...(quality ? { qualityGrades: [quality as 'A' | 'B' | 'C'] } : {}),
    };
    void query({ spec, view: 'resources', first: 25 }, 0, true);
  }
  function configureRecords(recordQuery: RecordQuery | undefined) {
    if (!result) return;
    const versionId =
      selectedRecord?.versionId ??
      selectedNode?.versionId ??
      selected?.versionId ??
      result.spec.versions?.[0]?.versionId;
    const dataItemId =
      selectedRecord?.dataItemId ??
      selectedNode?.dataItemId ??
      selected?.dataItemId ??
      result.spec.versions?.[0]?.dataItemId;
    if (!versionId || !dataItemId) return;
    const { recordQuery: previous, ...spec } = result.spec;
    void previous;
    void query(
      {
        baseQueryId: result.queryId,
        spec: {
          ...spec,
          versions: [{ dataItemId, versionId }],
          ...(recordQuery ? { recordQuery } : {}),
        },
        view: 'resources',
        first: 25,
      },
      0,
      true,
      'records',
      'pushState',
    );
  }
  function configureBounds(bounds: ExplorationBounds | undefined) {
    if (!result) return;
    const { spatialBounds: _bounds, ...spec } = result.spec;
    void query(
      {
        baseQueryId: result.queryId,
        spec: { ...spec, ...(bounds ? { spatialBounds: bounds } : {}) },
        view: 'resources',
        first: 25,
      },
      0,
      true,
      'map',
      'pushState',
    );
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
        first: resourceFirst,
        after: result.nextCursor,
      },
      page + 1,
      false,
    );
  }

  return (
    <ExplorationViewContext.Provider value={viewState}>
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
          <details className={styles.filters}>
            <summary>{copy.moreFilters}</summary>
            <div className={styles.filterFields}>
              <label>
                <span>{copy.providerExact}</span>
                <input
                  value={provider}
                  maxLength={2048}
                  onChange={(event) => setProvider(event.target.value)}
                />
              </label>
              <label>
                <span>{copy.kindLabel}</span>
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                >
                  <option value="">{copy.allKinds}</option>
                  {(
                    [
                      'PROVIDER',
                      'DATASET_INTERFACE',
                      'CATALOG_ENTRY',
                      'FILE_COLLECTION',
                      'DATASET',
                    ] as const
                  ).map((value) => (
                    <option key={value} value={value}>
                      {copy.kinds[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{copy.recordReadiness}</span>
                <select
                  value={recordReadiness}
                  onChange={(event) =>
                    setRecordReadiness(
                      event.target.value === ''
                        ? ''
                        : ExplorationReadinessSchema.parse(event.target.value),
                    )
                  }
                >
                  <option value="">{copy.allReadiness}</option>
                  {ExplorationReadinessSchema.options
                    .filter(
                      (value) =>
                        !['NO_SPATIAL_DATA', 'CRS_UNVERIFIED'].includes(value),
                    )
                    .map((value) => (
                      <option key={value} value={value}>
                        {copy.readiness[value]}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>{copy.spatialReadiness}</span>
                <select
                  value={spatialReadiness}
                  onChange={(event) =>
                    setSpatialReadiness(
                      event.target.value === ''
                        ? ''
                        : ExplorationReadinessSchema.parse(event.target.value),
                    )
                  }
                >
                  <option value="">{copy.allReadiness}</option>
                  {ExplorationReadinessSchema.options.map((value) => (
                    <option key={value} value={value}>
                      {copy.readiness[value]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          <button type="submit">
            {busy ? copy.querying : copy.queryAction}
          </button>
        </form>
        <div className={styles.status}>
          <strong data-testid="explorer-total" aria-live="polite">
            {result === null ? '—' : number.format(result.totalCount)}{' '}
            {copy.resources}
          </strong>
          {result?.spec.spatialBounds ? (
            <span>
              {copy.mapLayers.active}{' '}
              <button
                disabled={busy}
                onClick={() => configureBounds(undefined)}
              >
                {copy.mapLayers.clear}
              </button>
            </span>
          ) : null}
          {result?.summary && (
            <details
              className={styles.coverage}
              data-testid="explorer-readiness-summary"
            >
              <summary>
                {copy.analyzedSources}{' '}
                {number.format(result.summary.analyzedResourceCount)} /{' '}
                {number.format(result.summary.resourceCount)} ·{' '}
                {copy.indexedRecords}{' '}
                {number.format(result.summary.indexedRecordCount)} ·{' '}
                {copy.indexedFeatures}{' '}
                {number.format(result.summary.indexedFeatureCount)}
              </summary>
              <div className={styles.coverageStates}>
                {(['records', 'spatial'] as const).map((dimension) => (
                  <section key={dimension}>
                    <strong>{copy[dimension]}</strong>
                    <ul>
                      {result.summary?.[dimension].map((entry) => (
                        <li key={entry.status}>
                          {copy.readiness[entry.status]}:{' '}
                          {number.format(entry.count)}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </details>
          )}
          {!result?.summary && (
            <span>{result?.spec.text ?? copy.allResources}</span>
          )}
          {result ? (
            <DataExplorerSaved
              key={result.queryId}
              locale={locale}
              queryId={result.queryId}
              capture={capture}
            />
          ) : null}
          <details className={styles.tools}>
            <summary>{copy.tools}</summary>
            <nav aria-label={copy.tools}>
              {EXPLORATION_TOOLS.map((tool) => (
                <Link
                  key={tool.key}
                  href={`/${locale}/data-foundation${tool.path}`}
                >
                  {getDictionary(locale).dataFoundation.navigation[tool.key]}
                </Link>
              ))}
            </nav>
          </details>
          <div
            className={styles.viewTabs}
            role="tablist"
            aria-label={copy.viewLabel}
          >
            {explorationViews.map((value) => (
              <button
                key={value}
                role="tab"
                id={`explorer-tab-${value}`}
                tabIndex={view === value ? 0 : -1}
                onKeyDown={(event) => {
                  const values = explorationViews;
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
                  changeView(next);
                  document.getElementById(`explorer-tab-${next}`)?.focus();
                }}
                aria-selected={view === value}
                aria-controls="explorer-view"
                onClick={() => changeView(value)}
              >
                {value === 'resources'
                  ? copy.resourceView
                  : value === 'records'
                    ? copy.records
                    : value === 'map'
                      ? copy.mapView
                      : value === 'graph'
                        ? copy.graphView
                        : copy.statisticsView}
              </button>
            ))}
          </div>
        </div>
        {result ? (
          <div className={styles.countScope}>
            <p>{copy.recordCountScope}</p>
            <dl>
              <dt>{copy.independentObservations}</dt>
              <dd>{copy.observationsUnverified}</dd>
            </dl>
            <p>{copy.observationVerification}</p>
          </div>
        ) : null}
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
                  <table className={styles.resourceTable}>
                    <thead>
                      <tr>
                        <th scope="col">{copy.name}</th>
                        <th scope="col">{copy.provider}</th>
                        <th scope="col">{copy.indexedRecords}</th>
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
                            <Link
                              className={styles.resource}
                              href={`/${locale}/data-foundation/catalog/${resource.dataItemId}?version=${resource.versionId}`}
                            >
                              {dataResourceName(resource.name)}
                            </Link>
                            <button
                              aria-label={dataResourceName(resource.name)}
                              aria-pressed={
                                selected?.versionId === resource.versionId
                              }
                              onClick={() => setSelected(resource)}
                            >
                              {
                                getDictionary(locale).dataFoundation.content
                                  .select
                              }
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
                            first: resourceFirst,
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
            ) : result?.summary && view === 'statistics' ? (
              <>
                <DataExplorerAggregate
                  key={`${result.queryId}:${focusedVersion}`}
                  locale={locale}
                  queryId={result.queryId}
                  versionId={
                    selectedRecord?.versionId ??
                    selectedNode?.versionId ??
                    selected?.versionId ??
                    result.spec.versions?.[0]?.versionId ??
                    null
                  }
                  recordQuery={result.spec.recordQuery}
                  onConfigure={configureRecords}
                  onInvalidated={invalidate}
                />
                <DataExplorerReadiness
                  key={`${result.queryId}:${focusedVersion}`}
                  initiallyOpen={!focusedVersion}
                  summary={result.summary}
                  locale={locale}
                  onFilter={(dimension, status) => {
                    const readiness = {
                      ...result.spec.readiness,
                      [dimension]: [status],
                    };
                    if (dimension === 'records') setRecordReadiness(status);
                    else setSpatialReadiness(status);
                    setView('resources');
                    void query(
                      {
                        spec: { ...result.spec, readiness },
                        view: 'resources',
                        first: 25,
                      },
                      0,
                      true,
                    );
                  }}
                />
              </>
            ) : result && view === 'graph' ? (
              <DataExplorerGraph
                key={result.queryId}
                queryId={result.queryId}
                locale={locale}
                versionId={
                  selectedRecord?.versionId ??
                  selectedNode?.versionId ??
                  selected?.versionId ??
                  result.spec.versions?.[0]?.versionId ??
                  null
                }
                selectedRecord={selectedRecord}
                selectedNode={selectedNode}
                onSelect={selectNode}
                onInvalidated={invalidate}
              />
            ) : result && (view === 'records' || view === 'map') ? (
              <DataExplorerAnalysis
                key={`${result.queryId}:${view}:${view === 'records' ? focusedVersion : ''}`}
                locale={locale}
                queryId={result.queryId}
                view={view}
                versionId={
                  selectedRecord?.versionId ??
                  selectedNode?.versionId ??
                  selected?.versionId ??
                  result.spec.versions?.[0]?.versionId ??
                  null
                }
                selectedRecord={selectedRecord}
                onSelect={selectRecord}
                onData={onAnalysisData}
                onConfigure={configureRecords}
                onBounds={configureBounds}
                configuring={busy}
                onInvalidated={invalidate}
              />
            ) : null}
          </section>
          <DataExplorerInspector
            locale={locale}
            selectionKey={
              selectedRecord?.recordId ??
              selectedNode?.id ??
              selected?.versionId ??
              null
            }
          >
            {selectedRecord !== null ? (
              <>
                <div className={styles.inspectorHeading}>
                  <h2>{copy.recordDetails}</h2>
                  <button
                    aria-label={copy.clearSelection}
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
            ) : selectedNode !== null ? (
              <>
                <div className={styles.inspectorHeading}>
                  <h2>{copy.graphNodeDetails}</h2>
                  <button
                    aria-label={copy.clearSelection}
                    onClick={() => setSelected(null)}
                  >
                    ×
                  </button>
                </div>
                <h3>{graphNodeLabel(selectedNode, locale)}</h3>
                <dl>
                  <dt>{copy.graphKind}</dt>
                  <dd>{copy.graphNodeKinds[selectedNode.kind]}</dd>
                  <dt>{copy.version}</dt>
                  <dd>
                    <code>{selectedNode.versionId}</code>
                  </dd>
                  {selectedNode.sourceHash ? (
                    <>
                      <dt>{copy.sourceHash}</dt>
                      <dd>
                        <code>{selectedNode.sourceHash}</code>
                      </dd>
                    </>
                  ) : null}
                </dl>
                <Link
                  href={`/${locale}/data-foundation/catalog/${selectedNode.dataItemId}?version=${selectedNode.versionId}`}
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
                  <h2>{dataResourceName(selected.name)}</h2>
                  <button
                    aria-label={copy.clearSelection}
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
                  <dt>{copy.indexedRecords}</dt>
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
                      <li key={index}>
                        {sourceLimitationLabel(
                          value,
                          getDictionary(locale).dataFoundation.presentation,
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </DataExplorerInspector>
        </div>
      </main>
    </ExplorationViewContext.Provider>
  );
}
