import { z } from 'zod';
import {
  ExplorationGraphSchema,
  ExplorationRecordSchema,
  type ExplorationGraphNode,
  type ExplorationQueryInput,
  type QuerySpec,
} from '@wiser/data-contracts';
import { DataCapabilityHandlerError } from './capability-handler.js';
import type { AnalysisVersionRef } from './exploration-views.js';
import type { QueryAdapterPgClient } from './query-adapters.js';

/** Authoritative containment/provenance, not inferred scientific relationships. */
export async function queryProvenanceGraph(
  client: QueryAdapterPgClient,
  refs: readonly AnalysisVersionRef[],
  queryId: string,
  input: ExplorationQueryInput,
  spec: QuerySpec = {},
) {
  if (
    spec.recordQuery &&
    input.assetId &&
    input.assetId !== spec.recordQuery.assetId
  )
    throw new DataCapabilityHandlerError('NOT_FOUND');
  const selected =
    input.versionId === undefined
      ? refs
      : refs.filter((ref) => ref.versionId === input.versionId);
  if (input.versionId !== undefined && selected.length === 0)
    throw new DataCapabilityHandlerError('NOT_FOUND');
  const binding = JSON.stringify({
    queryId,
    view: 'graph',
    versionId: input.versionId ?? null,
    recordId: input.recordId ?? null,
    assetId: input.assetId ?? null,
  });
  let offset = 0;
  if (input.after !== undefined) {
    try {
      offset = z
        .strictObject({
          binding: z.literal(binding),
          offset: z.number().int().min(1).max(10000),
        })
        .parse(
          JSON.parse(Buffer.from(input.after, 'base64url').toString('utf8')),
        ).offset;
    } catch {
      throw new DataCapabilityHandlerError('VALIDATION_FAILED');
    }
  }
  if (offset > selected.length)
    throw new DataCapabilityHandlerError('VALIDATION_FAILED');
  const page = selected.slice(offset, offset + Math.min(input.first, 100));
  const serialized = JSON.stringify(page);
  const nodes: ExplorationGraphNode[] = [];
  const edges: {
    id: string;
    source: string;
    target: string;
    relation: string;
  }[] = [];
  const connect = (source: string, target: string, relation: string) =>
    edges.push({
      id: `${source}:${relation}:${target}`,
      source,
      target,
      relation,
    });
  const resources = await client.query(
    `select item.data_item_id,item.name,version.version_id,version.version_number,encode(version.source_hash,'hex') source_hash from jsonb_array_elements($1::jsonb) ref join catalog.data_item_version version on version.version_id=(ref->>'versionId')::uuid and version.data_item_id=(ref->>'dataItemId')::uuid join catalog.data_item item on item.data_item_id=version.data_item_id order by item.name collate "C",version.version_id`,
    [serialized],
  );
  for (const row of resources.rows) {
    const dataItemId = z.uuid().parse(row['data_item_id']),
      versionId = z.uuid().parse(row['version_id']);
    const resourceId = `resource:${dataItemId}:${versionId}`,
      versionNodeId = `version:${versionId}`;
    nodes.push({
      id: resourceId,
      kind: 'RESOURCE',
      label: z.string().parse(row['name']),
      dataItemId,
      versionId,
    });
    nodes.push({
      id: versionNodeId,
      kind: 'VERSION',
      label: `v${z.coerce.number().int().parse(row['version_number'])}`,
      dataItemId,
      versionId,
      sourceHash: z.string().parse(row['source_hash']),
    });
    connect(resourceId, versionNodeId, 'HAS_VERSION');
  }
  let focusedRecord: z.infer<typeof ExplorationRecordSchema> | undefined;
  if (input.recordId !== undefined) {
    const row = (
      await client.query(
        `select record.*,ref->>'dataItemId' data_item_id,ref->>'versionId' version_id,record.geom is not null spatial from catalog.analysis_record record join jsonb_array_elements($1::jsonb) ref on record.analysis_id=(ref->>'analysisId')::uuid where record.record_id=$2::uuid and ($3::jsonb is null or (record.asset_id=($3->>'assetId')::uuid and service.exploration_record_matches(record.record_values,$3->'filters')))`,
        [
          serialized,
          input.recordId,
          spec.recordQuery ? JSON.stringify(spec.recordQuery) : null,
        ],
      )
    ).rows[0];
    if (row === undefined) throw new DataCapabilityHandlerError('NOT_FOUND');
    focusedRecord = ExplorationRecordSchema.parse({
      recordId: row['record_id'],
      featureId: row['spatial'] === true ? row['record_id'] : null,
      dataItemId: row['data_item_id'],
      versionId: row['version_id'],
      analysisId: row['analysis_id'],
      assetId: row['asset_id'],
      sourceId: row['source_id'],
      index: z.coerce.number().parse(row['record_index']),
      values: spec.recordQuery?.columns
        ? Object.fromEntries(
            Object.entries(
              z.record(z.string(), z.json()).parse(row['record_values']),
            ).filter(([key]) => spec.recordQuery!.columns!.includes(key)),
          )
        : row['record_values'],
    });
  }
  const assetId =
    spec.recordQuery?.assetId ?? focusedRecord?.assetId ?? input.assetId;
  const assets = await client.query(
    `select asset.asset_id,asset.version_id,ref->>'dataItemId' data_item_id,asset.media_type,encode(asset.content_hash,'hex') source_hash,analysis.source_paths from catalog.asset asset join jsonb_array_elements($1::jsonb) ref on asset.version_id=(ref->>'versionId')::uuid left join service.analysis_asset analysis on analysis.analysis_id=(ref->>'analysisId')::uuid and analysis.asset_id=asset.asset_id where ($2::uuid is null or asset.asset_id=$2) order by asset.version_id,asset.asset_id limit 201`,
    [serialized, assetId ?? null],
  );
  if (assetId !== undefined && assets.rows.length === 0)
    throw new DataCapabilityHandlerError('NOT_FOUND');
  for (const row of assets.rows.slice(0, 200)) {
    const versionId = z.uuid().parse(row['version_id']),
      id = z.uuid().parse(row['asset_id']);
    const paths = z
      .array(z.object({ path: z.string() }))
      .parse(row['source_paths'] ?? []);
    const nodeId = `asset:${versionId}:${id}`;
    nodes.push({
      id: nodeId,
      kind: 'ASSET',
      label: paths[0]?.path ?? z.string().parse(row['media_type']),
      dataItemId: z.uuid().parse(row['data_item_id']),
      versionId,
      assetId: id,
      sourceHash: z.string().parse(row['source_hash']),
    });
    connect(`version:${versionId}`, nodeId, 'HAS_ASSET');
  }
  const evidence = await client.query(
    `select evidence.evidence_fragment_id evidence_id,evidence.version_id,ref->>'dataItemId' data_item_id from knowledge.evidence_fragment evidence join jsonb_array_elements($1::jsonb) ref on evidence.version_id=(ref->>'versionId')::uuid order by evidence.version_id,evidence.evidence_fragment_id limit 101`,
    [serialized],
  );
  for (const row of evidence.rows.slice(0, 100)) {
    const evidenceId = z.uuid().parse(row['evidence_id']),
      versionId = z.uuid().parse(row['version_id']);
    const id = `evidence:${versionId}:${evidenceId}`;
    nodes.push({
      id,
      kind: 'EVIDENCE',
      label: evidenceId,
      dataItemId: z.uuid().parse(row['data_item_id']),
      versionId,
      evidenceId,
    });
    connect(`version:${versionId}`, id, 'HAS_EVIDENCE');
  }
  if (focusedRecord !== undefined) {
    const id = `record:${focusedRecord.analysisId}:${focusedRecord.recordId}`;
    nodes.push({
      id,
      kind: 'RECORD',
      label: focusedRecord.sourceId ?? String(focusedRecord.index),
      dataItemId: focusedRecord.dataItemId,
      versionId: focusedRecord.versionId,
      assetId: focusedRecord.assetId,
      record: focusedRecord,
    });
    connect(
      `asset:${focusedRecord.versionId}:${focusedRecord.assetId}`,
      id,
      'HAS_RECORD',
    );
  }
  const more = offset + page.length < selected.length;
  return {
    view: 'graph' as const,
    resources: [],
    totalCount: selected.length,
    graph: ExplorationGraphSchema.parse({
      nodes,
      edges,
      truncated: more || assets.rows.length > 200 || evidence.rows.length > 100,
    }),
    ...(more
      ? {
          nextCursor: Buffer.from(
            JSON.stringify({ binding, offset: offset + page.length }),
          ).toString('base64url'),
        }
      : {}),
  };
}
