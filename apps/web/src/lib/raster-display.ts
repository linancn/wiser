/** Display-only choices, never a source metadata update or a unit conversion. */
export interface RasterDisplay {
  readonly band: number;
  readonly min: number;
  readonly max: number;
  readonly nodata?: number;
  readonly unit: string;
}
export function rasterDisplay(input: {
  readonly band: string;
  readonly min: string;
  readonly max: string;
  readonly nodata: string;
  readonly unit: string;
}): RasterDisplay | null {
  const decimal = /^-?\d+(?:\.\d+)?$/;
  if (
    ![input.band, input.min, input.max].every(
      (v) => decimal.test(v) && Number.isFinite(Number(v)),
    ) ||
    (input.nodata !== '' &&
      (!decimal.test(input.nodata) ||
        !Number.isFinite(Number(input.nodata)))) ||
    input.unit.length > 80
  )
    return null;
  const band = Number(input.band),
    min = Number(input.min),
    max = Number(input.max);
  if (
    !Number.isInteger(band) ||
    band < 1 ||
    band > 256 ||
    min >= max ||
    [min, max, Number(input.nodata)].some(
      (v) => Math.abs(v) >= 1e21 || (v !== 0 && Math.abs(v) < 1e-6),
    )
  )
    return null;
  return {
    band,
    min,
    max,
    ...(input.nodata === '' ? {} : { nodata: Number(input.nodata) }),
    unit: input.unit.trim(),
  };
}
export function rasterDisplayUrl(
  template: string,
  display: RasterDisplay | null,
) {
  if (!display) return template;
  const [path, search] = template.split('?');
  const params = new URLSearchParams(search);
  params.set('bidx', String(display.band));
  params.set('rescale', `${display.min},${display.max}`);
  params.set('colormap_name', 'viridis');
  params.set('return_mask', 'true');
  params.set('resampling', 'nearest');
  if (display.nodata !== undefined)
    params.set('nodata', String(display.nodata));
  else params.delete('nodata');
  return `${path}?${params}`;
}
