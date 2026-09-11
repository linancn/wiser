import { expect, it } from 'vitest';

import { mapDisplayBounds } from './data-foundation-map-bounds';

it('locates a raster-only map at the requested area without creating a feature', () => {
  const area = [115.645355, 40.247302, 115.903919, 40.482742] as const;
  const snapshot = [...area];
  const actual = mapDisplayBounds([], [], 'EPSG:4326', area)!;
  expect(actual[0]).toBeGreaterThan(area[0]);
  expect(actual[0]).toBeLessThan(area[0] + 0.02);
  expect(actual[2]).toBeGreaterThan(area[2]);
  expect(actual[2]).toBeLessThan(area[2] + 0.02);
  expect(actual[1]).toBeCloseTo(area[1], 1);
  expect(actual[3]).toBeCloseTo(area[3], 1);
  expect(area).toEqual(snapshot);
});

it('keeps known feature and STAC extents ahead of a broad requested area', () => {
  expect(
    mapDisplayBounds(
      [
        [-77, 38],
        [
          [-78, 39],
          [-77.5, 40],
        ],
      ],
      [[-76, 37, -75, 38]],
      'EPSG:4326',
      [-180, -90, 180, 90],
    ),
  ).toEqual([-78, 37, -75, 40]);
});

it('keeps the default overview only when no feature, extent or requested area exists', () => {
  expect(mapDisplayBounds([], [], 'EPSG:4326')).toBeUndefined();
  expect(mapDisplayBounds([], [], 'EPSG:4490', [-78, 38, -77, 39])).toEqual([
    -78, 38, -77, 39,
  ]);
});
