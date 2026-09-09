export interface RasterGrid {
  readonly width: number;
  readonly height: number;
  readonly values: readonly (number | null)[];
  readonly min: number | null;
  readonly max: number | null;
  readonly valid: number;
  readonly unit: string;
}

export function rasterGrid(
  record: Readonly<Record<string, unknown>>,
): RasterGrid | null {
  if (
    record['__kind'] !== 'RASTER_BAND' &&
    record['__kind'] !== 'NETCDF_VARIABLE'
  )
    return null;
  const rows: unknown = record['c3'];
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(rows[0]))
    return null;
  const width = rows[0].length;
  if (width === 0 || rows.length * width > 65536) return null;
  const values: (number | null)[] = [];
  let min = Infinity;
  let max = -Infinity;
  let valid = 0;
  for (const row of rows as unknown[]) {
    if (!Array.isArray(row) || row.length !== width) return null;
    for (const value of row as unknown[]) {
      if (
        value !== null &&
        (typeof value !== 'number' || !Number.isFinite(value))
      )
        return null;
      values.push(value);
      if (value !== null) {
        min = Math.min(min, value);
        max = Math.max(max, value);
        valid++;
      }
    }
  }
  const metadata = record['c2'];
  const unit =
    metadata &&
    typeof metadata === 'object' &&
    'unit' in metadata &&
    typeof metadata.unit === 'string'
      ? metadata.unit
      : '';
  return {
    width,
    height: rows.length,
    values,
    min: valid ? min : null,
    max: valid ? max : null,
    valid,
    unit,
  };
}

// Viridis anchors remain legible with common color-vision deficiencies.
export function rasterPixels(grid: RasterGrid): Uint8ClampedArray {
  const anchors = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];
  const pixels = new Uint8ClampedArray(grid.values.length * 4);
  grid.values.forEach((value, index) => {
    if (value === null) return;
    const fraction =
      grid.min === grid.max
        ? 0.5
        : (value - grid.min!) / (grid.max! - grid.min!);
    const position = Math.max(0, Math.min(1, fraction)) * 4;
    const start = Math.min(3, Math.floor(position));
    for (let channel = 0; channel < 3; channel++)
      pixels[index * 4 + channel] = Math.round(
        anchors[start][channel] +
          (anchors[start + 1][channel] - anchors[start][channel]) *
            (position - start),
      );
    pixels[index * 4 + 3] = 255;
  });
  return pixels;
}
