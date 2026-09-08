import { z } from 'zod';
import { calculateExplorationReadiness } from '@wiser/data-core';
import { ExplorationSummarySchema } from '@wiser/data-contracts';
import type { QueryAdapterPgClient } from './query-adapters.js';
import type { AnalysisVersionRef } from './exploration-views.js';

const Count = z.coerce
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const Asset = z.object({
  status: z.enum([
    'READY',
    'EMPTY',
    'PARTIAL',
    'UNSUPPORTED',
    'INVALID',
    'RESTRICTED',
    'MANIFEST',
  ]),
  reason: z.string().nullable(),
  recordCount: Count.nullable(),
  featureCount: Count.nullable(),
});
export async function loadExplorationReadiness(
  client: QueryAdapterPgClient,
  refs: readonly AnalysisVersionRef[],
) {
  const result = await client.query(
    `select ref->>'versionId' version_id, analysis.status,
    coalesce((select jsonb_agg(jsonb_build_object('status',asset.status,'reason',asset.reason,'recordCount',asset.record_count,'featureCount',asset.feature_count)) from service.analysis_asset asset where asset.analysis_id=analysis.analysis_id),'[]'::jsonb) assets,
    case when analysis.analysis_id is null then (select count(*) from knowledge.evidence_fragment where version_id=(ref->>'versionId')::uuid and jsonb_typeof(locator->'record')='object') else 0 end legacy_records,
    case when analysis.analysis_id is null then (select count(*) from catalog.spatial_extent where version_id=(ref->>'versionId')::uuid) else 0 end legacy_features
    from jsonb_array_elements($1::jsonb) ref left join service.analysis_run analysis on analysis.analysis_id=(ref->>'analysisId')::uuid`,
    [JSON.stringify(refs)],
  );
  const map = new Map<
    string,
    ReturnType<typeof calculateExplorationReadiness>
  >();
  for (const row of result.rows)
    map.set(
      z.uuid().parse(row['version_id']),
      calculateExplorationReadiness({
        analyzed: row['status'] !== null,
        partial: row['status'] === 'PARTIAL',
        assets: z.array(Asset).parse(row['assets']),
        legacyRecordCount: Count.parse(row['legacy_records']),
        legacyFeatureCount: Count.parse(row['legacy_features']),
      }),
    );
  return map;
}
export function explorationReadinessSummary(
  refs: readonly AnalysisVersionRef[],
  facts: Awaited<ReturnType<typeof loadExplorationReadiness>>,
) {
  const records = new Map<string, number>(),
    spatial = new Map<string, number>();
  let indexedRecordCount = 0,
    indexedFeatureCount = 0;
  for (const value of facts.values()) {
    records.set(value.records, (records.get(value.records) ?? 0) + 1);
    spatial.set(value.spatial, (spatial.get(value.spatial) ?? 0) + 1);
    indexedRecordCount += value.recordCount ?? 0;
    indexedFeatureCount += value.featureCount ?? 0;
  }
  return ExplorationSummarySchema.parse({
    resourceCount: refs.length,
    analyzedResourceCount: refs.filter((ref) => ref.analysisId).length,
    indexedRecordCount,
    indexedFeatureCount,
    records: [...records].map(([status, count]) => ({ status, count })),
    spatial: [...spatial].map(([status, count]) => ({ status, count })),
  });
}
