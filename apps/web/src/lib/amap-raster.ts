import { fromAmap } from './amap-coordinates';

export function worldPixel(
  position: readonly number[],
  z: number,
): [number, number] {
  const size = 256 * 2 ** z;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, position[1]));
  return [
    ((position[0] + 180) / 360) * size,
    ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * size,
  ];
}

// Pixel centers are mapped back to the unchanged WGS84 source. Nearest-neighbor
// sampling preserves classified rasters and nodata instead of averaging classes.
export function rasterMapping(z: number, x: number, y: number): Float64Array {
  if (
    ![z, x, y].every(Number.isInteger) ||
    z < 0 ||
    z > 22 ||
    x < 0 ||
    y < 0 ||
    x >= 2 ** z ||
    y >= 2 ** z
  )
    throw new TypeError('Invalid raster tile');
  const size = 256 * 2 ** z;
  const coordinate = (u: number, v: number): [number, number] => [
    ((x * 256 + u) / size) * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y * 256 + v)) / size))) * 180) /
      Math.PI,
  ];
  const exact = (u: number, v: number) =>
    worldPixel(fromAmap(coordinate(u, v)), z);
  const nw = coordinate(0, 0),
    se = coordinate(256, 256);
  // Do not interpolate across the transform boundary or coarse global tiles.
  const interior =
    nw[0] > 72.02 && se[0] < 137.82 && se[1] > 0.85 && nw[1] < 55.81;
  const grid =
    z >= 8 && interior
      ? Array.from({ length: 33 * 33 }, (_, i) =>
          exact((i % 33) * 8 + 0.5, Math.floor(i / 33) * 8 + 0.5),
        )
      : null;
  const output = new Float64Array(256 * 256 * 2);
  for (let v = 0; v < 256; v++)
    for (let u = 0; u < 256; u++) {
      const index = (v * 256 + u) * 2;
      if (!grid) {
        output.set(exact(u + 0.5, v + 0.5), index);
        continue;
      }
      const gx = Math.floor(u / 8),
        gy = Math.floor(v / 8),
        tx = (u % 8) / 8,
        ty = (v % 8) / 8;
      for (let axis = 0; axis < 2; axis++)
        output[index + axis] =
          (grid[gy * 33 + gx][axis] * (1 - tx) +
            grid[gy * 33 + gx + 1][axis] * tx) *
            (1 - ty) +
          (grid[(gy + 1) * 33 + gx][axis] * (1 - tx) +
            grid[(gy + 1) * 33 + gx + 1][axis] * tx) *
            ty;
    }
  return output;
}

export function sampleRaster(
  mapping: Float64Array,
  pixel: (x: number, y: number) => ArrayLike<number>,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(mapping.length * 2);
  for (let i = 0; i < mapping.length; i += 2)
    output.set(
      pixel(Math.floor(mapping[i]), Math.floor(mapping[i + 1])),
      i * 2,
    );
  return output;
}
