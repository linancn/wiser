'use client';
import {
  invalidatesExploration,
  type InvalidateExploration,
} from '@/lib/exploration-request';

import { useEffect, useMemo, useState } from 'react';
import {
  ExplorationResultSchema,
  type ExplorationResult,
  type ExplorationGraphNode,
  type ExplorationRecord,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import { KnowledgeGraphCanvas } from './data-foundation-graph';
import styles from './data-explorer.module.css';

export function DataExplorerGraph({
  queryId,
  locale,
  versionId,
  selectedRecord,
  selectedNode,
  onSelect,
  onInvalidated,
}: {
  readonly queryId: string;
  readonly locale: Locale;
  readonly onInvalidated: InvalidateExploration;
  readonly versionId: string | null;
  readonly selectedRecord: ExplorationRecord | null;
  readonly selectedNode: ExplorationGraphNode | null;
  readonly onSelect: (node: ExplorationGraphNode) => void;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer;
  // Freeze the entry focus while users inspect nodes; selecting a node must not rebuild the graph.
  const [focus, setFocus] = useState({
    versionId,
    recordId: selectedRecord?.recordId ?? null,
  });
  const [result, setResult] = useState<ExplorationResult | null>(null);
  const [failure, setFailure] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  const after = cursors[page];
  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
      setResult(null);
      setFailure(false);
    });
    void (async () => {
      try {
        const response = await fetch('/api/data-foundation/explore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
          body: JSON.stringify({
            queryId,
            view: 'graph',
            first: 30,
            ...(focus.versionId ? { versionId: focus.versionId } : {}),
            ...(focus.recordId ? { recordId: focus.recordId } : {}),
            ...(after ? { after } : {}),
          }),
        });
        if (!response.ok) {
          if (
            !controller.signal.aborted &&
            invalidatesExploration(response.status)
          )
            onInvalidated(queryId, response.status);
          throw new Error('Graph unavailable');
        }
        const next = ExplorationResultSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          cancelAnimationFrame(frame);
          setResult(next);
          setFailure(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          cancelAnimationFrame(frame);
          setResult(null);
          setFailure(true);
        }
      }
    })();
    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
    };
  }, [queryId, focus, after, onInvalidated]);
  const graph = result?.graph;
  const canvas = useMemo(
    () => ({
      nodes: (graph?.nodes ?? []).map((node) => ({
        entityId: node.id,
        label: `${copy.graphNodeKinds[node.kind]} · ${node.kind === 'ASSET' ? node.label.split('/').at(-1) : node.kind === 'EVIDENCE' ? node.label.slice(0, 8) : node.label}`,
      })),
      edges: (graph?.edges ?? []).map((edge) => ({
        edgeId: edge.id,
        fromEntityId: edge.source,
        toEntityId: edge.target,
      })),
    }),
    [graph, copy],
  );
  const selectedId =
    selectedNode?.id ??
    (selectedRecord
      ? `record:${selectedRecord.analysisId}:${selectedRecord.recordId}`
      : versionId
        ? `version:${versionId}`
        : null);
  return (
    <div data-testid="explorer-graph" className={styles.graphView}>
      {failure ? (
        <p role="alert" className={styles.empty}>
          {copy.unavailable}
        </p>
      ) : !graph ? (
        <p role="status" className={styles.empty}>
          {copy.loadingView}
        </p>
      ) : graph.nodes.length === 0 ? (
        <p className={styles.empty}>{copy.emptyDescription}</p>
      ) : (
        <KnowledgeGraphCanvas
          result={canvas}
          locale={locale}
          selectedId={selectedId}
          hierarchical
          onSelect={(id) => {
            const node = graph.nodes.find((node) => node.id === id);
            if (node) onSelect(node);
          }}
        />
      )}
      <div className={styles.graphToolbar}>
        <p>{copy.graphScope}</p>
        {focus.versionId ? (
          <button
            onClick={() => {
              setFocus({ versionId: null, recordId: null });
              setPage(0);
              setCursors([undefined]);
            }}
          >
            {copy.graphOverview}
          </button>
        ) : null}
      </div>
      {graph?.truncated ? (
        <p role="status" className={styles.graphNotice}>
          {copy.graphTruncated}
        </p>
      ) : null}
      <ul aria-label={copy.graphNodes} className={styles.graphNodes}>
        {graph?.nodes.map((node) => (
          <li key={node.id}>
            <button
              aria-pressed={node.id === selectedId}
              onClick={() => onSelect(node)}
            >
              {copy.graphNodeKinds[node.kind]} · {node.label}
            </button>
          </li>
        ))}
      </ul>
      <footer className={styles.pagination}>
        <button
          disabled={page === 0 || result === null}
          onClick={() => setPage((value) => value - 1)}
        >
          {copy.previous}
        </button>
        <span>
          {copy.page} {page + 1}
        </span>
        <button
          disabled={!result?.nextCursor}
          onClick={() => {
            setCursors((values) => {
              const next = [...values];
              next[page + 1] = result?.nextCursor;
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
