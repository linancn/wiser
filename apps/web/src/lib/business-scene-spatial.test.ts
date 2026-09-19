import { expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import {
  spatialSceneAnchors,
  unlocatedSceneLayout,
} from './business-scene-spatial';
import type { BusinessScene } from './business-scene';
const node = {
  id: 'source-object',
  label: '官厅水库',
  kind: 'PLACE' as const,
  group: 'PLACE',
  classificationBasis: null,
  periods: [],
  record: { dataItemId: 'source', versionId: 'version', recordId: 'record' },
};
const scene: BusinessScene = {
  nodes: [
    node,
    { ...node, id: 'same-name', record: null },
    {
      ...node,
      id: 'wrong-version',
      record: { ...node.record, versionId: 'foreign' },
    },
  ],
  edges: [],
};
const features: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'geometry',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [115, 40],
            [116, 40],
            [116, 41],
            [115, 40],
          ],
        ],
      },
      properties: node.record,
    },
  ],
};
it('anchors only the exact bound resource, version and record; an area remains an area', () => {
  const anchors = spatialSceneAnchors(scene, features);
  expect([...anchors.keys()]).toEqual(['source-object']);
  expect(anchors.get('source-object')?.feature.geometry.type).toBe('Polygon');
  expect(anchors.get('source-object')?.labelPoint).toEqual([115.5, 40.5]);
  expect(features.features[0].geometry.type).toBe('Polygon');
});
it('does not guess positions for names, empty features, invalid coordinates or unbound records', () => {
  expect(
    spatialSceneAnchors(scene, { type: 'FeatureCollection', features: [] })
      .size,
  ).toBe(0);
  const bad = {
    ...features,
    features: [
      {
        ...features.features[0],
        geometry: { type: 'Point' as const, coordinates: [NaN, 40] },
      },
    ],
  };
  expect(spatialSceneAnchors(scene, bad).size).toBe(0);
});

it('retains every source identity in a deterministic narrow reading layout without changing source locations', () => {
  const nodes = Array.from({ length: 1141 }, (_, i) => ({
    ...node,
    id: `source-${i}`,
    group: `group-${i % 17}`,
  }));
  const before = JSON.stringify(nodes);
  const result = unlocatedSceneLayout(nodes, 140, 590);
  expect(result.positions.size).toBe(nodes.length);
  expect(result.captions.reduce((sum, group) => sum + group.count, 0)).toBe(
    nodes.length,
  );
  expect([...result.positions]).toEqual([
    ...unlocatedSceneLayout([...nodes].reverse(), 140, 590).positions,
  ]);
  for (const [x, y] of result.positions.values()) {
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(140);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(590);
  }
  expect(JSON.stringify(nodes)).toBe(before);
  expect(unlocatedSceneLayout([], 140, 590).positions.size).toBe(0);
});
