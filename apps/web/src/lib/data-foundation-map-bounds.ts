import {
  amapCoordinates,
  toAmap,
  type MapCoordinateSystem,
} from './amap-coordinates';

type Bounds = readonly [number, number, number, number];

export function mapDisplayBounds(
  geometries: readonly unknown[],
  stacBounds: readonly Bounds[],
  crs: MapCoordinateSystem,
  requestedBounds?: Bounds,
): Bounds | undefined {
  let bounds: [number, number, number, number] | undefined;
  const extend = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    const coordinates: readonly unknown[] = value;
    const [x, y] = coordinates;
    if (typeof x === 'number' && typeof y === 'number') {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      bounds = bounds
        ? [
            Math.min(bounds[0], x),
            Math.min(bounds[1], y),
            Math.max(bounds[2], x),
            Math.max(bounds[3], y),
          ]
        : [x, y, x, y];
      return;
    }
    for (const child of coordinates) extend(child);
  };
  for (const geometry of geometries) extend(amapCoordinates(geometry, crs));
  for (const area of stacBounds) {
    extend(toAmap([area[0], area[1]]));
    extend(toAmap([area[2], area[3]]));
  }
  if (bounds === undefined && requestedBounds !== undefined) {
    const [west, south, east, north] = requestedBounds;
    for (const corner of [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
    ]) {
      extend(toAmap(corner, crs));
    }
  }
  return bounds;
}
