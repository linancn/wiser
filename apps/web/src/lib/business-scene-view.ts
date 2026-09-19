import type { BusinessScene } from './business-scene';
import { sceneNeighborhood } from './business-scene';
/** Allocate group captions only; never move graph members or infer map coordinates. */
export function placeSceneGroupLabels(
  anchors: readonly { id: string; x: number; y: number; width: number }[],
  width: number,
  height: number,
) {
  const result: {
    id: string;
    x: number;
    y: number;
    width: number;
    anchorX: number;
    anchorY: number;
  }[] = [];
  if (width < 24 || height < 40) return result;
  for (const anchor of [...anchors].sort(
    (a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id, 'en'),
  )) {
    if (![anchor.x, anchor.y, anchor.width].every(Number.isFinite)) continue;
    const labelWidth = Math.min(Math.max(80, anchor.width), width - 12);
    const x = Math.max(6, Math.min(width - labelWidth - 6, anchor.x - 6));
    const preferredY = Math.max(6, Math.min(height - 34, anchor.y - 36));
    const rows = Array.from(
      { length: Math.ceil(height / 34) },
      (_, i) => 6 + i * 34,
    ).filter((y) => y + 28 <= height - 6);
    const candidates = [
      preferredY,
      ...rows.sort(
        (a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY),
      ),
    ];
    const y = candidates.find(
      (y) =>
        !result.some(
          (other) =>
            x < other.x + other.width + 4 &&
            x + labelWidth + 4 > other.x &&
            y < other.y + 32 &&
            y + 32 > other.y,
        ),
    );
    if (y !== undefined)
      result.push({
        id: anchor.id,
        x,
        y,
        width: labelWidth,
        anchorX: anchor.x,
        anchorY: anchor.y,
      });
  }
  return result;
}
export const defaultSceneView = {
  style: 'overview' as 'overview' | 'evidence' | 'smooth',
  view: 'overview' as 'overview' | 'compare' | 'object' | 'trace' | 'time',
  form: 'flat' as 'flat' | 'layers' | 'space',
  grouping: 'sources' as 'sources' | 'kinds',
  depth: 1,
  gap: 240,
  yaw: -20,
  pitch: 55,
  zoom: 1,
  panX: 0,
  panY: 0,
  mapLon: 116,
  mapLat: 40,
  mapZoom: 6,
};
export type SceneView = typeof defaultSceneView;
export function readSceneView(
  search: Pick<URLSearchParams, 'getAll'>,
): SceneView {
  const single = (name: string) => {
    const a = search.getAll('business' + name);
    return a.length === 1 ? a[0] : undefined;
  };
  const option = <T extends string>(
    name: string,
    allowed: readonly T[],
    fallback: T,
  ): T => {
    const raw = single(name);
    return allowed.includes(raw as T) ? (raw as T) : fallback;
  };
  const number = (name: string, min: number, max: number, fallback: number) => {
    const raw = single(name);
    const n = Number(raw);
    return raw !== undefined &&
      /^-?\d+(\.\d{1,4})?$/.test(raw) &&
      n >= min &&
      n <= max
      ? n
      : fallback;
  };
  return {
    style: option(
      'Style',
      ['overview', 'evidence', 'smooth'],
      defaultSceneView.style,
    ),
    view: option(
      'View',
      ['overview', 'compare', 'object', 'trace', 'time'],
      defaultSceneView.view,
    ),
    form: option('Form', ['flat', 'layers', 'space'], defaultSceneView.form),
    grouping: option('LayerBy', ['sources', 'kinds'], 'sources'),
    depth: option('Depth', ['1', '2'], '1') === '2' ? 2 : 1,
    gap: number('LayerGap', 100, 600, 240),
    yaw: number('Yaw', -180, 180, -20),
    pitch: number('Pitch', 0, 80, 55),
    zoom: number('Zoom', 0.1, 20, 1),
    panX: number('PanX', -20000, 20000, 0),
    panY: number('PanY', -20000, 20000, 0),
    mapLon: number('MapLon', -180, 180, 116),
    mapLat: number('MapLat', -85, 85, 40),
    mapZoom: number('MapZoom', 0, 20, 6),
  };
}
export function writeSceneView(params: URLSearchParams, value: SceneView) {
  for (const [key, field] of [
    ['Style', 'style'],
    ['View', 'view'],
    ['Form', 'form'],
    ['LayerBy', 'grouping'],
    ['Depth', 'depth'],
    ['LayerGap', 'gap'],
    ['Yaw', 'yaw'],
    ['Pitch', 'pitch'],
    ['Zoom', 'zoom'],
    ['PanX', 'panX'],
    ['PanY', 'panY'],
    ['MapLon', 'mapLon'],
    ['MapLat', 'mapLat'],
    ['MapZoom', 'mapZoom'],
  ] as const) {
    params.delete('business' + key);
    if (value[field] !== defaultSceneView[field])
      params.set(
        'business' + key,
        typeof value[field] === 'number'
          ? String(Math.round(Number(value[field]) * 10000) / 10000)
          : String(value[field]),
      );
  }
}
export type ScenePoint = [number, number, number];
export type SceneGroup = {
  id: string;
  members: string[];
  center: ScenePoint;
  width: number;
  height: number;
  internal: number;
  external: number;
};
export function scenePositions(
  scene: BusinessScene,
  settings: SceneView,
  selected: string | null,
) {
  const groups = new Map<string, string[]>();
  for (const node of scene.nodes) {
    let key = settings.grouping === 'kinds' ? node.kind : node.group;
    if (settings.view === 'time')
      key =
        node.periods.length === 1
          ? 'year:' + node.periods[0].slice(0, 4)
          : node.periods.length > 1
            ? 'multipleTimes'
            : 'undated';
    const values = groups.get(key) ?? [];
    values.push(node.id);
    groups.set(key, values);
  }
  const sorted = [...groups].sort(([a], [b]) => a.localeCompare(b, 'en'));
  const positions = new Map<string, ScenePoint>();
  const result: SceneGroup[] = [];
  const maxRadius = Math.max(
    120,
    ...sorted.map(([, ids]) => Math.sqrt(ids.length) * 24 + 60),
  );
  const cell = maxRadius * 2 + 180;
  const columns =
    settings.view === 'compare' ? 2 : Math.ceil(Math.sqrt(sorted.length));
  const membership = new Map(
    sorted.flatMap(([id, members]) => members.map((n) => [n, id] as const)),
  );
  const kinds = new Map(scene.nodes.map((n) => [n.id, n.kind]));
  const columnY = [0, 0];
  for (const [index, [id, members]] of sorted.entries()) {
    const radius = Math.max(100, Math.sqrt(members.length) * 24 + 40);
    const center: ScenePoint =
      settings.form === 'layers'
        ? [0, 0, (index - (sorted.length - 1) / 2) * settings.gap]
        : [(index % columns) * cell, Math.floor(index / columns) * cell, 0];
    if (settings.view === 'compare' && settings.form === 'flat') {
      const column = members.every((id) => kinds.get(id) === 'DOCUMENT')
        ? 0
        : 1;
      center[0] = column * cell;
      center[1] = columnY[column] + radius;
      columnY[column] += radius * 2 + 120;
    }
    const points = [...members].sort();
    for (const [i, key] of points.entries()) {
      const theta = i * 2.399963229728653;
      const r = 24 * Math.sqrt(i + 1);
      positions.set(key, [
        center[0] + Math.cos(theta) * r,
        center[1] + Math.sin(theta) * r,
        center[2],
      ]);
    }
    result.push({
      id,
      members,
      center,
      width: radius * 2,
      height: radius * 2,
      internal: scene.edges.filter(
        (e) => membership.get(e.from) === id && membership.get(e.to) === id,
      ).length,
      external: scene.edges.filter(
        (e) =>
          (membership.get(e.from) === id) !== (membership.get(e.to) === id),
      ).length,
    });
  }
  if (
    settings.form === 'flat' &&
    (settings.view === 'object' || settings.view === 'trace') &&
    selected &&
    positions.has(selected)
  ) {
    const direct = sceneNeighborhood(scene, selected, null, settings.depth);
    positions.set(selected, [0, 0, 0]);
    for (const [set, radius] of [
      [
        scene.nodes.filter((n) => n.id !== selected && direct.nodes.has(n.id)),
        300,
      ],
      [scene.nodes.filter((n) => !direct.nodes.has(n.id)), 850],
    ] as const) {
      set.forEach((n, i) => {
        const angle = (i * 2 * Math.PI) / Math.max(1, set.length);
        positions.set(n.id, [
          Math.cos(angle) * (radius + 24 * Math.floor(i / 100)),
          Math.sin(angle) * (radius + 24 * Math.floor(i / 100)),
          0,
        ]);
      });
    }
    return { positions, groups: [] };
  }
  return { positions, groups: result };
}
/** Orthographic camera; depth is a category coordinate, never altitude or importance. */
export function projectScenePoint(
  [x, y, z]: ScenePoint,
  yaw: number,
  pitch: number,
): [number, number] {
  const a = (yaw * Math.PI) / 180,
    b = (pitch * Math.PI) / 180;
  const horizontal = x * Math.cos(a) - y * Math.sin(a),
    forward = x * Math.sin(a) + y * Math.cos(a);
  return [horizontal, forward * Math.cos(b) - z * Math.sin(b)];
}
export function zoomSceneCamera(
  camera: Pick<SceneView, 'zoom' | 'panX' | 'panY'>,
  factor: number,
  point: [number, number],
) {
  const zoom = Math.max(0.1, Math.min(20, camera.zoom * factor));
  return {
    zoom,
    panX: point[0] - ((point[0] - camera.panX) * zoom) / camera.zoom,
    panY: point[1] - ((point[1] - camera.panY) * zoom) / camera.zoom,
  };
}
/** Screen-space hit testing keeps coincident directed assertions independently selectable. */
export function sceneEdgesAt(
  edges: readonly { id: string; from: string; to: string }[],
  positions: ReadonlyMap<string, [number, number]>,
  [x, y]: [number, number],
  tolerance = 6,
) {
  return edges
    .filter((edge) => {
      const a = positions.get(edge.from),
        b = positions.get(edge.to);
      if (!a || !b) return false;
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = dx * dx + dy * dy;
      const t = length
        ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length))
        : 0;
      return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) <= tolerance;
    })
    .map((e) => e.id);
}
