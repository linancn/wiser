import { expect, it } from 'vitest';
import {
  ExplorationQueryInputSchema,
  ExplorationResultSchema,
} from '../src/exploration/index.js';
const id = '10000000-0000-4000-8000-000000000001';
it('applies a bounded geographic predicate to the shared query instead of only its map page', () => {
  expect(
    ExplorationQueryInputSchema.safeParse({
      baseQueryId: id,
      spec: { spatialBounds: [-78, 38, -77, 39] },
      view: 'resources',
    }).success,
  ).toBe(true);
  expect(
    ExplorationResultSchema.safeParse({
      queryId: id,
      spec: { spatialBounds: [-78, 38, -77, 39] },
      view: 'resources',
      createdAt: '2026-09-08T00:00:00Z',
      expiresAt: '2026-09-08T00:30:00Z',
      totalCount: 0,
      resources: [],
    }).success,
  ).toBe(true);
  for (const bounds of [
    [-181, 0, 180, 80],
    [0, -91, 10, 20],
    [10, 20, 0, 30],
    [0, 30, 10, 20],
    [0, 0, Infinity, 20],
  ])
    expect(
      ExplorationQueryInputSchema.safeParse({
        spec: { spatialBounds: bounds },
        view: 'resources',
      }).success,
    ).toBe(false);
});
