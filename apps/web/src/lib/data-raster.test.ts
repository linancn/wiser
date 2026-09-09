import { describe, expect, it } from 'vitest';
import { rasterGrid, rasterPixels } from './data-raster';

describe('indexed raster content', () => {
  it('preserves zero and negative pixels while excluding masked values from the range', () => {
    const values = {
      __kind: 'RASTER_BAND',
      c2: { size: [2, 2], unit: 'mm' },
      c3: [
        [null, -2],
        [0, 6],
      ],
    };
    const grid = rasterGrid(values);
    expect(grid).toMatchObject({
      width: 2,
      height: 2,
      min: -2,
      max: 6,
      valid: 3,
      unit: 'mm',
    });
    expect(grid?.values).toEqual([null, -2, 0, 6]);
    const pixels = rasterPixels(grid!);
    expect([...pixels.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(pixels[11]).toBe(255);
    expect(values.c3).toEqual([
      [null, -2],
      [0, 6],
    ]);
  });
  it('rejects missing, ragged, oversized, nonfinite or multidimensional content without inventing a raster', () => {
    for (const c3 of [
      null,
      [[1], [1, 2]],
      [[Infinity]],
      [[[1]]],
      Array.from({ length: 257 }, () => Array(256).fill(1)),
    ]) {
      expect(rasterGrid({ __kind: 'RASTER_BAND', c3 })).toBeNull();
    }
    expect(rasterGrid({ c3: [[1]] })).toBeNull();
  });
  it('supports two-dimensional NetCDF variables and all-masked or constant bands', () => {
    expect(
      rasterGrid({ __kind: 'NETCDF_VARIABLE', c3: [[null]] }),
    ).toMatchObject({ valid: 0, min: null, max: null });
    const grid = rasterGrid({ __kind: 'RASTER_BAND', c3: [[2, 2]] });
    expect([...rasterPixels(grid!)]).toEqual([
      33, 145, 140, 255, 33, 145, 140, 255,
    ]);
  });
});
