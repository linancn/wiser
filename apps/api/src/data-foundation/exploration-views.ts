import { z } from 'zod';
import {
  ExplorationAnalysisAssetSchema,
  ExplorationRecordSchema,
  type ExplorationQueryInput,
} from '@wiser/data-contracts';
import { DataCapabilityHandlerError } from './capability-handler.js';
import type { QueryAdapterPgClient } from './query-adapters.js';

export interface AnalysisVersionRef {
  readonly dataItemId: string;
  readonly versionId: string;
  readonly analysisId?: string | null | undefined;
}
const COUNT = z.coerce
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const RECORDS = `from catalog.analysis_record record join jsonb_array_elements($1::jsonb) ref on record.analysis_id=(ref->>'analysisId')::uuid
  where ($2::uuid is null or ref->>'versionId'=$2::text) and ($3::uuid is null or record.asset_id=$3)
    and (not $4::boolean or record.geom is not null)
    and ($5::float8[] is null or record.geom && st_makeenvelope(($5::float8[])[1],($5::float8[])[2],($5::float8[])[3],($5::float8[])[4],4326))`;

export async function queryAnalysisView(
  client: QueryAdapterPgClient,
  refs: readonly AnalysisVersionRef[],
  queryId: string,
  input: ExplorationQueryInput,
) {
  const ref = refs.find((value) => value.versionId === input.versionId);
  if (input.versionId !== undefined && ref === undefined)
    throw new DataCapabilityHandlerError('NOT_FOUND');
  const serialized = JSON.stringify(refs);
  const assets =
    input.view !== 'records' || !ref?.analysisId
      ? []
      : (
          await client.query(
            `
    select asset_id,encode(source_hash,'hex') source_hash,status,record_count,feature_count,reason,columns,source_paths
    from service.analysis_asset where analysis_id=$1::uuid order by asset_id`,
            [ref.analysisId],
          )
        ).rows.map((row) =>
          ExplorationAnalysisAssetSchema.parse({
            assetId: row['asset_id'],
            sourceHash: row['source_hash'],
            status: row['status'],
            recordCount:
              row['record_count'] === null
                ? null
                : COUNT.parse(row['record_count']),
            featureCount:
              row['feature_count'] === null
                ? null
                : COUNT.parse(row['feature_count']),
            reason: row['reason'],
            columns: row['columns'],
            paths: z
              .array(z.object({ path: z.string() }))
              .parse(row['source_paths'])
              .map((path) => path.path),
          }),
        );
  const selectedAssetId =
    input.view === 'records'
      ? (input.assetId ??
        assets.find((asset) =>
          ['READY', 'EMPTY', 'PARTIAL'].includes(asset.status),
        )?.assetId ??
        assets.find((asset) => asset.status !== 'MANIFEST')?.assetId)
      : input.assetId;
  if (
    input.view === 'records' &&
    selectedAssetId !== undefined &&
    !assets.some((asset) => asset.assetId === selectedAssetId)
  )
    throw new DataCapabilityHandlerError('NOT_FOUND');
  const binding = JSON.stringify({
    queryId,
    view: input.view,
    versionId: input.versionId ?? null,
    assetId: selectedAssetId ?? null,
    bbox: input.bbox ?? null,
  });
  let offset = 0;
  if (input.after !== undefined) {
    try {
      const cursor = z
        .strictObject({
          binding: z.literal(binding),
          offset: z.number().int().min(1).max(10000000),
        })
        .parse(
          JSON.parse(Buffer.from(input.after, 'base64url').toString('utf8')),
        );
      offset = cursor.offset;
    } catch {
      throw new DataCapabilityHandlerError('VALIDATION_FAILED');
    }
  }
  const params = [
    serialized,
    input.versionId ?? null,
    selectedAssetId ?? null,
    input.view === 'map',
    input.bbox ?? null,
  ];
  const totalCount = COUNT.parse(
    (await client.query(`select count(*)::text total ${RECORDS}`, params))
      .rows[0]?.['total'],
  );
  if (offset > totalCount)
    throw new DataCapabilityHandlerError('VALIDATION_FAILED');
  const page =
    input.view === 'records'
      ? await client.query(
          `select record.*,$1::text data_item_id,$2::text version_id,st_asgeojson(record.geom)::jsonb geometry
       from catalog.analysis_record record where record.analysis_id=$3::uuid and record.asset_id=$4::uuid
       order by record.record_index limit $5::integer offset $6::integer`,
          [
            ref?.dataItemId ?? null,
            ref?.versionId ?? null,
            ref?.analysisId ?? null,
            selectedAssetId ?? null,
            input.first + 1,
            offset,
          ],
        )
      : await client.query(
          `select record.*,ref->>'dataItemId' data_item_id,ref->>'versionId' version_id,st_asgeojson(record.geom)::jsonb geometry ${RECORDS}
      order by ref->>'dataItemId',ref->>'versionId',record.asset_id,record.record_index limit $6::integer offset $7::integer`,
          [...params, input.first + 1, offset],
        );
  const records = page.rows.slice(0, input.first).map((row) =>
    ExplorationRecordSchema.parse({
      recordId: row['record_id'],
      featureId: row['geometry'] === null ? null : row['record_id'],
      dataItemId: row['data_item_id'],
      versionId: row['version_id'],
      analysisId: row['analysis_id'],
      assetId: row['asset_id'],
      sourceId: row['source_id'],
      index: COUNT.parse(row['record_index']),
      values: row['record_values'],
    }),
  );
  const totals = (
    await client.query(
      `select coalesce(sum(record_count),0)::text records,coalesce(sum(feature_count),0)::text features from service.analysis_asset asset join jsonb_array_elements($1::jsonb) ref on asset.analysis_id=(ref->>'analysisId')::uuid`,
      [serialized],
    )
  ).rows[0];
  return {
    view: input.view,
    resources: [],
    totalCount,
    coverage: {
      resourceCount: refs.length,
      analyzedResourceCount: refs.filter((value) => value.analysisId).length,
      indexedRecordCount: COUNT.parse(totals?.['records']),
      indexedFeatureCount: COUNT.parse(totals?.['features']),
    },
    ...(input.view === 'records'
      ? {
          records,
          assets,
          ...(selectedAssetId === undefined ? {} : { selectedAssetId }),
        }
      : {
          features: records.map((record, index) => ({
            type: 'Feature' as const,
            id: record.recordId,
            properties: record,
            geometry: page.rows[index]?.['geometry'],
          })),
        }),
    ...(page.rows.length > input.first
      ? {
          nextCursor: Buffer.from(
            JSON.stringify({ binding, offset: offset + input.first }),
          ).toString('base64url'),
        }
      : {}),
  };
}
