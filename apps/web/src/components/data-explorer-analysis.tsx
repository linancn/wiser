'use client';
import {
  invalidatesExploration,
  type InvalidateExploration,
} from '@/lib/exploration-request';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import {
  ExplorationResultSchema,
  type ExplorationRecord,
  type ExplorationResult,
  type ExplorationBounds,
  type RecordQuery,
} from '@wiser/data-contracts';
import { DataExplorerRecordControls } from './data-explorer-record-controls';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-explorer.module.css';

const MapCanvas = dynamic(() => import('./data-explorer-map'), { ssr: false });
export function DataExplorerAnalysis({
  locale,
  queryId,
  view,
  versionId,
  selectedRecord,
  onSelect,
  onInvalidated,
  onData,
  onConfigure,
  onBounds,
  configuring = false,
}: {
  readonly locale: Locale;
  readonly onInvalidated: InvalidateExploration;
  readonly queryId: string;
  readonly view: 'records' | 'map';
  readonly versionId: string | null;
  readonly selectedRecord: ExplorationRecord | null;
  readonly onSelect: (record: ExplorationRecord) => void;
  readonly onData: (result: ExplorationResult) => void;
  readonly onConfigure?: (configuration: RecordQuery | undefined) => void;
  readonly configuring?: boolean;
  readonly onBounds?: (bounds: ExplorationBounds | undefined) => void;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer;
  const [result, setResult] = useState<ExplorationResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assetId, setAssetId] = useState<string | undefined>(undefined);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  const cursor = cursors[page];
  const requestVersionId = view === 'records' ? versionId : null;
  useEffect(() => {
    setAssetId(undefined);
    setPage(0);
    setCursors([undefined]);
  }, [queryId, requestVersionId, view]);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setFailed(false);
    if (view === 'records' && requestVersionId === null)
      return () => controller.abort();
    setBusy(true);
    void (async () => {
      try {
        const response = await fetch('/api/data-foundation/explore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            queryId,
            view,
            first: view === 'map' ? 1 : 25,
            ...(view === 'records'
              ? { versionId: requestVersionId, assetId }
              : {}),
            after: cursor,
          }),
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          if (
            !controller.signal.aborted &&
            invalidatesExploration(response.status)
          )
            onInvalidated(queryId, response.status);
          throw new Error('Query unavailable');
        }
        const data = ExplorationResultSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setResult(data);
        onData(data);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [queryId, view, requestVersionId, assetId, cursor, onData, onInvalidated]);
  if (view === 'records' && versionId === null)
    return (
      <div className={styles.empty}>
        <p>{copy.selectForRecords}</p>
      </div>
    );
  if (failed)
    return (
      <div role="alert" className={styles.empty}>
        {copy.unavailable}
      </div>
    );
  if (result === null)
    return (
      <div role="status" className={styles.empty}>
        {copy.loadingView}
      </div>
    );
  if (view === 'map')
    return (
      <MapCanvas
        locale={locale}
        result={result}
        selectedId={selectedRecord?.recordId ?? null}
        onSelect={onSelect}
        onInvalidated={onInvalidated}
        onBounds={onBounds}
      />
    );
  const selectedAsset = result.assets?.find(
    (asset) => asset.assetId === result.selectedAssetId,
  );
  const assets =
    result.assets?.filter((asset) => asset.status !== 'MANIFEST') ?? [];
  const visibleColumns = selectedAsset?.columns.filter(
    (column) =>
      !result.spec.recordQuery?.columns ||
      result.spec.recordQuery.columns.includes(column.key),
  );
  return (
    <div data-testid="explorer-records" aria-busy={busy}>
      <div className={styles.recordToolbar}>
        <label>
          {copy.sourceFile}
          <select
            disabled={result.spec.recordQuery !== undefined || configuring}
            value={result.selectedAssetId ?? ''}
            onChange={(event) => {
              setAssetId(event.target.value);
              setPage(0);
              setCursors([undefined]);
            }}
          >
            {assets.map((asset) => (
              <option key={asset.assetId} value={asset.assetId}>
                {asset.paths[0]?.split('/').at(-1) ?? asset.assetId}
              </option>
            ))}
          </select>
        </label>
        <span>
          {result.totalCount.toLocaleString(locale)} {copy.records}
        </span>
      </div>
      {selectedAsset && onConfigure ? (
        <DataExplorerRecordControls
          key={`${queryId}:${selectedAsset.assetId}`}
          locale={locale}
          assetId={selectedAsset.assetId}
          columns={selectedAsset.columns}
          value={result.spec.recordQuery}
          onApply={onConfigure}
          busy={configuring}
        />
      ) : null}
      <div className={styles.tableScroll}>
        <table className={styles.recordTable}>
          <thead>
            <tr>
              <th scope="col">#</th>
              {visibleColumns?.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.records?.map((record) => (
              <tr
                key={record.recordId}
                data-selected={selectedRecord?.recordId === record.recordId}
              >
                <td>
                  <button
                    aria-label={`${copy.selectRecord} ${record.index}`}
                    aria-pressed={selectedRecord?.recordId === record.recordId}
                    onClick={() => onSelect(record)}
                  >
                    {record.index.toLocaleString(locale)}
                  </button>
                </td>
                {visibleColumns?.map((column) => (
                  <td key={column.key}>
                    {formatRecordValue(record.values[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.records?.length === 0 ? (
        <p className={styles.empty}>{copy.noRecords}</p>
      ) : null}
      <footer className={styles.pagination}>
        <button
          disabled={busy || page === 0}
          onClick={() => setPage((value) => value - 1)}
        >
          {copy.previous}
        </button>
        <span>
          {copy.recordPage} {page + 1}
        </span>
        <button
          disabled={busy || !result.nextCursor}
          onClick={() => {
            setCursors((current) => {
              const next = [...current];
              next[page + 1] = result.nextCursor;
              return next;
            });
            setPage((value) => value + 1);
          }}
        >
          {copy.next}
        </button>
      </footer>
    </div>
  );
}
export function formatRecordValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
