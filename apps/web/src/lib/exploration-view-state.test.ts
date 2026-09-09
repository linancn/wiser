import { expect, it } from 'vitest';
import { createExplorationViewState } from './exploration-view-state';
const queryId = '10000000-0000-4000-8000-000000000001';
const foreignId = '10000000-0000-4000-8000-000000000002';
it('captures only current-query completed requests, retaining navigation and map settings across tabs', () => {
  const state = createExplorationViewState(queryId);
  state.report(
    'resources',
    { queryId, view: 'resources', first: 25 },
    { page: 1, cursors: [null, 'cursor'] },
  );
  state.report('map', { queryId, view: 'map', first: 1 });
  state.reportMap({
    camera: { longitude: 110, latitude: 35, zoom: 4, bearing: 0, pitch: 0 },
    layers: { points: true, lines: false, polygons: true },
  });
  expect(state.capture('resources')?.navigation?.resources?.page).toBe(1);
  expect(state.capture('map')?.map?.layers?.lines).toBe(false);
  state.report('graph', { queryId: foreignId, view: 'graph', first: 30 });
  expect(state.capture('graph')).toBeNull();
  state.report('map', null);
  expect(state.capture('map')).toBeNull();
  const restored = createExplorationViewState(
    queryId,
    state.capture('resources')!,
  );
  expect(restored.initial?.navigation?.resources?.cursors).toEqual([
    null,
    'cursor',
  ]);
  expect(restored.capture('resources')?.requests.resources?.queryId).toBe(
    queryId,
  );
  expect(
    createExplorationViewState(foreignId, state.capture('resources')!).capture(
      'resources',
    ),
  ).toBeNull();
});
