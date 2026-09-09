import gcoord from 'gcoord';

export type MapCoordinateSystem = 'EPSG:4326' | 'EPSG:4490' | 'GCJ-02';
export type MapPosition = [number, number, ...number[]];

function checked(position: readonly number[]): MapPosition {
  if (
    position.length < 2 ||
    position.some((value) => !Number.isFinite(value)) ||
    Math.abs(position[0]) > 180 ||
    Math.abs(position[1]) > 90
  )
    throw new TypeError('Invalid geographic position');
  return [position[0], position[1], ...position.slice(2)];
}

// Authority coordinates are immutable. CGCS2000 uses the geographic display
// approximation already supported by the map API; this is not a survey transform.
export function toAmap(
  position: readonly number[],
  crs: MapCoordinateSystem = 'EPSG:4326',
): MapPosition {
  const original = checked(position);
  if (crs === 'GCJ-02') return original;
  const converted = gcoord.transform(
    [original[0], original[1]],
    gcoord.WGS84,
    gcoord.GCJ02,
  );
  return [converted[0], converted[1], ...original.slice(2)];
}

export function fromAmap(position: readonly number[]): MapPosition {
  const original = checked(position);
  const converted = gcoord.transform(
    [original[0], original[1]],
    gcoord.GCJ02,
    gcoord.WGS84,
  );
  return [converted[0], converted[1], ...original.slice(2)];
}

export function amapCoordinates(
  value: unknown,
  crs: MapCoordinateSystem = 'EPSG:4326',
): unknown {
  if (!Array.isArray(value))
    throw new TypeError('Invalid geometry coordinates');
  const coordinates: unknown[] = value;
  if (coordinates.length === 0) return [];
  if (typeof coordinates[0] === 'number') {
    if (!coordinates.every((entry) => typeof entry === 'number'))
      throw new TypeError('Invalid position');
    return toAmap(coordinates, crs);
  }
  return coordinates.map((entry) => amapCoordinates(entry, crs));
}
