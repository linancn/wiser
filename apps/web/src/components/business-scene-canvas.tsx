'use client';
import {
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
  useId,
  type ReactNode,
} from 'react';
import { getDictionary, type Locale } from '@/lib/i18n';
import { sceneNeighborhood, type BusinessScene } from '@/lib/business-scene';
import {
  projectScenePoint,
  placeSceneGroupLabels,
  sceneEdgesAt,
  scenePositions,
  zoomSceneCamera,
  type SceneView,
} from '@/lib/business-scene-view';
import { visibleGraphLabels } from '@/lib/graph-label-visibility';
import dynamic from 'next/dynamic';
import type { InvalidateExploration } from '@/lib/exploration-request';
const BusinessSceneMap = dynamic(
  () => import('./business-scene-map').then((m) => m.BusinessSceneMap),
  { ssr: false },
);
import styles from './business-scene-canvas.module.css';
import {
  nodeFamilies,
  edgeFamilies,
  familyColor,
} from '@/lib/business-scene-style';
import { BusinessSceneGlyph } from './business-scene-glyph';
export function BusinessSceneCanvas({
  scene,
  settings,
  onSettings,
  selectedId,
  selectedEdge,
  selectedKind = null,
  onSelect,
  onEdge,
  locale,
  evidence,
  queryId,
  onInvalidated,
}: {
  scene: BusinessScene;
  settings: SceneView;
  onSettings: (next: SceneView) => void;
  selectedId: string | null;
  selectedEdge: string | null;
  selectedKind?: string | null;
  onSelect: (id: string | null) => void;
  onEdge: (id: string | null) => void;
  locale: Locale;
  evidence?: ReactNode;
  queryId: string;
  onInvalidated: InvalidateExploration;
}) {
  const dictionary = getDictionary(locale).knowledgeRelations,
    copy = dictionary.scene;
  const root = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const marker = useId().replaceAll(':', '');
  const [edgeCandidates, setEdgeCandidates] = useState<string[]>([]);
  const [width, setWidth] = useState(1100),
    [search, setSearch] = useState(''),
    [hover, setHover] = useState<{
      node: string | null;
      edge: string | null;
    } | null>(null),
    [group, setGroup] = useState<string | null>(null);
  const [camera, setCamera] = useState({
    zoom: settings.zoom,
    panX: settings.panX,
    panY: settings.panY,
  });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const previous = useRef<(typeof camera)[]>([]),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointers = useRef(new Map<number, [number, number]>()),
    dragged = useRef(false);
  const height = 700;
  useEffect(() => {
    setCamera({
      zoom: settings.zoom,
      panX: settings.panX,
      panY: settings.panY,
    });
  }, [settings.zoom, settings.panX, settings.panY]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setWidth(Math.max(280, el.clientWidth)),
    );
    observer.observe(el);
    setWidth(Math.max(280, el.clientWidth || 1100));
    return () => observer.disconnect();
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const layout = useMemo(
    () =>
      scenePositions(
        scene,
        settings,
        settings.view === 'object' || settings.view === 'trace'
          ? selectedId
          : null,
      ),
    [
      scene,
      settings.view,
      settings.form,
      settings.grouping,
      settings.gap,
      settings.depth,
      selectedId,
    ],
  );
  const projected = useMemo(
    () =>
      new Map(
        [...layout.positions].map(([id, p]) => [
          id,
          settings.form === 'layers'
            ? projectScenePoint(p, settings.yaw, settings.pitch)
            : ([p[0], p[1]] as [number, number]),
        ]),
      ),
    [layout, settings.form, settings.yaw, settings.pitch],
  );
  const groupLabel = (id: string) =>
    (copy.groups as Record<string, string>)[id] ??
    (dictionary.kinds as Record<string, string>)[id] ??
    (id.startsWith('year:')
      ? copy.year + id.slice(5)
      : id === 'multipleTimes'
        ? copy.multipleTimes
        : copy.undated);
  const planes = useMemo(
    () =>
      layout.groups.map((g) => ({
        ...g,
        corners: [
          [-g.width / 2, -g.height / 2],
          [g.width / 2, -g.height / 2],
          [g.width / 2, g.height / 2],
          [-g.width / 2, g.height / 2],
        ].map(([x, y]) => {
          const p: [number, number, number] = [
            g.center[0] + x,
            g.center[1] + y,
            g.center[2],
          ];
          return settings.form === 'layers'
            ? projectScenePoint(p, settings.yaw, settings.pitch)
            : ([p[0], p[1]] as [number, number]);
        }),
      })),
    [layout, settings.form, settings.yaw, settings.pitch],
  );
  const fit = useMemo(() => {
    const points = [...projected.values(), ...planes.flatMap((p) => p.corners)];
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    const minX = Math.min(0, ...xs),
      maxX = Math.max(1, ...xs),
      minY = Math.min(0, ...ys),
      maxY = Math.max(1, ...ys);
    return {
      scale: Math.min(
        (width - 140) / (maxX - minX + 1),
        (height - 150) / (maxY - minY + 1),
      ),
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    };
  }, [projected, planes, width]);
  const layerInset = settings.form === 'layers' ? 70 : 0;
  const screenPoint = useCallback(
    ([x, y]: [number, number]): [number, number] => [
      (x - fit.x) * fit.scale * camera.zoom + width / 2 + layerInset,
      (y - fit.y) * fit.scale * camera.zoom + height / 2,
    ],
    [fit, camera.zoom, width, layerInset],
  );
  // A pan translates the retained drawing; it does not move or recreate its members.
  const points = useMemo(
    () => new Map([...projected].map(([id, p]) => [id, screenPoint(p)])),
    [projected, screenPoint],
  );
  const groupLabels = useMemo(() => {
    const labels = placeSceneGroupLabels(
      planes.map((p, index) => {
        const point = screenPoint(p.corners[0]);
        return {
          id: p.id,
          x: settings.form === 'layers' ? 20 : point[0],
          y:
            settings.form === 'layers'
              ? 101 +
                (planes.length - 1 - index) *
                  Math.min(34, 560 / Math.max(1, planes.length - 1))
              : point[1],
          width:
            settings.form === 'layers'
              ? 185
              : Math.max(160, groupLabel(p.id).length * 14 + 60),
        };
      }),
      width,
      height,
    );
    return new Map(labels.map((label) => [label.id, label]));
  }, [planes, screenPoint, settings.form, width, locale]);
  const focus = useMemo(() => {
    if (group || (selectedKind && !selectedId && !selectedEdge && !hover)) {
      const members = new Set(
        group
          ? (layout.groups.find((g) => g.id === group)?.members ?? [])
          : scene.nodes.filter((n) => n.kind === selectedKind).map((n) => n.id),
      );
      const edges = scene.edges.filter(
        (e) => members.has(e.from) || members.has(e.to),
      );
      return {
        nodes: new Set([...members, ...edges.flatMap((e) => [e.from, e.to])]),
        edges: new Set(edges.map((e) => e.id)),
      };
    }
    return sceneNeighborhood(
      scene,
      hover ? hover.node : selectedId,
      hover ? hover.edge : selectedEdge,
      settings.depth,
    );
  }, [
    scene,
    selectedId,
    selectedEdge,
    selectedKind,
    hover,
    settings.depth,
    group,
    layout.groups,
  ]);
  const focused = focus.nodes.size > 0;
  const visible = useMemo(
    () =>
      visibleGraphLabels(
        scene.nodes
          .filter(
            (n) =>
              (settings.style !== 'smooth' && camera.zoom >= 1.4) ||
              n.id === selectedId ||
              (settings.style !== 'smooth' && focus.nodes.has(n.id)),
          )
          .map((n) => ({
            id: n.id,
            x: points.get(n.id)![0],
            y: points.get(n.id)![1],
            preferred: focus.nodes.has(n.id),
          })),
        1,
        hover?.node ?? selectedId,
      ),
    [
      scene.nodes,
      camera.zoom,
      settings.style,
      focus.nodes,
      points,
      hover?.node,
      selectedId,
    ],
  );
  const commit = (next: typeof camera, delay = false) => {
    setCamera(next);
    if (timer.current) clearTimeout(timer.current);
    if (delay)
      timer.current = setTimeout(
        () => onSettings({ ...settings, ...next }),
        150,
      );
    else onSettings({ ...settings, ...next });
  };
  const remember = () => {
    previous.current = [...previous.current.slice(-19), cameraRef.current];
  };
  const zoom = (factor: number, point: [number, number] = [0, 0]) => {
    remember();
    commit(zoomSceneCamera(cameraRef.current, factor, point), true);
  };
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  wheelHandler.current = (e) => {
    e.preventDefault();
    const r = svg.current?.getBoundingClientRect();
    if (r)
      zoom(Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.005), [
        e.clientX - r.left - width / 2 - layerInset,
        e.clientY - r.top - height / 2,
      ]);
  };
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const listener = (e: WheelEvent) => wheelHandler.current(e);
    element.addEventListener('wheel', listener, { passive: false });
    return () => element.removeEventListener('wheel', listener);
  }, [settings.form]);
  const selectNode = useCallback(
    (id: string) => {
      if (dragged.current) return;
      setGroup(null);
      setEdgeCandidates([]);
      if (timer.current) clearTimeout(timer.current);
      onSelect(id);
    },
    [onSelect],
  );
  const selectEdge = useCallback(
    (id: string) => {
      if (dragged.current) return;
      setGroup(null);
      setEdgeCandidates([]);
      if (timer.current) clearTimeout(timer.current);
      onEdge(id);
    },
    [onEdge],
  );
  const matchedNodes = useMemo(
    () =>
      scene.nodes.filter((n) =>
        n.label
          .toLocaleLowerCase(locale)
          .includes(search.toLocaleLowerCase(locale)),
      ),
    [scene.nodes, search, locale],
  );
  const matchedEdges = useMemo(
    () =>
      scene.edges.filter(
        (e) =>
          (!focused || focus.edges.has(e.id)) &&
          `${e.row.candidate.subject.label} ${dictionary.predicates[e.row.candidate.predicate]} ${e.row.candidate.object.label}`
            .toLocaleLowerCase(locale)
            .includes(search.toLocaleLowerCase(locale)),
      ),
    [scene.edges, focused, focus.edges, search, locale, dictionary.predicates],
  );
  const selectedNode = scene.nodes.find((n) => n.id === selectedId);
  const presentFamilies = useMemo(
    () => [...new Set(scene.nodes.map((n) => nodeFamilies[n.kind]))],
    [scene.nodes],
  );
  const presentEdges = useMemo(
    () => [
      ...new Set(
        scene.edges.map((e) => edgeFamilies[e.row.candidate.predicate]),
      ),
    ],
    [scene.edges],
  );
  const selectGroup = (id: string) => {
    if (timer.current) clearTimeout(timer.current);
    setEdgeCandidates([]);
    setHover(null);
    setGroup(group === id ? null : id);
    onSelect(null);
    onEdge(null);
  };
  const change = (partial: Partial<SceneView>) => {
    if (timer.current) clearTimeout(timer.current);
    onSettings({ ...settings, ...cameraRef.current, ...partial });
  };
  const marks = useMemo(
    () => (
      <>
        {planes.map((p) => (
          <polygon
            key={p.id}
            data-layer-id={p.id}
            points={p.corners.map((v) => screenPoint(v).join(',')).join(' ')}
            className={styles.plane}
            opacity={group && group !== p.id ? 0.25 : 1}
          />
        ))}
        {scene.edges.map((e) => {
          const a = points.get(e.from)!,
            b = points.get(e.to)!;
          const active = focus.edges.has(e.id);
          // Keep the arrow outside the node outline; hit testing still uses the full segment.
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const inset = Math.min(e.to === selectedId ? 11 : 8, length / 3);
          const end = length
            ? [
                b[0] - ((b[0] - a[0]) * inset) / length,
                b[1] - ((b[1] - a[1]) * inset) / length,
              ]
            : b;
          return (
            <g
              key={e.id}
              data-edge-id={e.id}
              data-family={edgeFamilies[e.row.candidate.predicate]}
              data-highlighted={active}
              opacity={focused ? (active ? 1 : 0.1) : 0.45}
            >
              {active ? (
                <line
                  x1={a[0]}
                  y1={a[1]}
                  x2={b[0]}
                  y2={b[1]}
                  stroke="var(--warning-bright)"
                  strokeWidth={5}
                  opacity={0.55}
                />
              ) : null}
              <line
                data-relation-line
                x1={a[0]}
                y1={a[1]}
                x2={end[0]}
                y2={end[1]}
                stroke={familyColor(edgeFamilies[e.row.candidate.predicate])}
                strokeWidth={1.2}
                strokeDasharray={
                  e.row.status === 'PENDING_REVIEW' ? '5 3' : undefined
                }
                markerEnd={
                  e.row.candidate.predicate === 'IDENTITY_MATCH'
                    ? undefined
                    : `url(#${marker}-${edgeFamilies[e.row.candidate.predicate]})`
                }
              />
              <line
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke="transparent"
                strokeWidth="9"
                className={styles.hit}
                onClick={(event) => {
                  if (dragged.current) return;
                  const rect = svg.current!.getBoundingClientRect();
                  const candidates = sceneEdgesAt(scene.edges, points, [
                    event.clientX - rect.left - cameraRef.current.panX,
                    event.clientY - rect.top - cameraRef.current.panY,
                  ]);
                  if (candidates.length > 1) setEdgeCandidates(candidates);
                  else selectEdge(e.id);
                }}
                onPointerEnter={() => setHover({ node: null, edge: e.id })}
                onPointerLeave={() => setHover(null)}
              >
                <title>
                  {e.row.candidate.subject.label} →{' '}
                  {dictionary.predicates[e.row.candidate.predicate]} →{' '}
                  {e.row.candidate.object.label}
                </title>
              </line>
              {selectedEdge === e.id ||
              (active &&
                (settings.style === 'evidence' ||
                  (settings.style !== 'smooth' && camera.zoom >= 3))) ? (
                <text
                  x={(a[0] + b[0]) / 2}
                  y={(a[1] + b[1]) / 2 - 8}
                  className={styles.edgeLabel}
                >
                  {dictionary.predicates[e.row.candidate.predicate]}
                </text>
              ) : null}
            </g>
          );
        })}
        {scene.nodes.map((n) => {
          const p = points.get(n.id)!;
          const active = focus.nodes.has(n.id);
          return (
            <g
              key={n.id}
              data-node-id={n.id}
              data-family={nodeFamilies[n.kind]}
              data-world-x={layout.positions.get(n.id)![0]}
              data-highlighted={active}
              opacity={focused ? (active ? 1 : 0.22) : 1}
              onClick={() => selectNode(n.id)}
              onPointerEnter={() => setHover({ node: n.id, edge: null })}
              onPointerLeave={() => setHover(null)}
              className={styles.hit}
            >
              {n.id === selectedId ? (
                <circle
                  cx={p[0]}
                  cy={p[1]}
                  r={10}
                  fill="none"
                  stroke="var(--warning-bright)"
                  strokeWidth={2}
                />
              ) : null}
              <BusinessSceneGlyph
                family={nodeFamilies[n.kind]}
                x={p[0]}
                y={p[1]}
                size={n.id === selectedId ? 7 : 5}
              />
              <title>
                {dictionary.kinds[n.kind]} · {n.label}
              </title>
              {visible.has(n.id) ? (
                <text x={p[0] + 10} y={p[1] - 9} className={styles.nodeLabel}>
                  {n.label.length > 24 && n.id !== selectedId
                    ? n.label.slice(0, 24) + '…'
                    : n.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </>
    ),
    [
      planes,
      screenPoint,
      group,
      scene.edges,
      scene.nodes,
      points,
      focus,
      focused,
      marker,
      selectEdge,
      selectNode,
      dictionary,
      selectedEdge,
      camera.zoom,
      layout.positions,
      selectedId,
      settings.style,
      visible,
    ],
  );
  const memberLists = useMemo(
    () => (
      <>
        <details open={Boolean(search)}>
          <summary>
            {copy.nodeList} ({matchedNodes.length})
          </summary>
          <ul className={styles.list}>
            {matchedNodes.map((n) => (
              <li key={n.id}>
                <button
                  aria-pressed={n.id === selectedId}
                  onClick={() => {
                    dragged.current = false;
                    selectNode(n.id);
                  }}
                >
                  {dictionary.kinds[n.kind]} · {n.label}{' '}
                  <small>
                    {n.sourceTitle ?? copy.unknownSource}
                    {n.record
                      ? ` · ${copy.sourceVersion} ${n.record.versionId.slice(0, 8)}`
                      : ''}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </details>
        <details open={focused}>
          <summary>
            {copy.edgeList} ({matchedEdges.length})
          </summary>
          <ul className={styles.list}>
            {matchedEdges.map((e) => (
              <li key={e.id}>
                <button
                  aria-pressed={e.id === selectedEdge}
                  onClick={() => {
                    dragged.current = false;
                    selectEdge(e.id);
                  }}
                >
                  {e.row.candidate.subject.label} →{' '}
                  {dictionary.predicates[e.row.candidate.predicate]} →{' '}
                  {e.row.candidate.object.label}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </>
    ),
    [
      search,
      copy,
      matchedNodes,
      selectedId,
      selectNode,
      focused,
      matchedEdges,
      selectedEdge,
      selectEdge,
      dictionary,
    ],
  );
  return (
    <section
      className={styles.frame}
      data-testid="business-scene"
      data-state="ready"
      data-form={settings.form}
      data-perspective={settings.view}
      data-node-count={scene.nodes.length}
      data-edge-count={scene.edges.length}
      data-zoom={camera.zoom}
    >
      <div
        className={styles.toolbar}
        role="group"
        aria-label={copy.readingStyle}
      >
        {(['overview', 'evidence', 'smooth'] as const).map((style) => (
          <button
            key={style}
            aria-pressed={settings.style === style}
            onClick={() => change({ style })}
          >
            {copy.styles[style]}
          </button>
        ))}
        <small>{copy.styleScope}</small>
      </div>
      <div className={styles.typeLegend} aria-label={copy.typeLegend}>
        {presentFamilies.map((family) => (
          <span key={family}>
            <svg width="22" height="22" aria-hidden="true">
              <BusinessSceneGlyph family={family} x={11} y={11} size={7} />
            </svg>
            {copy.nodeFamilies[family]}
          </span>
        ))}
        {presentEdges.map((family) => (
          <span key={family}>
            <svg width="26" height="22" aria-hidden="true">
              <line
                x1="1"
                y1="11"
                x2="25"
                y2="11"
                stroke={familyColor(family)}
                strokeWidth="2"
              />
            </svg>
            {copy.edgeFamilies[family]}
          </span>
        ))}
        <small>{copy.statusLegend}</small>
      </div>
      <div className={styles.toolbar}>
        <label>
          {copy.view}
          <select
            value={settings.view}
            onChange={(e) =>
              change({ view: e.target.value as SceneView['view'] })
            }
          >
            {Object.entries(copy.views).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label={copy.form}>
          {Object.entries(copy.forms).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={settings.form === id}
              onClick={() => change({ form: id as SceneView['form'] })}
            >
              {label}
            </button>
          ))}
        </div>
        {settings.form !== 'space' ? (
          <>
            <button onClick={() => zoom(1.35)} aria-label={copy.zoomIn}>
              ＋
            </button>
            <button onClick={() => zoom(1 / 1.35)} aria-label={copy.zoomOut}>
              −
            </button>
            <button
              onClick={() => {
                remember();
                if (timer.current) clearTimeout(timer.current);
                setCamera({ zoom: 1, panX: 0, panY: 0 });
                setGroup(null);
                setHover(null);
                setEdgeCandidates([]);
                onSelect(null);
                onEdge(null);
                onSettings({
                  ...settings,
                  view: 'overview',
                  zoom: 1,
                  panX: 0,
                  panY: 0,
                });
              }}
            >
              {copy.reset}
            </button>
            <button
              disabled={!previous.current.length}
              onClick={() => {
                const value = previous.current.pop();
                if (value) commit(value);
              }}
            >
              {copy.previous}
            </button>
            <button
              disabled={!selectedId}
              onClick={() => {
                const p = projected.get(selectedId!);
                if (p) {
                  remember();
                  commit({
                    zoom: Math.max(camera.zoom, 2),
                    panX:
                      -(p[0] - fit.x) * fit.scale * Math.max(camera.zoom, 2),
                    panY:
                      -(p[1] - fit.y) * fit.scale * Math.max(camera.zoom, 2),
                  });
                }
              }}
            >
              {copy.locate}
            </button>
          </>
        ) : null}
      </div>
      <details className={styles.settings}>
        <summary>{copy.settings}</summary>
        <div className={styles.toolbar}>
          <label>
            {copy.grouping}
            <select
              value={settings.grouping}
              onChange={(e) =>
                change({ grouping: e.target.value as SceneView['grouping'] })
              }
            >
              <option value="sources">{copy.sources}</option>
              <option value="kinds">{copy.kinds}</option>
            </select>
          </label>
          {settings.form === 'layers' ? (
            <>
              {(
                [
                  ['yaw', -180, 180, 5, copy.yaw],
                  ['pitch', 0, 80, 5, copy.pitch],
                  ['gap', 100, 600, 20, copy.gap],
                ] as const
              ).map(([field, min, max, step, label]) => (
                <label key={field}>
                  {label} · {settings[field]}
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={settings[field]}
                    onChange={(e) =>
                      change({ [field]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </>
          ) : null}
        </div>
      </details>
      <p className={styles.hint}>
        {settings.form === 'layers'
          ? copy.layerHint
          : settings.view === 'time'
            ? copy.timeHint
            : settings.view === 'object' || settings.view === 'trace'
              ? copy.objectHint
              : settings.view === 'compare'
                ? copy.compareHint
                : copy.planeHint}
      </p>
      <div className={styles.workspace}>
        <div className={styles.plot} ref={root}>
          {settings.form === 'space' ? (
            <BusinessSceneMap
              scene={scene}
              queryId={queryId}
              locale={locale}
              onInvalidated={onInvalidated}
              width={width}
              settings={settings}
              onSettings={onSettings}
              focus={focus}
              selectedId={selectedId}
              onSelect={selectNode}
              onEdge={selectEdge}
            />
          ) : (
            <svg
              ref={svg}
              role="img"
              aria-label={copy.forms[settings.form]}
              viewBox={`0 0 ${width} ${height}`}
              width="100%"
              height={height}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === '+' || e.key === '=') {
                  e.preventDefault();
                  zoom(1.35);
                }
                if (e.key === '-') {
                  e.preventDefault();
                  zoom(1 / 1.35);
                }
                if (e.key === 'Escape') {
                  setGroup(null);
                  onSelect(null);
                  onEdge(null);
                }
                const direction: { [key: string]: [number, number] } = {
                  ArrowLeft: [40, 0],
                  ArrowRight: [-40, 0],
                  ArrowUp: [0, 40],
                  ArrowDown: [0, -40],
                };
                if (direction[e.key]) {
                  e.preventDefault();
                  commit(
                    {
                      ...camera,
                      panX: camera.panX + direction[e.key][0],
                      panY: camera.panY + direction[e.key][1],
                    },
                    true,
                  );
                }
              }}
              onPointerDown={(e) => {
                dragged.current = false;
                pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
                if (e.target === e.currentTarget)
                  e.currentTarget.setPointerCapture?.(e.pointerId);
              }}
              onPointerMove={(e) => {
                const before = pointers.current.get(e.pointerId);
                if (!before) return;
                const next: [number, number] = [e.clientX, e.clientY];
                if (!dragged.current) {
                  if (Math.hypot(next[0] - before[0], next[1] - before[1]) <= 2)
                    return;
                  remember();
                  dragged.current = true;
                }
                const other = [...pointers.current].find(
                  ([id]) => id !== e.pointerId,
                )?.[1];
                if (other) {
                  const oldDistance = Math.hypot(
                    before[0] - other[0],
                    before[1] - other[1],
                  );
                  const distance = Math.hypot(
                    next[0] - other[0],
                    next[1] - other[1],
                  );
                  if (oldDistance > 0) {
                    const r = e.currentTarget.getBoundingClientRect();
                    commit(
                      zoomSceneCamera(
                        cameraRef.current,
                        distance / oldDistance,
                        [
                          (next[0] + other[0]) / 2 -
                            r.left -
                            width / 2 -
                            layerInset,
                          (next[1] + other[1]) / 2 - r.top - height / 2,
                        ],
                      ),
                      true,
                    );
                  }
                } else
                  commit(
                    {
                      ...cameraRef.current,
                      panX: cameraRef.current.panX + next[0] - before[0],
                      panY: cameraRef.current.panY + next[1] - before[1],
                    },
                    true,
                  );
                pointers.current.set(e.pointerId, next);
              }}
              onPointerUp={(e) => {
                pointers.current.delete(e.pointerId);
                e.currentTarget.releasePointerCapture?.(e.pointerId);
              }}
              onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
            >
              <defs>
                {presentEdges.map((family) => (
                  <marker
                    key={family}
                    id={`${marker}-${family}`}
                    viewBox="0 0 8 8"
                    refX="8"
                    refY="4"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M0 0 L8 4 L0 8" fill={familyColor(family)} />
                  </marker>
                ))}
              </defs>
              <g
                data-camera-pan
                transform={`translate(${camera.panX} ${camera.panY})`}
              >
                {marks}
              </g>
              {planes.map((p) => {
                const label = groupLabels.get(p.id);
                if (!label) return null;
                const basePoint = screenPoint(p.corners[0]);
                const point = [
                  basePoint[0] + camera.panX,
                  basePoint[1] + camera.panY,
                ];
                const layered = settings.form === 'layers';
                const x = label.x + (layered ? 0 : camera.panX);
                const y = label.y + (layered ? 0 : camera.panY);
                const name = groupLabel(p.id);
                const maxCharacters = Math.max(
                  3,
                  Math.floor(
                    (label.width - String(p.members.length).length * 8 - 32) /
                      14,
                  ),
                );
                const shortName =
                  [...name].length > maxCharacters
                    ? [...name].slice(0, maxCharacters - 1).join('') + '…'
                    : name;
                return (
                  <g
                    key={p.id}
                    data-group-caption={p.id}
                    onClick={() => {
                      if (!dragged.current) selectGroup(p.id);
                    }}
                    className={styles.hit}
                  >
                    <title>
                      {name} · {p.members.length}
                    </title>
                    <line
                      x1={x + label.width / 2}
                      y1={y + 28}
                      x2={point[0]}
                      y2={point[1]}
                      stroke="var(--border-strong)"
                      pointerEvents="none"
                    />
                    <rect
                      x={x}
                      y={y}
                      width={label.width}
                      height={28}
                      rx={6}
                      fill="var(--surface)"
                      stroke={
                        group === p.id
                          ? 'var(--accent)'
                          : 'var(--border-strong)'
                      }
                    />
                    <text x={x + 6} y={y + 20} className={styles.groupLabel}>
                      {shortName} · {p.members.length}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
          <div className={styles.caption}>
            <span>
              {copy.count
                .replace('{nodes}', String(scene.nodes.length))
                .replace('{edges}', String(scene.edges.length))}
            </span>
            <span>
              {copy.groupCaptions
                .replace('{shown}', String(groupLabels.size))
                .replace('{total}', String(planes.length))}
            </span>
            <span>
              {copy.scale} ·{' '}
              {camera.zoom < 1.4
                ? copy.labelScale.overview
                : camera.zoom < 3
                  ? copy.labelScale.region
                  : copy.labelScale.detail}
            </span>
          </div>
        </div>
        <aside className={styles.inspector} aria-label={copy.evidence}>
          {selectedNode ? (
            <>
              <strong>
                {copy.selectedNode} · {selectedNode.label}
              </strong>
              {selectedNode.classificationBasis ? (
                <p>
                  {copy.classification}
                  <br />
                  {selectedNode.classificationBasis}
                </p>
              ) : null}
            </>
          ) : null}
          <p>{focused ? copy.focusHint : copy.choose}</p>
          <div className={styles.toolbar}>
            <button
              disabled={!focused}
              onClick={() => {
                setGroup(null);
                setHover(null);
                onSelect(null);
                onEdge(null);
              }}
            >
              {copy.clear}
            </button>
            <label>
              {copy.depth}
              <select
                value={settings.depth}
                onChange={(e) => change({ depth: Number(e.target.value) })}
              >
                <option value={1}>{copy.direct}</option>
                <option value={2}>{copy.twoHops}</option>
              </select>
            </label>
          </div>
          {edgeCandidates.length > 1 ? (
            <section aria-label={copy.overlapping}>
              <strong>
                {copy.overlapping} · {edgeCandidates.length}
              </strong>
              <ul className={styles.list}>
                {scene.edges
                  .filter((e) => edgeCandidates.includes(e.id))
                  .map((e) => (
                    <li key={e.id}>
                      <button
                        onClick={() => {
                          dragged.current = false;
                          selectEdge(e.id);
                        }}
                      >
                        {e.row.candidate.subject.label} →{' '}
                        {dictionary.predicates[e.row.candidate.predicate]} →{' '}
                        {e.row.candidate.object.label}
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}
          {evidence}
          <label>
            {copy.search}
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {memberLists}
        </aside>
      </div>
      <p className={styles.hint}>{copy.zoomHint}</p>
      <details className={styles.legend}>
        <summary>
          {copy.grouping} · {layout.groups.length}
        </summary>
        <div>
          {layout.groups.map((g) => (
            <button
              key={g.id}
              aria-pressed={group === g.id}
              onClick={() => selectGroup(g.id)}
            >
              <strong>
                {groupLabel(g.id)} · {g.members.length}
              </strong>
              <small>
                {copy.inside} {g.internal} · {copy.between} {g.external}
              </small>
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}
