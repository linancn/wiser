import type {
  ExplorationAnalysisAsset,
  ExplorationReadiness,
} from '@wiser/data-contracts';

type Asset = Pick<
  ExplorationAnalysisAsset,
  'status' | 'reason' | 'recordCount' | 'featureCount'
>;
export interface ExplorationReadinessFacts {
  readonly analyzed: boolean;
  readonly partial: boolean;
  readonly assets: readonly Asset[];
  readonly legacyRecordCount: number;
  readonly legacyFeatureCount: number;
}
export function calculateExplorationReadiness(
  facts: ExplorationReadinessFacts,
): {
  records: ExplorationReadiness;
  spatial: ExplorationReadiness;
  recordCount: number | null;
  featureCount: number | null;
} {
  if (!facts.analyzed)
    return {
      records: facts.legacyRecordCount > 0 ? 'READY' : 'NOT_PARSED',
      spatial: facts.legacyFeatureCount > 0 ? 'READY' : 'NOT_PARSED',
      recordCount: facts.legacyRecordCount || null,
      featureCount: facts.legacyFeatureCount || null,
    };
  const assets = facts.assets.filter(
    (asset) =>
      asset.status !== 'MANIFEST' && asset.reason !== 'FORMAT_COMPANION',
  );
  if (assets.length === 0)
    return {
      records: 'METADATA_ONLY',
      spatial: 'METADATA_ONLY',
      recordCount: null,
      featureCount: null,
    };
  const parsed = assets.filter((asset) => asset.recordCount !== null);
  const recordCount = parsed.length
    ? parsed.reduce((sum, asset) => sum + (asset.recordCount ?? 0), 0)
    : null;
  const featureCount = parsed.length
    ? parsed.reduce((sum, asset) => sum + (asset.featureCount ?? 0), 0)
    : null;
  const unavailable: ExplorationReadiness = assets.every(
    (asset) => asset.status === 'INVALID',
  )
    ? 'INVALID'
    : assets.every((asset) => asset.status === 'RESTRICTED')
      ? 'RESTRICTED'
      : 'UNSUPPORTED';
  const records: ExplorationReadiness =
    recordCount === null
      ? unavailable
      : facts.partial
        ? 'PARTIAL'
        : recordCount === 0
          ? 'EMPTY'
          : 'READY';
  const spatial: ExplorationReadiness =
    (featureCount ?? 0) > 0
      ? facts.partial
        ? 'PARTIAL'
        : 'READY'
      : assets.some((asset) =>
            ['UNKNOWN_CRS', 'TRANSFORM_UNAVAILABLE'].includes(
              asset.reason ?? '',
            ),
          )
        ? 'CRS_UNVERIFIED'
        : recordCount === null
          ? unavailable
          : 'NO_SPATIAL_DATA';
  return { records, spatial, recordCount, featureCount };
}
