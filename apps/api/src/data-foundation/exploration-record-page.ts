import type { QueryAdapterPgClient } from './query-adapters.js';

export const RECORD_PAGE_BYTES = 3 * 1024 * 1024;
export function recordValueExpression(columns: string) {
  return `(case when ${columns} is null then r.record_values else coalesce((select jsonb_object_agg(field,r.record_values->field) from unnest(${columns}) field where r.record_values ? field),'{}'::jsonb) end)`;
}
export function recordSelect(values: string) {
  return `r.record_id,r.asset_id,r.analysis_id,r.source_id,r.record_index,${values} record_values,case when r.geom is null then null else '{}'::jsonb end geometry`;
}
export function recordBytes(values: string) {
  // JSONB text includes spaces absent from compact JSON, so this is conservative.
  return `octet_length((${values})::text)+coalesce(octet_length(to_jsonb(r.source_id)::text),4)+1024`;
}
export async function queryRecordPage(
  client: QueryAdapterPgClient,
  input: {
    readonly analysisId: string | null;
    readonly assetId: string | null;
    readonly recordId?: string;
    readonly first: number;
    readonly offset: number;
    readonly maximumBytes: number;
  },
) {
  return client.query(
    `with candidates as materialized (
    select record_id,record_index from catalog.analysis_record
    where analysis_id=$1::uuid and asset_id=$2::uuid and ($3::uuid is null or record_id=$3::uuid)
    order by record_index limit $4::integer offset $5::integer
  ), measured as (
    select candidates.*,sum(${recordBytes('r.record_values')}) over(order by candidates.record_index rows unbounded preceding) bytes
    from candidates join catalog.analysis_record r on r.analysis_id=$1::uuid and r.record_id=candidates.record_id
  ) select ${recordSelect('r.record_values')}
  from measured join catalog.analysis_record r on r.analysis_id=$1::uuid and r.record_id=measured.record_id
  where measured.bytes<=$6::integer order by measured.record_index`,
    [
      input.analysisId,
      input.assetId,
      input.recordId ?? null,
      input.first,
      input.offset,
      input.maximumBytes,
    ],
  );
}
