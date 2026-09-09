'use client';

import type { Graph, IElementEvent } from '@antv/g6';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GraphResultDto } from '@/lib/data-foundation';
import { getDictionary, type Locale } from '@/lib/i18n';
import { layoutGraph } from '@/lib/graph-layout';
import styles from './data-foundation-graph.module.css';

export interface CanvasGraphData {
  readonly nodes: readonly { entityId: string; label: string; kind?: string }[];
  readonly edges: readonly {
    edgeId: string;
    fromEntityId: string;
    toEntityId: string;
    label?: string;
  }[];
}

type GraphState = 'loading' | 'ready' | 'unavailable';

export function KnowledgeGraphCanvas({
  result,
  selectedId,
  onSelect,
  locale,
  path,
}: {
  readonly result: CanvasGraphData;
  readonly path?:
    | {
        readonly nodeIds: readonly string[];
        readonly edgeIds: readonly string[];
      }
    | undefined;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly locale: Locale;
}) {
  const target = useRef<HTMLDivElement>(null);
  const graph = useRef<Graph | null>(null);
  const highlights = useRef<{
    instance: Graph;
    states: Map<string, string[]>;
  } | null>(null);
  const identities = useMemo(
    () => ({
      nodes: new Set(result.nodes.map((node) => node.entityId)),
      edges: new Set(result.edges.map((edge) => edge.edgeId)),
    }),
    [result],
  );
  const pending = useRef<Promise<void>>(Promise.resolve());
  const select = useRef(onSelect);
  select.current = onSelect;
  const [state, setState] = useState<GraphState>('loading');
  const [mode, setMode] = useState<'network' | 'hierarchy'>('network');
  const [direction, setDirection] = useState<'LR' | 'TB'>('LR');
  useEffect(() => {
    const container = target.current;
    if (!container) return;
    const measure = () =>
      setDirection(container.clientWidth < 560 ? 'TB' : 'LR');
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
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
        source:
          tokens.getPropertyValue('--success-strong').trim() ||
          tokens.getPropertyValue('--accent').trim(),
        evidence:
          tokens.getPropertyValue('--warning-strong').trim() ||
          tokens.getPropertyValue('--accent').trim(),
      };
    };
    const initialize = async () => {
      const { Graph: GraphConstructor, NodeEvent } = await import('@antv/g6');
      if (disposed) return;
      const positions = new Map(
        (
          await layoutGraph(
            {
              direction,
              mode,
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
      );
      if (disposed) return;
      const palette = colors();
      const columns = Math.max(1, Math.ceil(Math.sqrt(result.nodes.length)));
      instance = new GraphConstructor({
        container,
        width: container.clientWidth,
        height: container.clientHeight,
        animation: false,
        autoFit: 'view',
        zoomRange: [0.02, 2],
        padding: [direction === 'TB' ? 120 : 80, 40, 40, 40],
        data: {
          nodes: result.nodes.map((node, index) => ({
            id: node.entityId,
            data: { label: node.label },
            style: {
              fill:
                node.kind === 'RESOURCE'
                  ? palette.source
                  : node.kind === 'EVIDENCE'
                    ? palette.evidence
                    : palette.fill,
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
            data: { label: edge.label ?? '' },
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
              const limit = 36;
              return label.length > limit
                ? `${label.slice(0, limit - 1)}…`
                : label;
            },
            labelFill: palette.labelFill,
            labelFontSize: 12,
            labelMaxWidth: 170,
            labelWordWrap: true,
          },
          state: {
            selected: { stroke: palette.selected, lineWidth: 5 },
            path: { stroke: palette.selected, lineWidth: 4 },
          },
        },
        edge: {
          state: { path: { stroke: palette.selected, lineWidth: 4 } },
          style: {
            stroke: palette.edge,
            lineWidth: 1.5,
            endArrow: true,
            labelText: (edge) =>
              typeof edge.data?.['label'] === 'string'
                ? edge.data['label']
                : '',
            labelFill: palette.labelFill,
            labelFontSize: 11,
            labelBackground: true,
            labelBackgroundFill: getComputedStyle(document.documentElement)
              .getPropertyValue('--surface')
              .trim(),
          },
        },
        behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
      });
      const active = instance;
      active.on(NodeEvent.CLICK, (event: IElementEvent) =>
        select.current(event.target.id),
      );
      await active.render();
      if (disposed) return;
      for (const canvas of container.querySelectorAll('canvas')) {
        canvas.tabIndex = -1;
        canvas.setAttribute('aria-hidden', 'true');
      }
      graph.current = active;
      resize = new ResizeObserver(() => {
        if (
          disposed ||
          container.clientWidth === 0 ||
          container.clientHeight === 0
        )
          return;
        pending.current = pending.current
          .then(async () => {
            if (disposed) return;
            active.resize(container.clientWidth, container.clientHeight);
            await active.fitView(undefined, false);
          })
          .catch(() => {
            if (!disposed) setState('unavailable');
          });
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
                  fill:
                    node.kind === 'RESOURCE'
                      ? palette.source
                      : node.kind === 'EVIDENCE'
                        ? palette.evidence
                        : palette.fill,
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
      if (highlights.current?.instance === instance) highlights.current = null;
      void pending.current.finally(() => instance?.destroy()).catch(() => {});
    };
  }, [result, mode, direction]);

  useEffect(() => {
    const active = graph.current;
    if (active === null) return;
    pending.current = pending.current
      .then(async () => {
        if (graph.current !== active) return;
        const previous =
          highlights.current?.instance === active
            ? highlights.current.states
            : new Map<string, string[]>();
        const next = new Map<string, string[]>();
        for (const id of path?.nodeIds ?? [])
          if (identities.nodes.has(id)) next.set(id, ['path']);
        for (const id of path?.edgeIds ?? [])
          if (identities.edges.has(id)) next.set(id, ['path']);
        if (selectedId && identities.nodes.has(selectedId))
          next.set(selectedId, [...(next.get(selectedId) ?? []), 'selected']);
        const changes: Record<string, string[]> = {};
        for (const id of new Set([...previous.keys(), ...next.keys()])) {
          const before = previous.get(id) ?? [],
            after = next.get(id) ?? [];
          if (before.join(',') !== after.join(',')) changes[id] = after;
        }
        if (Object.keys(changes).length > 0)
          await active.setElementState(changes, false);
        if (graph.current === active)
          highlights.current = { instance: active, states: next };
      })
      .catch(() => {
        if (graph.current === active) setState('unavailable');
      });
  }, [selectedId, identities, state, path]);

  function viewport(action: 'in' | 'out' | 'fit' | 'selection') {
    const active = graph.current;
    if (!active) return;
    pending.current = pending.current
      .then(async () => {
        if (graph.current !== active) return;
        if (action === 'fit') await active.fitView(undefined, false);
        else if (action === 'selection' && selectedId) {
          await active.zoomTo(1, false);
          await active.focusElement(selectedId, false);
        } else
          await active.zoomTo(
            Math.max(
              0.02,
              Math.min(2, active.getZoom() * (action === 'in' ? 1.25 : 0.8)),
            ),
            false,
          );
      })
      .catch(() => {
        if (graph.current === active) setState('unavailable');
      });
  }
  return (
    <div
      className={styles.canvasFrame}
      data-testid="knowledge-graph"
      data-state={state}
      data-layout-direction={direction}
      data-layout-mode={mode}
    >
      <div
        className={styles.canvasControls}
        role="toolbar"
        aria-label={copy.controls}
      >
        <button
          type="button"
          aria-pressed={mode === 'network'}
          onClick={() => setMode('network')}
        >
          {copy.networkLayout}
        </button>
        <button
          type="button"
          aria-pressed={mode === 'hierarchy'}
          onClick={() => setMode('hierarchy')}
        >
          {copy.hierarchyLayout}
        </button>
        <button
          disabled={state !== 'ready'}
          aria-label={copy.zoomIn}
          onClick={() => viewport('in')}
        >
          +
        </button>
        <button
          disabled={state !== 'ready'}
          aria-label={copy.zoomOut}
          onClick={() => viewport('out')}
        >
          −
        </button>
        <button disabled={state !== 'ready'} onClick={() => viewport('fit')}>
          {copy.fit}
        </button>
        <button
          disabled={
            state !== 'ready' ||
            !result.nodes.some((node) => node.entityId === selectedId)
          }
          onClick={() => viewport('selection')}
        >
          {copy.focusSelection}
        </button>
      </div>
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
