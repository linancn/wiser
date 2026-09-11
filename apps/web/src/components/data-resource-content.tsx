'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExplorationResultSchema,
  type ExplorationResult,
  type ExplorationRecord,
  type ExplorationGraphNode,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import {
  assetContentHref,
  contentFieldLabel,
  preferredContentView,
  sourceFilename,
  type ContentView,
} from '@/lib/data-content-presentation';
import { invalidatesExploration } from '@/lib/exploration-request';
import { DataRasterView } from './data-raster-view';
import { DataKnowledgeRelations } from './data-knowledge-relations';
import { DataAssessment } from './data-assessment';
import { DataReconciliation } from './data-reconciliation';
import { DataContentValue } from './data-content-value';
import { DataExplorerGraph } from './data-explorer-graph';
import styles from './data-resource-content.module.css';
const MapCanvas = dynamic(() => import('./data-explorer-map'), { ssr: false });
export function DataResourceContent({
  locale,
  dataItemId,
  versionId,
  assetIds,
  initialResult,
}: {
  readonly locale: Locale;
  readonly dataItemId: string;
  readonly versionId: string;
  readonly assetIds: readonly string[];
  readonly initialResult: ExplorationResult | null;
}) {
  const copy = getDictionary(locale).dataFoundation.content;
  const explorer = getDictionary(locale).dataFoundation.explorer;
  const [data, setData] = useState(initialResult);
  const [assets, setAssets] = useState(initialResult?.assets ?? []);
  const [fileId, setFileId] = useState(
    initialResult?.selectedAssetId ?? assetIds[0] ?? '',
  );
  const initialAsset = initialResult?.assets?.find(
    (a) => a.assetId === initialResult.selectedAssetId,
  );
  const [view, setView] = useState<ContentView>(
    preferredContentView(initialAsset, initialResult?.records ?? []),
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(initialResult === null);
  const [invalid, setInvalid] = useState(false);
  const [selection, setSelection] = useState<ExplorationRecord | null>(null);
  const [node, setNode] = useState<ExplorationGraphNode | null>(null);
  const [mapData, setMapData] = useState<ExplorationResult | null>(null);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const queryId = initialResult?.queryId;
  const asset = assets.find((a) => a.assetId === fileId);
  const name = sourceFilename(
    asset,
    copy.file.replace(
      '{number}',
      String(Math.max(0, assetIds.indexOf(fileId)) + 1),
    ),
  );
  const labels = Object.fromEntries(
    (asset?.columns ?? []).map((c) => [c.key, c.label]),
  );
  const onInvalidated = useCallback(() => {
    setInvalid(true);
    setData(null);
    setAssets([]);
    setMapData(null);
    setSelection(null);
    setNode(null);
    pending.current?.abort();
  }, []);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!initialResult) return;
    const expires = Date.parse(initialResult.expiresAt);
    const timer = setTimeout(onInvalidated, Math.max(0, expires - Date.now()));
    const resume = () => {
      if (Date.now() >= expires) onInvalidated();
    };
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [initialResult, onInvalidated]);
  useEffect(() => {
    if (view !== 'map' || !queryId || invalid) return;
    const controller = new AbortController();
    setMapData(null);
    void (async () => {
      try {
        const response = await fetch('/api/data-foundation/explore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ queryId, view: 'map', first: 1 }),
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          if (invalidatesExploration(response.status)) onInvalidated();
          throw Error('Map unavailable');
        }
        const result = ExplorationResultSchema.parse(await response.json());
        if (result.queryId !== queryId || result.view !== 'map')
          throw Error('Invalid map');
        if (!controller.signal.aborted) setMapData(result);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [view, queryId, invalid, onInvalidated]);
  async function load(
    nextFile: string,
    after?: string,
    nextPage = 0,
    chooseView = false,
  ) {
    if (!queryId) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setFailed(false);
    setSelection(null);
    setNode(null);
    setData(null);
    setFileId(nextFile);
    try {
      const response = await fetch('/api/data-foundation/explore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queryId,
          view: 'records',
          versionId,
          assetId: nextFile,
          first: 25,
          ...(after ? { after } : {}),
        }),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        if (invalidatesExploration(response.status)) onInvalidated();
        throw Error('Content unavailable');
      }
      const result = ExplorationResultSchema.parse(await response.json());
      if (
        result.queryId !== queryId ||
        result.view !== 'records' ||
        result.selectedAssetId !== nextFile
      )
        throw Error('Invalid content');
      if (controller.signal.aborted) return;
      setData(result);
      setAssets(result.assets ?? []);
      setPage(nextPage);
      if (chooseView) {
        setView(
          preferredContentView(
            result.assets?.find((a) => a.assetId === nextFile),
            result.records ?? [],
          ),
        );
        setCursors([undefined]);
      }
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  if (invalid)
    return (
      <section className={styles.frame}>
        <p role="alert">{explorer.expired}</p>
        <Link
          href={`/${locale}/data-foundation/catalog/${dataItemId}?version=${versionId}`}
        >
          {copy.reload}
        </Link>
      </section>
    );
  const views: ContentView[] = [
    'table',
    'document',
    'structured',
    ...(data?.records?.some((r) =>
      ['RASTER_BAND', 'NETCDF_VARIABLE'].includes(
        typeof r.values['__kind'] === 'string' ? r.values['__kind'] : '',
      ),
    )
      ? ['raster' as const]
      : []),
    'map',
    'graph',
    'original',
  ];
  const visibleColumns = asset?.columns.filter((c) => c.key !== '__kind') ?? [];
  const records = data?.records ?? [];
  const previewable =
    asset?.status !== 'INVALID' &&
    asset?.status !== 'EMPTY' &&
    /\.(?:pdf|html?|txt|md|csv|json|geojson|png|jpe?g|gif|webp)$/i.test(name);
  return (
    <section
      className={styles.frame}
      aria-label={copy.title}
      data-testid="resource-content"
    >
      <header className={styles.heading}>
        <div>
          <h2>{copy.title}</h2>
          <p>{explorer.recordCountScope}</p>
          <p>
            {explorer.independentObservations}
            {' · '}
            <strong>{explorer.observationsUnverified}</strong>
          </p>
          <p>{explorer.observationVerification}</p>
        </div>
        {queryId ? (
          <Link
            href={`/${locale}/data-foundation/explore?dataItem=${dataItemId}&version=${versionId}&view=records`}
          >
            {copy.analyze}
          </Link>
        ) : null}
      </header>
      <DataKnowledgeRelations
        key={versionId}
        locale={locale}
        dataItemId={dataItemId}
        versionId={versionId}
      />
      <DataAssessment
        key={fileId}
        locale={locale}
        dataItemId={dataItemId}
        versionId={versionId}
        asset={asset ?? null}
      />
      <DataReconciliation
        locale={locale}
        dataItemId={dataItemId}
        versionId={versionId}
        queryId={queryId}
        assets={assets}
        initialAnalysisId={initialResult?.records?.[0]?.analysisId}
      />
      <div className={styles.workspace}>
        <aside className={styles.files} aria-label={copy.files}>
          <h3>
            {copy.files} <span>{assetIds.length}</span>
          </h3>
          <ul>
            {assetIds.map((id, index) => {
              const file = assets.find((a) => a.assetId === id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-pressed={id === fileId}
                    onClick={() => void load(id, undefined, 0, true)}
                    disabled={busy || !queryId}
                  >
                    {sourceFilename(
                      file,
                      copy.file.replace('{number}', String(index + 1)),
                    )}
                    {file ? (
                      <small>
                        {file.status === 'MANIFEST'
                          ? copy.registration
                          : copy.assetStatus[file.status]}
                      </small>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
        <div className={styles.body}>
          <div className={styles.toolbar}>
            <div>
              <h3>{name}</h3>
              {asset ? (
                <span>
                  {explorer.parsedFileRecords.replace(
                    '{count}',
                    asset.recordCount === null
                      ? explorer.unknown
                      : asset.recordCount.toLocaleString(locale),
                  )}
                </span>
              ) : null}
            </div>
            {fileId ? (
              <a
                className={styles.download}
                href={assetContentHref(versionId, fileId, name, locale)}
                download={name}
              >
                {copy.download}
              </a>
            ) : null}
          </div>
          <div className={styles.tabs} role="tablist" aria-label={copy.views}>
            {views.map((tab, index) => (
              <button
                type="button"
                key={tab}
                role="tab"
                id={`content-tab-${tab}`}
                aria-selected={tab === view}
                aria-controls="resource-content-panel"
                tabIndex={tab === view ? 0 : -1}
                disabled={busy}
                onClick={() => {
                  setView(tab);
                  setFailed(false);
                }}
                onKeyDown={(event) => {
                  let next = index;
                  if (event.key === 'ArrowRight')
                    next = (index + 1) % views.length;
                  else if (event.key === 'ArrowLeft')
                    next = (index + views.length - 1) % views.length;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = views.length - 1;
                  else return;
                  event.preventDefault();
                  setView(views[next]);
                  document
                    .getElementById(`content-tab-${views[next]}`)
                    ?.focus();
                }}
              >
                {copy.view[tab]}
              </button>
            ))}
          </div>
          <div
            id="resource-content-panel"
            role="tabpanel"
            aria-labelledby={`content-tab-${view}`}
            className={styles.panel}
            aria-busy={busy}
          >
            {failed ? (
              <p role="alert">
                {copy.failed}{' '}
                <button
                  onClick={() =>
                    queryId ? void load(fileId) : window.location.reload()
                  }
                >
                  {copy.reload}
                </button>
              </p>
            ) : null}
            {busy ? <p role="status">{copy.loading}</p> : null}
            {view === 'table' ? (
              <>
                <div
                  className={styles.tableScroll}
                  tabIndex={0}
                  role="region"
                  aria-label={copy.view.table}
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        {visibleColumns.map((column) => (
                          <th scope="col" key={column.key} title={column.key}>
                            {contentFieldLabel(
                              column.key,
                              column.label,
                              locale,
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((record) => (
                        <tr key={record.recordId}>
                          <th scope="row">
                            <button
                              onClick={() => setSelection(record)}
                              aria-label={`${explorer.selectRecord} ${record.index}`}
                            >
                              {record.index}
                            </button>
                          </th>
                          {visibleColumns.map((column) => (
                            <td key={column.key}>
                              <DataContentValue
                                locale={locale}
                                value={record.values[column.key]}
                                field={column.label}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {records.length === 0 && !busy && !failed ? (
                  <p>{copy.noRecords}</p>
                ) : null}
              </>
            ) : null}
            {view === 'document' || view === 'structured' ? (
              <div className={styles.documents}>
                {records.map((record) => (
                  <article key={record.recordId}>
                    <DataContentValue
                      locale={locale}
                      value={record.values}
                      labels={labels}
                      expanded
                    />
                  </article>
                ))}
                {records.length === 0 && !busy ? <p>{copy.noRecords}</p> : null}
              </div>
            ) : null}
            {view === 'raster' ? (
              <DataRasterView records={records} locale={locale} />
            ) : null}
            {view === 'original' ? (
              previewable ? (
                <iframe
                  title={copy.preview}
                  className={styles.preview}
                  sandbox={/\.pdf$/i.test(name) ? undefined : ''}
                  referrerPolicy="no-referrer"
                  src={assetContentHref(
                    versionId,
                    fileId,
                    name,
                    locale,
                    'preview',
                  )}
                />
              ) : (
                <p>
                  {asset?.status === 'INVALID' || asset?.status === 'EMPTY'
                    ? copy.invalidOriginal
                    : copy.noPreview}
                </p>
              )
            ) : null}
            {view === 'map' ? (
              mapData ? (
                <MapCanvas
                  locale={locale}
                  result={mapData}
                  selectedId={selection?.recordId ?? null}
                  onSelect={setSelection}
                  onInvalidated={onInvalidated}
                />
              ) : !failed ? (
                <p role="status">{copy.loading}</p>
              ) : null
            ) : null}
            {view === 'graph' && queryId ? (
              <DataExplorerGraph
                key={queryId}
                locale={locale}
                queryId={queryId}
                versionId={versionId}
                selectedRecord={selection}
                selectedNode={node}
                onSelect={setNode}
                onInvalidated={onInvalidated}
              />
            ) : null}
          </div>
          {['table', 'document', 'structured', 'raster'].includes(view) &&
          queryId ? (
            <footer className={styles.pagination}>
              <button
                disabled={busy || page === 0}
                onClick={() => void load(fileId, cursors[page - 1], page - 1)}
              >
                {explorer.previous}
              </button>
              <span>
                {copy.page.replace('{page}', String(page + 1))} ·{' '}
                {data?.totalCount.toLocaleString(locale) ?? '—'}{' '}
                {explorer.records}
              </span>
              <button
                disabled={busy || !data?.nextCursor}
                onClick={() => {
                  if (!data?.nextCursor) return;
                  setCursors([...cursors.slice(0, page + 1), data.nextCursor]);
                  void load(fileId, data.nextCursor, page + 1);
                }}
              >
                {explorer.next}
              </button>
            </footer>
          ) : null}
          {selection || node ? (
            <aside className={styles.selection}>
              <h3>{copy.selection}</h3>
              <button
                onClick={() => {
                  setSelection(null);
                  setNode(null);
                }}
              >
                {explorer.close}
              </button>
              <DataContentValue
                locale={locale}
                value={
                  selection?.values ??
                  node?.record?.values ?? { name: node?.label }
                }
                labels={labels}
                expanded
              />
            </aside>
          ) : null}
        </div>
      </div>
    </section>
  );
}
