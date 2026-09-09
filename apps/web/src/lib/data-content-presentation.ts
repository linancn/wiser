import type {
  ExplorationAnalysisAsset,
  ExplorationRecord,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from './i18n';
export type ContentView =
  'table' | 'document' | 'structured' | 'raster' | 'map' | 'graph' | 'original';
export function contentFieldLabel(
  key: string,
  label: string,
  locale: Locale,
): string {
  const labels: Readonly<Record<string, string>> =
    getDictionary(locale).dataFoundation.content.fields;
  return labels[label.toLowerCase()] ?? labels[key.toLowerCase()] ?? label;
}
export function sourceFilename(
  asset: ExplorationAnalysisAsset | undefined,
  fallback: string,
): string {
  return asset?.paths[0]?.split(/[\\/]/).at(-1) || fallback;
}
export function assetContentHref(
  versionId: string,
  assetId: string,
  filename: string,
  locale: Locale,
  mode: 'preview' | 'download' = 'download',
) {
  return `/api/data-foundation/assets/${versionId}/${assetId}?${new URLSearchParams({ mode, filename, locale })}`;
}
export function preferredContentView(
  asset: ExplorationAnalysisAsset | undefined,
  records: readonly ExplorationRecord[],
): ContentView {
  if (
    records.some((record) =>
      ['RASTER_BAND', 'NETCDF_VARIABLE'].includes(
        typeof record.values['__kind'] === 'string'
          ? record.values['__kind']
          : '',
      ),
    )
  )
    return 'raster';
  if ((asset?.featureCount ?? 0) > 0) return 'map';
  const path = asset?.paths[0] ?? '';
  if (/\.(?:pdf|docx?|html?|txt|md)$/i.test(path)) return 'document';
  if (/\.json$/i.test(path) && asset?.recordCount === 1) return 'structured';
  return 'table';
}
