import { z } from 'zod';
import {
  ExplorationAnalysisAssetSchema,
  ExplorationRecordSchema,
  type ExplorationQueryInput,
  type QuerySpec,
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
    and ($5::float8[] is null or st_intersects(record.geom,st_makeenvelope(($5::float8[])[1],($5::float8[])[2],($5::float8[])[3],($5::float8[])[4],4326)))
    and ($6::jsonb is null or service.exploration_record_matches(record.record_values,$6))`;

export async function queryAnalysisView(
  client: QueryAdapterPgClient,
  refs: readonly AnalysisVersionRef[],
  queryId: string,
  input: ExplorationQueryInput,
  spec: QuerySpec = {},
) {
  const recordQuery = spec.recordQuery;
  if (
    recordQuery &&
    ((input.assetId && input.assetId !== recordQuery.assetId) ||
      (input.versionId && input.versionId !== spec.versions?.[0]?.versionId))
  )
    throw new DataCapabilityHandlerError('NOT_FOUND');
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
  let recordAssetId: string | undefined;
  if (input.view === 'records' && input.recordId !== undefined) {
    const located = await client.query(
      'select asset_id from catalog.analysis_record where analysis_id=$1::uuid and record_id=$2::uuid',
      [ref?.analysisId ?? null, input.recordId],
    );
    if (located.rows[0] === undefined)
      throw new DataCapabilityHandlerError('NOT_FOUND');
    recordAssetId = z.uuid().parse(located.rows[0]['asset_id']);
    if (input.assetId !== undefined && input.assetId !== recordAssetId)
      throw new DataCapabilityHandlerError('NOT_FOUND');
  }
  const selectedAssetId =
    input.view === 'records'
      ? (recordQuery?.assetId ??
        input.assetId ??
        recordAssetId ??
        assets.find((asset) => (asset.recordCount ?? 0) > 0)?.assetId ??
        assets.find((asset) =>
          ['READY', 'EMPTY', 'PARTIAL'].includes(asset.status),
        )?.assetId ??
        assets.find((asset) => asset.status !== 'MANIFEST')?.assetId)
      : (recordQuery?.assetId ?? input.assetId);
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
    ...(input.recordId === undefined ? {} : { recordId: input.recordId }),
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
    recordQuery ? JSON.stringify(recordQuery.filters) : null,
  ];
  const counted = (
    input.view === 'records'
      ? await client.query(
          'select count(*)::text total from catalog.analysis_record where analysis_id=$1::uuid and asset_id=$2::uuid and ($3::uuid is null or record_id=$3::uuid) and ($4::jsonb is null or service.exploration_record_matches(record_values,$4))',
          [
            ref?.analysisId ?? null,
            selectedAssetId ?? null,
            input.recordId ?? null,
            recordQuery ? JSON.stringify(recordQuery.filters) : null,
          ],
        )
      : await client.query(
          `with coverage as (select count(*)::text total,st_extent(record.geom)::box2d bounds,count(*) filter(where st_intersects(record.geom,st_makeenvelope(-180,-85.0511287798066,180,85.0511287798066,4326)))::text mercator_count ${RECORDS}) select total,mercator_count,case when bounds is null then null else jsonb_build_array(st_xmin(bounds),st_ymin(bounds),st_xmax(bounds),st_ymax(bounds)) end bounds from coverage`,
          params,
        )
  ).rows[0];
  const totalCount = COUNT.parse(counted?.['total']);
  if (input.recordId && totalCount === 0)
    throw new DataCapabilityHandlerError('NOT_FOUND');
  if (offset > totalCount)
    throw new DataCapabilityHandlerError('VALIDATION_FAILED');
  const page =
    input.view === 'records'
      ? await client.query(
          `select record.*,$1::text data_item_id,$2::text version_id,st_asgeojson(record.geom)::jsonb geometry
       from catalog.analysis_record record where record.analysis_id=$3::uuid and record.asset_id=$4::uuid
       and ($5::uuid is null or record.record_id=$5::uuid)
       and ($8::jsonb is null or service.exploration_record_matches(record.record_values,$8->'filters'))
       order by ${recordQuery?.sort ? `(case when $8->'sort'->>'type'='number' then service.exploration_number(record.record_values->($8->'sort'->>'field')) end) ${recordQuery.sort.direction} nulls last, (case when $8->'sort'->>'type'='text' then record.record_values->>($8->'sort'->>'field') end) collate "C" ${recordQuery.sort.direction} nulls last,` : ''} record.record_index limit $6::integer offset $7::integer`,
          [
            ref?.dataItemId ?? null,
            ref?.versionId ?? null,
            ref?.analysisId ?? null,
            selectedAssetId ?? null,
            input.recordId ?? null,
            input.first + 1,
            offset,
            recordQuery ? JSON.stringify(recordQuery) : null,
          ],
        )
      : await client.query(
          `select record.*,ref->>'dataItemId' data_item_id,ref->>'versionId' version_id,st_asgeojson(record.geom)::jsonb geometry ${RECORDS}
      order by ref->>'dataItemId',ref->>'versionId',record.asset_id,record.record_index limit $7::integer offset $8::integer`,
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
      values: recordQuery?.columns
        ? Object.fromEntries(
            Object.entries(
              z.record(z.string(), z.json()).parse(row['record_values']),
            ).filter(([key]) => recordQuery.columns!.includes(key)),
          )
        : row['record_values'],
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
          spatial: {
            bounds: counted?.['bounds'] ?? null,
            mercatorFeatureCount: COUNT.parse(counted?.['mercator_count']),
          },
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
