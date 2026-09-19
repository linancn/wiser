import { expect, it } from 'vitest';
import {
  readSceneView,
  writeSceneView,
  defaultSceneView,
  scenePositions,
  projectScenePoint,
  zoomSceneCamera,
  placeSceneGroupLabels,
} from './business-scene-view';
import type { BusinessScene } from './business-scene';
const scene: BusinessScene = {
  nodes: Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    label: String(i),
    kind: i < 10 ? 'DOCUMENT' : 'PLACE',
    group: i < 10 ? 'reports' : 'PLACE',
    classificationBasis: null,
    record: null,
    periods: [],
  })),
  edges: [],
};
it('places nearby group names without overlap while keeping their original anchors and identities', () => {
  const anchors = Array.from({ length: 17 }, (_, index) => ({
    id: String(index),
    x: 60 + (index % 4) * 125,
    y: 90 + Math.floor(index / 4) * 100,
    width: 180,
  }));
  const labels = placeSceneGroupLabels(anchors, 720, 700);
  expect(labels).toHaveLength(17);
  expect(labels.map((item) => item.id).sort()).toEqual(
    anchors.map((item) => item.id).sort(),
  );
  for (const label of labels) {
    expect([label.anchorX, label.anchorY]).toEqual([
      anchors.find((a) => a.id === label.id)!.x,
      anchors.find((a) => a.id === label.id)!.y,
    ]);
    expect(label.x).toBeGreaterThanOrEqual(6);
    expect(label.x + label.width).toBeLessThanOrEqual(714);
    expect(label.y + 28).toBeLessThanOrEqual(694);
    for (const other of labels.filter((v) => v.id !== label.id))
      expect(
        label.x + label.width <= other.x ||
          other.x + other.width <= label.x ||
          label.y + 28 <= other.y ||
          other.y + 28 <= label.y,
      ).toBe(true);
  }
  expect(placeSceneGroupLabels([...anchors].reverse(), 720, 700)).toEqual(
    labels,
  );
});
it('bounds crowded labels without inventing group members or putting a long name outside a narrow canvas', () => {
  const anchors = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    x: 20,
    y: 20,
    width: 400,
  }));
  const labels = placeSceneGroupLabels(anchors, 280, 100);
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.length).toBeLessThan(anchors.length);
  expect(
    labels.every((v) => v.width <= 268 && anchors.some((a) => a.id === v.id)),
  ).toBe(true);
});
it('roundtrips bounded presentation and camera controls without touching query pins', () => {
  const params = new URLSearchParams(
    'saved=private&businessForm=layers&businessView=compare&businessYaw=30&businessZoom=2.5&businessStyle=smooth',
  );
  const settings = readSceneView(params);
  expect(settings.style).toBe('smooth');
  expect(settings.form).toBe('layers');
  expect(settings.view).toBe('compare');
  expect(settings.yaw).toBe(30);
  expect(settings.zoom).toBe(2.5);
  writeSceneView(params, settings);
  expect(params.get('saved')).toBe('private');
  expect(readSceneView(params)).toEqual(settings);
  expect(
    readSceneView(
      new URLSearchParams(
        'businessForm=layers&businessForm=space&businessZoom=Infinity&businessYaw=9999&businessView=sql',
      ),
    ),
  ).toEqual(defaultSceneView);
});
it('keeps exact membership and finite positions in every task and display mode', () => {
  for (const view of [
    'overview',
    'compare',
    'object',
    'trace',
    'time',
  ] as const)
    for (const form of ['flat', 'layers', 'space'] as const) {
      const layout = scenePositions(
        scene,
        { ...defaultSceneView, view, form },
        '1',
      );
      expect([...layout.positions.keys()].sort()).toEqual(
        scene.nodes.map((n) => n.id).sort(),
      );
      for (const p of layout.positions.values())
        expect(p.every(Number.isFinite)).toBe(true);
      expect(layout.groups.every((g) => g.members.length > 0)).toBe(true);
    }
});
it('uses depth for category layers, and rotation preserves identities rather than recomputing membership', () => {
  const layout = scenePositions(
    scene,
    { ...defaultSceneView, form: 'layers' },
    null,
  );
  const a = layout.positions.get('0')!,
    b = layout.positions.get('10')!;
  expect(a[2]).not.toBe(b[2]);
  expect(projectScenePoint(a, 0, 45)).not.toEqual(projectScenePoint(a, 50, 45));
  expect(projectScenePoint([10, 20, 0], 0, 0)).toEqual([10, 20]);
});
it('zooms around the cursor without moving its world point or changing source positions', () => {
  const camera = { zoom: 1, panX: 10, panY: 20 };
  const next = zoomSceneCamera(camera, 2, [100, 150]);
  expect((100 - next.panX) / next.zoom).toBe((100 - camera.panX) / camera.zoom);
  expect((150 - next.panY) / next.zoom).toBe((150 - camera.panY) / camera.zoom);
  expect(zoomSceneCamera(camera, 999, [0, 0]).zoom).toBeLessThanOrEqual(20);
});
it('offers every edge at a crossing instead of silently choosing the last painted edge', async () => {
  const { sceneEdgesAt } = await import('./business-scene-view');
  const positions = new Map<string, [number, number]>([
    ['a', [0, 0]],
    ['b', [100, 100]],
    ['c', [0, 100]],
    ['d', [100, 0]],
    ['e', [400, 400]],
  ]);
  expect(
    sceneEdgesAt(
      [
        { id: 'ab', from: 'a', to: 'b' },
        { id: 'cd', from: 'c', to: 'd' },
        { id: 'ae', from: 'a', to: 'e' },
      ],
      positions,
      [50, 50],
      5,
    ),
  ).toEqual(['ab', 'cd', 'ae']);
  expect(
    sceneEdgesAt([{ id: 'ee', from: 'e', to: 'e' }], positions, [50, 50], 5),
  ).toEqual([]);
});
