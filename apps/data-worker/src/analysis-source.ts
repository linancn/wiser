const mediaTypes = {
  doc: ['application/msword'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  csv: ['text/csv', 'application/csv'],
  json: ['application/json', 'application/geo+json'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  xls: ['application/vnd.ms-excel'],
  html: ['text/html'],
  md: ['text/markdown'],
  pdf: ['application/pdf'],
  txt: ['text/plain'],
  zip: ['application/zip'],
  shp: ['application/x-shapefile', 'application/x-esri-shape'],
  adf: [],
  tif: ['image/tiff', 'image/geotiff'],
  tiff: [],
  nc: ['application/x-netcdf', 'application/netcdf'],
} as const;
export type AnalysisFormat = keyof typeof mediaTypes;
interface SourcePath {
  readonly assetId?: string | undefined;
  readonly path: string;
}
function extension(path: string) {
  return path.toLowerCase().split('.').at(-1) ?? '';
}
function stem(path: string) {
  return path.slice(0, path.lastIndexOf('.')).toLowerCase();
}
function directory(path: string) {
  return path.slice(0, path.lastIndexOf('/') + 1).toLowerCase();
}
const shapeCompanions = new Set([
  'dbf',
  'shx',
  'prj',
  'cpg',
  'sbn',
  'sbx',
  'qix',
]);
export function resolveAnalysisSource(
  assetId: string,
  mediaType: string,
  files: readonly SourcePath[],
) {
  const source = files.find((file) => file.assetId === assetId);
  const suffix = source ? extension(source.path) : '';
  const formats = Object.keys(mediaTypes) as AnalysisFormat[];
  let format =
    suffix === 'geojson'
      ? ('json' as const)
      : (formats.find(
          (format) =>
            format === suffix ||
            (mediaTypes[format] as readonly string[]).includes(
              mediaType.split(';')[0]!.trim(),
            ),
        ) ?? null);
  const path = source?.path ?? `${assetId}.${format ?? 'bin'}`;
  let companionOf: string | null = null;
  let companions: { assetId: string; path: string }[] = [];
  if (format === 'shp') {
    companions = files
      .filter(
        (file): file is SourcePath & { assetId: string } =>
          !!file.assetId &&
          stem(file.path) === stem(path) &&
          shapeCompanions.has(extension(file.path)),
      )
      .map((file) => ({ assetId: file.assetId, path: file.path }));
  } else if (shapeCompanions.has(suffix)) {
    companionOf =
      files.find(
        (file) =>
          stem(file.path) === stem(path) && extension(file.path) === 'shp',
      )?.assetId ?? null;
  } else if (format === 'adf') {
    const header = files.find(
      (file) =>
        directory(file.path) === directory(path) &&
        file.path.toLowerCase().endsWith('/hdr.adf'),
    );
    if (header?.assetId && header.assetId !== assetId)
      companionOf = header.assetId;
    else
      companions = files
        .filter(
          (file): file is SourcePath & { assetId: string } =>
            !!file.assetId &&
            file.assetId !== assetId &&
            directory(file.path) === directory(path) &&
            extension(file.path) === 'adf',
        )
        .map((file) => ({ assetId: file.assetId, path: file.path }));
  }
  if (companionOf) format = null;
  return { format, path, companions, companionOf };
}
