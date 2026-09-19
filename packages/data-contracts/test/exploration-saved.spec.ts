import { expect, it } from 'vitest';
import {
  CreateExplorationViewInputSchema,
  ExplorationViewSpecSchema,
} from '../src/exploration/saved.js';
const id = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000001';
const viewSpec = {
  activeView: 'records',
  requests: {
    records: {
      queryId: id,
      view: 'records',
      versionId: id,
      assetId: id,
      first: 25,
    },
  },
  selection: { dataItemId: id, versionId: id, recordId: id },
};
it('saves bounded typed display state and binds every request to one authorized query', () => {
  expect(
    CreateExplorationViewInputSchema.parse({
      queryId: id,
      title: 'Water level',
      viewSpec,
    }).visibility,
  ).toBe('private');
  expect(
    CreateExplorationViewInputSchema.safeParse({
      queryId: id,
      title: 'Water level',
      visibility: 'project',
      viewSpec,
    }).success,
  ).toBe(true);
  for (const value of [
    {
      ...viewSpec,
      requests: { records: { queryId: other, view: 'records', versionId: id } },
    },
    { ...viewSpec, requests: { records: { spec: {}, view: 'resources' } } },
    { ...viewSpec, requests: { records: { queryId: id, view: 'map' } } },
    { ...viewSpec, script: 'execute()' },
  ])
    expect(
      CreateExplorationViewInputSchema.safeParse({
        queryId: id,
        title: 'Saved',
        viewSpec: value,
      }).success,
    ).toBe(false);
  expect(
    CreateExplorationViewInputSchema.safeParse({
      queryId: id,
      title: ' ',
      viewSpec,
    }).success,
  ).toBe(false);
});
it('bounds map cameras and navigation history without accepting arbitrary presentation code', () => {
  expect(
    ExplorationViewSpecSchema.safeParse({
      ...viewSpec,
      map: {
        camera: { longitude: 116, latitude: 40, zoom: 6, bearing: 0, pitch: 0 },
        layers: { points: true, lines: false, polygons: true },
      },
    }).success,
  ).toBe(true);
  for (const map of [
    { camera: { longitude: 200, latitude: 40, zoom: 6, bearing: 0, pitch: 0 } },
    {
      camera: { longitude: 116, latitude: 90, zoom: 99, bearing: 0, pitch: 0 },
    },
    { styleUrl: 'https://untrusted.test/style.json' },
  ])
    expect(
      ExplorationViewSpecSchema.safeParse({ ...viewSpec, map }).success,
    ).toBe(false);
  expect(
    ExplorationViewSpecSchema.safeParse({
      ...viewSpec,
      navigation: { records: { page: 1, cursors: [null, 'cursor'] } },
    }).success,
  ).toBe(true);
  expect(
    ExplorationViewSpecSchema.safeParse({
      ...viewSpec,
      navigation: { records: { page: 3, cursors: [null] } },
    }).success,
  ).toBe(false);
});

it('retains typed business presentation without changing the saved query or evidence selection', () => {
  const presentation = {
    scene: {
      style: 'evidence',
      view: 'compare',
      form: 'layers',
      grouping: 'kinds',
      depth: 2,
      gap: 300,
      yaw: 20,
      pitch: 50,
      zoom: 2,
      panX: 30,
      panY: -40,
      mapLon: 116,
      mapLat: 40,
      mapZoom: 8,
    },
    reading: { presentation: 'network', page: 1, mode: 'overview' },
    layout: {
      layout: 'hierarchy',
      grouping: 'source',
      nodeSpacing: 40,
      groupSpacing: 200,
    },
    periodUnit: 'year',
    focus: {
      entity: {
        dataItemId: id,
        versionId: id,
        mappingVersion: 'v1',
        entityKey: 'reach',
      },
    },
  };
  const saved = ExplorationViewSpecSchema.safeParse({
    ...viewSpec,
    presentation,
  });
  expect(saved.success).toBe(true);
  expect(saved.success && saved.data).toEqual({ ...viewSpec, presentation });
  for (const invalid of [
    { ...presentation, script: 'alert(1)' },
    { ...presentation, scene: { ...presentation.scene, mapLat: 91 } },
    { ...presentation, scene: { ...presentation.scene, zoom: Infinity } },
    {
      ...presentation,
      scene: { ...presentation.scene, form: 'external-engine' },
    },
    { ...presentation, layout: { ...presentation.layout, nodeSpacing: 41 } },
    { ...presentation, reading: { ...presentation.reading, page: 10000 } },
    {
      ...presentation,
      focus: { entity: { dataItemId: id, versionId: 'unknown' } },
    },
  ])
    expect(
      ExplorationViewSpecSchema.safeParse({
        ...viewSpec,
        presentation: invalid,
      }).success,
    ).toBe(false);
  expect(ExplorationViewSpecSchema.parse(viewSpec)).toEqual(viewSpec);
});
