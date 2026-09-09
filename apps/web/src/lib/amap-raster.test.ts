import { describe, expect, it } from 'vitest';
import { rasterMapping, sampleRaster, worldPixel } from './amap-raster';
import { toAmap, fromAmap } from './amap-coordinates';

describe('calibrated raster display', () => {
  it('samples the original WGS84 pixel under a calibrated Beijing position across zooms', () => {
    for (const z of [3, 8, 12, 18]) {
      const gcj = toAmap([116.3913, 39.9075]);
      const [px, py] = worldPixel(gcj, z);
      const x = Math.floor(px / 256),
        y = Math.floor(py / 256);
      const mapping = rasterMapping(z, x, y);
      for (const [u, v] of [
        [0, 0],
        [127, 150],
        [255, 255],
      ]) {
        const index = (v * 256 + u) * 2;
        const scale = 256 * 2 ** z;
        const position = [
          ((x * 256 + u + 0.5) / scale) * 360 - 180,
          (Math.atan(
            Math.sinh(Math.PI * (1 - (2 * (y * 256 + v + 0.5)) / scale)),
          ) *
            180) /
            Math.PI,
        ];
        const exact = worldPixel(fromAmap(position), z);
        expect(Math.abs(mapping[index]! - exact[0])).toBeLessThan(0.35);
        expect(Math.abs(mapping[index + 1]! - exact[1])).toBeLessThan(0.35);
      }
    }
  });
  it('keeps overseas pixels and transparent nodata unchanged, including a tile seam', () => {
    const mapping = rasterMapping(8, 73, 97);
    expect(mapping[0]).toBeCloseTo(73 * 256 + 0.5, 6);
    const pixels = sampleRaster(mapping, (x, y) => [
      x % 256,
      y % 256,
      30,
      x % 2 ? 0 : 255,
    ]);
    expect([...pixels.slice(0, 8)]).toEqual([0, 0, 30, 255, 1, 0, 30, 0]);
    const seam = sampleRaster(new Float64Array([255.9, 10, 256.1, 10]), (x) =>
      x < 256 ? [1, 2, 3, 255] : [4, 5, 6, 0],
    );
    expect([...seam]).toEqual([1, 2, 3, 255, 4, 5, 6, 0]);
  });
});
