import type { QuerySpec } from '@wiser/data-contracts';
import { z } from 'zod';
import type { AnalysisVersionRef } from './exploration-views.js';
import type { QueryAdapterPgClient } from './query-adapters.js';
/** Geometry names and placeholder syntax are internal constants; coordinates are bound values. */
export function spatialPredicate(geometry: string, parameter: string) {
  const bounds = `st_makeenvelope((${parameter})[1],(${parameter})[2],(${parameter})[3],(${parameter})[4],4326)`;
  return `(${geometry} && ${bounds} and st_intersects(${geometry},${bounds}))`;
}
export async function spatialMembers(
  client: QueryAdapterPgClient,
  refs: readonly AnalysisVersionRef[],
  spec: QuerySpec,
) {
  if (!spec.spatialBounds) return refs;
  const result = await client.query(
    `select ordinality from jsonb_array_elements($1::jsonb) with ordinality ref where exists(select 1 from catalog.analysis_record r where r.analysis_id=(ref.value->>'analysisId')::uuid and ${spatialPredicate('r.geom', '$2::float8[]')} and ($3::jsonb is null or (r.asset_id=($3->>'assetId')::uuid and service.exploration_record_matches(r.record_values,$3->'filters')))) order by ordinality`,
    [
      JSON.stringify(refs),
      spec.spatialBounds,
      spec.recordQuery ? JSON.stringify(spec.recordQuery) : null,
    ],
  );
  return result.rows.map(
    (row) =>
      refs[
        z.coerce
          .number()
          .int()
          .min(1)
          .max(refs.length)
          .parse(row['ordinality']) - 1
      ]!,
  );
}
