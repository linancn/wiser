'use client';

import type { Graph, IElementEvent } from '@antv/g6';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { GraphResultDto } from '@/lib/data-foundation';
import { getDictionary, type Locale } from '@/lib/i18n';
import { layoutGraph } from '@/lib/graph-layout';
import styles from './data-foundation-graph.module.css';

export interface CanvasGraphData {
  readonly nodes: readonly { entityId: string; label: string }[];
  readonly edges: readonly {
    edgeId: string;
    fromEntityId: string;
    toEntityId: string;
  }[];
}

type GraphState = 'loading' | 'ready' | 'unavailable';

export function KnowledgeGraphCanvas({
  result,
  selectedId,
  onSelect,
  locale,
  hierarchical = false,
}: {
  readonly result: CanvasGraphData;
  readonly hierarchical?: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly locale: Locale;
}) {
  const target = useRef<HTMLDivElement>(null);
  const graph = useRef<Graph | null>(null);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const select = useRef(onSelect);
  select.current = onSelect;
  const [state, setState] = useState<GraphState>('loading');
  const copy = getDictionary(locale).dataFoundation.graphPage;

  useEffect(() => {
    const container = target.current;
    if (container === null) return;
    let disposed = false;
    const layoutController = new AbortController();
    let instance: Graph | null = null;
    let resize: ResizeObserver | null = null;
    let theme: MutationObserver | null = null;
    const colors = () => {
      const tokens = getComputedStyle(document.documentElement);
      return {
        fill: tokens.getPropertyValue('--accent').trim(),
        stroke: tokens.getPropertyValue('--accent-strong').trim(),
        labelFill: tokens.getPropertyValue('--text-primary').trim(),
        edge: tokens.getPropertyValue('--border-strong').trim(),
        selected: tokens.getPropertyValue('--warning-bright').trim(),
      };
    };
    const initialize = async () => {
      const { Graph: GraphConstructor, NodeEvent } = await import('@antv/g6');
      if (disposed) return;
      const positions = hierarchical
        ? new Map(
            (
              await layoutGraph(
                {
                  nodes: result.nodes.map((node) => ({ id: node.entityId })),
                  edges: result.edges.map((edge) => ({
                    id: edge.edgeId,
                    source: edge.fromEntityId,
                    target: edge.toEntityId,
                  })),
                },
                layoutController.signal,
              )
            ).map((node) => [node.id, node]),
          )
        : null;
      if (disposed) return;
      const palette = colors();
      const columns = Math.max(1, Math.ceil(Math.sqrt(result.nodes.length)));
      instance = new GraphConstructor({
        container,
        width: container.clientWidth,
        height: container.clientHeight,
        animation: false,
        autoFit: 'view',
        zoomRange: [0.15, 1.5],
        padding: 48,
        data: {
          nodes: result.nodes.map((node, index) => ({
            id: node.entityId,
            data: { label: node.label },
            style: {
              x: positions?.get(node.entityId)?.x ?? (index % columns) * 180,
              y:
                positions?.get(node.entityId)?.y ??
                Math.floor(index / columns) * 100,
            },
          })),
          edges: result.edges.map((edge) => ({
            id: edge.edgeId,
            source: edge.fromEntityId,
            target: edge.toEntityId,
          })),
        },
        node: {
          style: {
            size: 24,
            fill: palette.fill,
            stroke: palette.stroke,
            lineWidth: 2,
            labelText: (node) => {
              const label = node.data?.['label'];
              if (typeof label !== 'string') return '';
              const limit = hierarchical ? 24 : 48;
              return label.length > limit
                ? `${label.slice(0, limit - 1)}…`
                : label;
            },
            labelFill: palette.labelFill,
            labelFontSize: 12,
            labelMaxWidth: 170,
            labelWordWrap: true,
          },
          state: { selected: { stroke: palette.selected, lineWidth: 5 } },
        },
        edge: {
          style: { stroke: palette.edge, lineWidth: 1.5, endArrow: true },
        },
        behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
      });
      const active = instance;
      active.on(NodeEvent.CLICK, (event: IElementEvent) =>
        select.current(event.target.id),
      );
      await active.render();
      if (disposed) return;
      graph.current = active;
      resize = new ResizeObserver(() => {
        if (!disposed)
          active.resize(container.clientWidth, container.clientHeight);
      });
      resize.observe(container);
      theme = new MutationObserver(() => {
        if (disposed) return;
        const palette = colors();
        pending.current = pending.current
          .then(async () => {
            if (disposed) return;
            active.updateNodeData(
              result.nodes.map((node) => ({
                id: node.entityId,
                style: {
                  fill: palette.fill,
                  stroke: palette.stroke,
                  labelFill: palette.labelFill,
                },
              })),
            );
            active.updateEdgeData(
              result.edges.map((edge) => ({
                id: edge.edgeId,
                style: { stroke: palette.edge },
              })),
            );
            await active.draw();
          })
          .catch(() => {
            if (!disposed) setState('unavailable');
          });
      });
      theme.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'class'],
      });
      setState('ready');
    };
    const frame = requestAnimationFrame(() => {
      setState('loading');
      pending.current = initialize().catch(() => {
        if (!disposed) setState('unavailable');
      });
    });
    return () => {
      disposed = true;
      layoutController.abort();
      cancelAnimationFrame(frame);
      resize?.disconnect();
      theme?.disconnect();
      graph.current = null;
      void pending.current.finally(() => instance?.destroy()).catch(() => {});
    };
  }, [result, hierarchical]);

  useEffect(() => {
    const active = graph.current;
    if (active === null) return;
    pending.current = pending.current
      .then(async () => {
        if (graph.current !== active) return;
        await active.setElementState(
          Object.fromEntries(
            result.nodes.map((node) => [
              node.entityId,
              node.entityId === selectedId ? ['selected'] : [],
            ]),
          ),
          false,
        );
      })
      .catch(() => {
        if (graph.current === active) setState('unavailable');
      });
  }, [selectedId, result, state]);

  return (
    <div
      className={styles.canvasFrame}
      data-testid="knowledge-graph"
      data-state={state}
    >
      <div
        ref={target}
        className={styles.canvas}
        role="img"
        aria-label={copy.canvasLabel}
      />
      {state === 'ready' ? null : (
        <p role="status" className={styles.status}>
          {state === 'loading' ? copy.loading : copy.unavailable}
        </p>
      )}
    </div>
  );
}

export function DataFoundationGraph({
  locale,
  result,
}: {
  readonly locale: Locale;
  readonly result: GraphResultDto;
}) {
  const copy = getDictionary(locale).dataFoundation;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);
  const selected = result.nodes.find((node) => node.entityId === selectedId);
  if (result.nodes.length === 0) return <p>{copy.common.empty}</p>;
  return (
    <div className={styles.workspace}>
      <KnowledgeGraphCanvas
        locale={locale}
        result={result}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <aside className={styles.inspector}>
        <h2>
          {copy.graphPage.nodesTitle} <span>{result.nodes.length}</span>
        </h2>
        <p>{copy.graphPage.selectionHint}</p>
        <ul className={styles.nodes}>
          {result.nodes.map((node) => (
            <li key={node.entityId}>
              <button
                type="button"
                aria-pressed={selectedId === node.entityId}
                onClick={() => onSelect(node.entityId)}
              >
                {node.label}
              </button>
            </li>
          ))}
        </ul>
        {selected === undefined ? null : (
          <section
            data-testid="graph-inspector"
            className={styles.details}
            aria-live="polite"
          >
            <h3>{selected.label}</h3>
            <dl>
              <dt>{copy.common.versionId}</dt>
              <dd>{selected.versionId}</dd>
              <dt>{copy.common.evidenceId}</dt>
              <dd>{selected.evidenceId}</dd>
            </dl>
            <Link
              href={`/${locale}/data-foundation/catalog/${selected.dataItemId}?version=${selected.versionId}`}
            >
              {copy.graphPage.openData}
            </Link>
          </section>
        )}
        <p>
          {copy.graphPage.edgesTitle}: {result.edges.length}
        </p>
      </aside>
    </div>
  );
}
