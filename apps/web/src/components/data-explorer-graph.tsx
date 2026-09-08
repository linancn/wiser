'use client';
import {
  invalidatesExploration,
  type InvalidateExploration,
} from '@/lib/exploration-request';

import { useEffect, useMemo, useState } from 'react';
import {
  ExplorationResultSchema,
  ExplorationGraphRelationSchema,
  type ExplorationGraphOptions,
  type ExplorationGraphRelation,
  type ExplorationResult,
  type ExplorationGraphNode,
  type ExplorationRecord,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import { KnowledgeGraphCanvas } from './data-foundation-graph';
import styles from './data-explorer.module.css';
import { useExplorationViewState } from './exploration-view-context';

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
  const viewState = useExplorationViewState();
  const [seed] = useState(() => viewState?.initial.requests.graph);
  const [navigation] = useState(() => viewState?.initial.navigation?.graph);
  const copy = getDictionary(locale).dataFoundation.explorer;
  // Freeze the entry focus while users inspect nodes; selecting a node must not rebuild the graph.
  const [focus, setFocus] = useState<{
    versionId: string | null;
    recordId: string | null;
    assetId?: string;
    detail?: ExplorationGraphOptions['detail'];
  }>({
    versionId: seed ? (seed.versionId ?? null) : versionId,
    recordId: seed
      ? (seed.recordId ?? null)
      : (selectedRecord?.recordId ?? null),
    assetId: seed?.assetId,
    detail: seed?.graph?.detail,
  });
  const [result, setResult] = useState<ExplorationResult | null>(null);
  const [failure, setFailure] = useState(false);
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const [relations, setRelations] = useState<ExplorationGraphRelation[]>([
    ...(seed?.graph?.relations ?? ExplorationGraphRelationSchema.options),
  ]);
  const [path, setPath] = useState<ExplorationGraphOptions['path']>(
    seed?.graph?.path,
  );
  const [from, setFrom] = useState(seed?.graph?.path?.from ?? '');
  const [to, setTo] = useState(seed?.graph?.path?.to ?? '');
  const [cursors, setCursors] = useState<(string | undefined)[]>(
    navigation?.cursors.map((value) => value ?? undefined) ?? [undefined],
  );
  const [page, setPage] = useState(navigation?.page ?? 0);
  const after = cursors[page];
  useEffect(() => {
    const controller = new AbortController();
    viewState?.report('graph', null);
    const frame = requestAnimationFrame(() => {
      setBusy(true);
      setFailure(false);
    });
    const request = {
      queryId,
      view: 'graph' as const,
      first: seed?.first ?? 30,
      ...(focus.versionId ? { versionId: focus.versionId } : {}),
      ...(focus.recordId ? { recordId: focus.recordId } : {}),
      ...(focus.assetId ? { assetId: focus.assetId } : {}),
      graph: {
        ...(focus.detail ? { detail: focus.detail } : {}),
        relations,
        ...(path ? { path } : {}),
      },
      ...(after ? { after } : {}),
    };
    void (async () => {
      try {
        const response = await fetch('/api/data-foundation/explore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
          body: JSON.stringify(request),
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
        if (next.queryId !== queryId || next.view !== 'graph')
          throw new Error('Mismatched graph');
        if (!controller.signal.aborted) {
          cancelAnimationFrame(frame);
          viewState?.report('graph', request, {
            page,
            cursors: cursors.map((value) => value ?? null),
          });
          setResult((previous) =>
            previous?.graph &&
            next.graph &&
            JSON.stringify(previous.graph.nodes) ===
              JSON.stringify(next.graph.nodes) &&
            JSON.stringify(previous.graph.edges) ===
              JSON.stringify(next.graph.edges)
              ? {
                  ...next,
                  graph: {
                    ...next.graph,
                    nodes: previous.graph.nodes,
                    edges: previous.graph.edges,
                  },
                }
              : next,
          );
          setBusy(false);
          setFailure(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          cancelAnimationFrame(frame);
          setResult(null);
          setFailure(true);
          setBusy(false);
        }
      }
    })();
    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
    };
  }, [queryId, focus, after, onInvalidated, relations, path, retry]);
  const graph = result?.graph;
  const nodes = graph?.nodes;
  const edges = graph?.edges;
  const canvas = useMemo(
    () => ({
      nodes: (nodes ?? []).map((node) => ({
        entityId: node.id,
        label: `${copy.graphNodeKinds[node.kind]} · ${node.kind === 'ASSET' ? node.label.split('/').at(-1) : node.kind === 'EVIDENCE' ? node.label.slice(0, 8) : node.label}`,
      })),
      edges: (edges ?? []).map((edge) => ({
        edgeId: edge.id,
        fromEntityId: edge.source,
        toEntityId: edge.target,
      })),
    }),
    [nodes, edges, copy],
  );
  const selectedId =
    selectedNode?.id ??
    (selectedRecord
      ? `record:${selectedRecord.analysisId}:${selectedRecord.recordId}`
      : versionId
        ? `version:${versionId}`
        : null);
  const changeFocus = (next: typeof focus) => {
    setFocus(next);
    setPath(undefined);
    setFrom('');
    setTo('');
    setPage(0);
    setCursors([undefined]);
  };
  const activeNode = graph?.nodes.find((node) => node.id === selectedId);
  return (
    <div data-testid="explorer-graph" className={styles.graphView}>
      {failure ? (
        <div className={styles.empty}>
          <p role="alert">{copy.unavailable}</p>
          <button onClick={() => setRetry((value) => value + 1)}>
            {copy.graphRetry}
          </button>
        </div>
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
          path={graph.path}
          onSelect={(id) => {
            const node = graph.nodes.find((node) => node.id === id);
            if (node) onSelect(node);
          }}
        />
      )}
      {busy && graph ? <p role="status">{copy.loadingView}</p> : null}
      <div className={styles.graphToolbar}>
        <p>{copy.graphScope}</p>
        {focus.versionId ? (
          <button
            onClick={() => {
              changeFocus({ versionId: null, recordId: null });
            }}
          >
            {copy.graphOverview}
          </button>
        ) : null}
      </div>
      <div className={styles.graphToolbar}>
        {activeNode &&
        ['RESOURCE', 'VERSION', 'ASSET'].includes(activeNode.kind) ? (
          <>
            <button
              disabled={busy}
              onClick={() =>
                changeFocus({
                  versionId: activeNode.versionId,
                  recordId: null,
                  detail: 'assets',
                })
              }
            >
              {copy.graphExpandAssets}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                changeFocus({
                  versionId: activeNode.versionId,
                  recordId: null,
                  detail: 'evidence',
                })
              }
            >
              {copy.graphExpandEvidence}
            </button>
            {activeNode.assetId ? (
              <button
                disabled={busy}
                onClick={() =>
                  changeFocus({
                    versionId: activeNode.versionId,
                    recordId: null,
                    assetId: activeNode.assetId!,
                    detail: 'records',
                  })
                }
              >
                {copy.graphExpandRecords}
              </button>
            ) : null}
          </>
        ) : null}
        {graph?.grain ? (
          <span>
            {copy.graphGrains[graph.grain]} · {result?.totalCount}
          </span>
        ) : null}
      </div>
      <details className={styles.graphOptions}>
        <summary>{copy.graphRelationsAndPath}</summary>
        <fieldset disabled={busy}>
          <legend>{copy.graphRelations}</legend>
          {ExplorationGraphRelationSchema.options.map((relation) => (
            <label key={relation}>
              <input
                type="checkbox"
                checked={relations.includes(relation)}
                onChange={(event) => {
                  setRelations((previous) =>
                    event.target.checked
                      ? [...previous, relation]
                      : previous.filter((value) => value !== relation),
                  );
                  setPath(undefined);
                  setPage(0);
                  setCursors([undefined]);
                }}
              />
              {copy.graphRelationsLabels[relation]}
            </label>
          ))}
        </fieldset>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (from && to) setPath({ from, to, maxDepth: 8 });
          }}
        >
          <p>{copy.graphPathScope}</p>
          <label>
            {copy.graphPathStart}
            <select
              disabled={busy}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            >
              <option value="">{copy.graphChooseNode}</option>
              {nodes?.map((node) => (
                <option key={node.id} value={node.id}>
                  {copy.graphNodeKinds[node.kind]} · {node.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.graphPathEnd}
            <select
              disabled={busy}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            >
              <option value="">{copy.graphChooseNode}</option>
              {nodes?.map((node) => (
                <option key={node.id} value={node.id}>
                  {copy.graphNodeKinds[node.kind]} · {node.label}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy || !from || !to} type="submit">
            {copy.graphFindPath}
          </button>
        </form>
        {graph?.path ? (
          <p role="status">
            {graph.path.found ? copy.graphPathFound : copy.graphPathAbsent}
            {graph.path.found ? ` · ${graph.path.edgeIds.length}` : ''}
          </p>
        ) : null}
      </details>
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
          disabled={page === 0 || result === null || busy}
          onClick={() => {
            setPath(undefined);
            setFrom('');
            setTo('');
            setPage((value) => value - 1);
          }}
        >
          {copy.previous}
        </button>
        <span>
          {copy.page} {page + 1}
        </span>
        <button
          disabled={!result?.nextCursor || busy}
          onClick={() => {
            setPath(undefined);
            setFrom('');
            setTo('');
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
