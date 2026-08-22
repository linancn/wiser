import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { Readable } from 'node:stream';

import {
  IngestionPipelinePortError,
  canonicalPipelineHash,
  type FrozenIngestionCheckpoint,
  type HashOnlyPipelineEvidence,
  type IngestionAssetCheckpoint,
  type IngestionAuthorityPort,
  type IngestionTransitionRequest,
  type PipelineIngestionState,
  type PipelineSecurityLevel,
} from '../handlers/ingestion-pipeline.js';

export interface IngestionRuntimeQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount?: number | null;
}

export interface IngestionRuntimeClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<IngestionRuntimeQueryResult>;
  release(): void;
}

export interface IngestionRuntimePool {
  connect(): Promise<IngestionRuntimeClient>;
}

const SET_SCOPE_SQL = `
select set_config('wiser.tenant_id', $1, true),
  set_config('wiser.project_id', $2, true),
  set_config('wiser.max_security_level', $3, true),
  set_config('wiser.policy_version', $4, true)
`;

const LOAD_SQL = `
/* ingestion.runtime.load */
select session.state, session.row_version, session.requested_security_level,
  session.security_level, session.policy_version, session.operation_id,
  session.expected_version,
  version.version_id, frozen.plan as frozen_checkpoint,
  asset.asset_id, input.ordinal, asset.storage_key, asset.media_type,
  asset.byte_size, blob.content_blob_id,
  encode(blob.content_hash, 'hex') as source_hash
from ingestion.session as session
join ingestion.input_asset as input
  on input.tenant_id = session.tenant_id
 and input.project_id = session.project_id
 and input.ingestion_id = session.ingestion_id
join catalog.asset as asset
  on asset.tenant_id = input.tenant_id
 and asset.project_id = input.project_id
 and asset.asset_id = input.asset_id
left join catalog.content_blob as blob
  on blob.tenant_id = asset.tenant_id
 and blob.project_id = asset.project_id
 and blob.content_blob_id = asset.content_blob_id
left join lateral (
  select committed.version_id
  from catalog.data_item_version as committed
  where committed.tenant_id = session.tenant_id
    and committed.project_id = session.project_id
    and committed.data_item_id = session.ingestion_id
    and security.security_rank(committed.security_level) <= security.security_rank($4)
    and committed.policy_version <= $5::bigint
    and security.authorized_row(committed.tenant_id, committed.project_id,
      committed.security_level, committed.policy_version)
  order by committed.version_number desc limit 1
) as version on true
left join lateral (
  select plan from ingestion.transform_plan
  where tenant_id = session.tenant_id and project_id = session.project_id
    and ingestion_id = session.ingestion_id
    and status in ('REVIEW_REQUIRED', 'APPROVED')
    and security.security_rank(security_level) <= security.security_rank($4)
    and policy_version <= $5::bigint
    and security.authorized_row(tenant_id, project_id, security_level, policy_version)
  order by plan_version desc limit 1
) as frozen on true
where session.tenant_id = $1::uuid
  and session.project_id = $2::uuid
  and session.ingestion_id = $3::uuid
  and session.security_level = $4
  and session.policy_version = $5::bigint
  and security.security_rank(input.security_level) <= security.security_rank($4)
  and input.policy_version <= $5::bigint
  and security.authorized_row(input.tenant_id, input.project_id,
    input.security_level, input.policy_version)
  and security.security_rank(asset.security_level) <= security.security_rank($4)
  and asset.policy_version <= $5::bigint
  and security.authorized_row(asset.tenant_id, asset.project_id,
    asset.security_level, asset.policy_version)
  and (
    blob.content_blob_id is null
    or (
      security.security_rank(blob.security_level) <= security.security_rank($4)
      and blob.policy_version <= $5::bigint
      and security.authorized_row(blob.tenant_id, blob.project_id,
        blob.security_level, blob.policy_version)
    )
  )
order by input.ordinal, asset.asset_id
`;

const LOCK_SQL = `
/* ingestion.runtime.lock */
select state, row_version, requested_security_level, security_level,
  policy_version, operation_id, intended_uses, expected_version
from ingestion.session
where tenant_id = $1::uuid and project_id = $2::uuid
  and ingestion_id = $3::uuid
  and security_level = $4 and policy_version = $5::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
for update
`;

const TRANSITION_SQL = `
/* ingestion.runtime.transition */
update ingestion.session
set state = $2, row_version = row_version + 1, updated_at = clock_timestamp()
where ingestion_id = $1::uuid and tenant_id = $3::uuid and project_id = $4::uuid
  and state = $5 and row_version = $6::bigint
  and security_level = $7 and policy_version = $8::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning state, row_version
`;

const FINGERPRINT_ASSETS_LOCK_SQL = `
/* ingestion.runtime.fingerprint-assets-lock */
select asset.asset_id, input.ordinal, asset.storage_key, asset.media_type,
  asset.byte_size, asset.content_blob_id,
  encode(input.fingerprint, 'hex') as input_fingerprint,
  encode(blob.content_hash, 'hex') as trusted_hash
from ingestion.input_asset as input
join catalog.asset as asset
  on asset.tenant_id = input.tenant_id
 and asset.project_id = input.project_id
 and asset.asset_id = input.asset_id
left join catalog.content_blob as blob
  on blob.tenant_id = asset.tenant_id
 and blob.project_id = asset.project_id
 and blob.content_blob_id = asset.content_blob_id
where input.tenant_id = $1::uuid and input.project_id = $2::uuid
  and input.ingestion_id = $3::uuid
  and security.security_rank(input.security_level) <= security.security_rank($4)
  and input.policy_version <= $5::bigint
  and security.authorized_row(input.tenant_id, input.project_id,
    input.security_level, input.policy_version)
  and security.security_rank(asset.security_level) <= security.security_rank($4)
  and asset.policy_version <= $5::bigint
  and security.authorized_row(asset.tenant_id, asset.project_id,
    asset.security_level, asset.policy_version)
order by input.ordinal, asset.asset_id
for update of input, asset
`;

const CONTENT_BLOB_UPSERT_SQL = `
/* ingestion.runtime.content-blob-upsert */
insert into catalog.content_blob (
  content_blob_id, tenant_id, project_id, content_hash, byte_size,
  raw_storage_key, lifecycle_state, security_level, policy_version, row_version
) values ($1::uuid, $2::uuid, $3::uuid, decode($4, 'hex'), $5::bigint,
  null, 'FINGERPRINTED', $6, $7::bigint, 1)
on conflict (tenant_id, project_id, content_hash) do nothing
returning content_blob_id, encode(content_hash, 'hex') as trusted_hash,
  byte_size, security_level, policy_version, lifecycle_state, raw_storage_key
`;

const CONTENT_BLOB_LOCK_SQL = `
/* ingestion.runtime.content-blob-lock */
select content_blob_id, encode(content_hash, 'hex') as trusted_hash,
  byte_size, security_level, policy_version, lifecycle_state, raw_storage_key
from catalog.content_blob
where tenant_id = $1::uuid and project_id = $2::uuid
  and content_hash = decode($3, 'hex')
  and security.security_rank(security_level) <= security.security_rank($4)
  and policy_version <= $5::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
for update
`;

const CONTENT_BLOB_RAISE_SECURITY_SQL = `
/* ingestion.runtime.content-blob-raise-security */
update catalog.content_blob
set security_level = $4, policy_version = $5::bigint,
  row_version = row_version + 1, updated_at = clock_timestamp()
where tenant_id = $1::uuid and project_id = $2::uuid
  and content_blob_id = $3::uuid
  and (
    security.security_rank(security_level) < security.security_rank($4)
    or policy_version < $5::bigint
  )
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning content_blob_id
`;

const ASSET_CONTENT_BIND_SQL = `
/* ingestion.runtime.asset-content-bind */
update catalog.asset
set content_hash = decode($5, 'hex'), content_blob_id = $6::uuid,
  lifecycle_state = 'FINGERPRINTED', row_version = row_version + 1,
  updated_at = clock_timestamp()
where asset_id = $1::uuid and tenant_id = $2::uuid and project_id = $3::uuid
  and byte_size = $4::bigint and version_id is null
  and content_blob_id is null
  and (content_hash is null or content_hash = decode($5, 'hex'))
  and security.security_rank(security_level) <= security.security_rank($7)
  and policy_version <= $8::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning asset_id
`;

const INPUT_FINGERPRINT_SQL = `
/* ingestion.runtime.input-fingerprint */
update ingestion.input_asset
set fingerprint = decode($5, 'hex'), scan_status = 'CLEAN',
  row_version = row_version + 1, updated_at = clock_timestamp()
where asset_id = $1::uuid and tenant_id = $2::uuid and project_id = $3::uuid
  and ingestion_id = $4::uuid
  and (fingerprint is null or fingerprint = decode($5, 'hex'))
  and security.security_rank(security_level) <= security.security_rank($6)
  and policy_version <= $7::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning asset_id
`;

const REVIEW_CHECKPOINT_SQL = `
/* ingestion.runtime.review-checkpoint */
insert into ingestion.transform_plan (
  transform_plan_id, tenant_id, project_id, ingestion_id, plan_version,
  plan, plan_hash, status, security_level, policy_version, row_version
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint,
  $6::jsonb, decode($7, 'hex'), $8, $9, $10::bigint, 1
) on conflict (tenant_id, project_id, ingestion_id, plan_version)
do update set status = excluded.status
where ingestion.transform_plan.plan_hash = excluded.plan_hash
returning transform_plan_id
`;

const FREEZE_SESSION_SQL = `
/* ingestion.runtime.review-session */
update ingestion.session set state = $2,
  row_version = row_version + 1, updated_at = clock_timestamp()
where ingestion_id = $1::uuid and tenant_id = $3::uuid and project_id = $4::uuid
  and state = $5 and row_version = $6::bigint
  and security_level = $7 and policy_version = $8::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning state, row_version
`;

const QUALITY_CHECK_RUN_SQL = `
/* ingestion.runtime.quality-check-run */
insert into quality.check_run (
  check_run_id, tenant_id, project_id, ingestion_id, version_id, status,
  deterministic, completed_at, security_level, policy_version, row_version
) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, null, 'SUCCEEDED', true,
  clock_timestamp(), $5, $6::bigint, 1)
on conflict (tenant_id, project_id, check_run_id) do nothing
`;

const QUALITY_SCORECARD_SQL = `
/* ingestion.runtime.quality-scorecard */
insert into quality.scorecard (
  scorecard_id, tenant_id, project_id, check_run_id, score, quality_grade,
  acceptance_status, blocking_rule_ids, failed_rule_ids, security_level,
  policy_version, row_version
) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::numeric, $6,
  'PASSED', '{}', '{}', $7, $8::bigint, 1)
on conflict (tenant_id, project_id, check_run_id) do nothing
`;

const LINEAGE_PROCESS_SQL = `
/* ingestion.runtime.lineage-process */
insert into lineage.process_run (
  process_run_id, tenant_id, project_id, ingestion_id, operation_id,
  process_type, implementation_version, input_manifest, output_manifest,
  status, security_level, policy_version, row_version
) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
  'INGESTION_PIPELINE', 'wiser-ingestion-pipeline-1', $6::jsonb, $7::jsonb,
  'SUCCEEDED', $8, $9::bigint, 1)
on conflict (tenant_id, project_id, process_run_id) do nothing
`;

const AUDIT_SQL = `
/* ingestion.runtime.audit */
insert into security.audit_event (
  tenant_id, project_id, actor_id, action, resource_type, resource_id,
  decision, context, security_level, policy_version, row_version
) values (
  $1::uuid, $2::uuid, $3::uuid, $4, 'ingestion', $5, $6,
  jsonb_build_object('step', $7::text, 'inputHash', $8::text,
    'outputHash', $9::text),
  $10, $11::bigint, 1
)
`;

const AGENT_RUN_SQL = `
/* ingestion.runtime.agent-run */
insert into ingestion.agent_run (
  agent_run_id, tenant_id, project_id, ingestion_id, agent_kind, provider,
  model, deterministic, input_hash, output_hash, status, security_level,
  policy_version, row_version
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'SCHEMA_SEMANTIC_MAPPING',
  'wiser-fixture', 'fixture-ingestion-planner-1.0.0', true,
  decode($5, 'hex'), decode($6, 'hex'), 'SUCCEEDED', $7, $8::bigint, 1
) on conflict (tenant_id, project_id, agent_run_id) do nothing
`;

const AGENT_ACTION_SQL = `
/* ingestion.runtime.agent-action */
insert into ingestion.agent_action (
  agent_action_id, tenant_id, project_id, agent_run_id, action_type,
  request_payload, response_payload, requires_approval, security_level,
  policy_version, row_version
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
  jsonb_build_object('inputHash', $6::text),
  jsonb_build_object('outputHash', $7::text),
  true, $8, $9::bigint, 1
) on conflict (tenant_id, project_id, agent_action_id) do nothing
`;

const TRANSFORM_PLAN_SQL = `
/* ingestion.runtime.transform-plan */
insert into ingestion.transform_plan (
  transform_plan_id, tenant_id, project_id, ingestion_id, plan_version,
  plan, plan_hash, status, security_level, policy_version, row_version
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint,
  jsonb_build_object('inputHash', $6::text, 'outputHash', $7::text),
  decode($7, 'hex'),
  'DRAFT', $8, $9::bigint, 1
) on conflict (tenant_id, project_id, ingestion_id, plan_version) do nothing
`;

const DATA_ITEM_SQL = `
/* ingestion.runtime.commit-data-item */
insert into catalog.data_item (
  data_item_id, tenant_id, project_id, owner_project_id, name,
  business_domains, source_natures, source_channels, processing_stage,
  intended_uses, source_organization, authorization_scope,
  citation_requirements, unit_definitions, missing_value_rules, anomaly_rules,
  generation_method, quality_grade, acceptance_status, publication_status,
  security_level, version, update_mode, policy_version, row_version
) values (
  $1::uuid, $2::uuid, $3::uuid, $3::uuid, $4,
  array['unclassified'], array['uploaded'], array['ingestion'], 'RAW',
  $5::text[], 'WISER ingestion', 'data.catalog.read', '{}', '[]', '[]', '[]',
  'OBSERVED', $6, 'PASSED', 'UNPUBLISHED', $7, 1, 'SNAPSHOT', $8::bigint, 1
) on conflict (data_item_id) do nothing
`;

const VERSION_SQL = `
/* ingestion.runtime.commit-version */
insert into catalog.data_item_version (
  version_id, tenant_id, project_id, data_item_id, version_number,
  asset_manifest, source_hash, metadata_hash, processing_stage,
  generation_method, quality_grade, acceptance_status, publication_status,
  security_level, policy_version, row_version, committed_at
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1, $5::jsonb,
  decode($6, 'hex'), decode($7, 'hex'), 'RAW', 'OBSERVED', $8,
  'PASSED', 'UNPUBLISHED', $9, $10::bigint, 1, clock_timestamp()
) on conflict (tenant_id, project_id, version_id) do nothing
returning version_id
`;

const ASSET_COMMIT_SQL = `
/* ingestion.runtime.commit-assets */
update catalog.asset as asset
set version_id = $6::uuid, lifecycle_state = 'RAW',
  storage_key = committed.version_key, row_version = asset.row_version + 1,
  updated_at = clock_timestamp()
from ingestion.input_asset as input
join unnest($4::uuid[], $5::text[]) as committed(asset_id, version_key)
  on committed.asset_id = input.asset_id
where asset.tenant_id = $1::uuid and asset.project_id = $2::uuid
  and input.tenant_id = asset.tenant_id and input.project_id = asset.project_id
  and input.asset_id = asset.asset_id and input.ingestion_id = $3::uuid
  and asset.version_id is null and asset.content_hash is not null
  and asset.content_blob_id is not null
  and security.security_rank(asset.security_level) <= security.security_rank($7)
  and asset.policy_version <= $8::bigint
  and security.authorized_row(asset.tenant_id, asset.project_id,
    asset.security_level, asset.policy_version)
  and security.security_rank(input.security_level) <= security.security_rank($7)
  and input.policy_version <= $8::bigint
  and security.authorized_row(input.tenant_id, input.project_id,
    input.security_level, input.policy_version)
returning asset.asset_id
`;

const CONTENT_BLOB_PROMOTE_SQL = `
/* ingestion.runtime.content-blob-promote */
update catalog.content_blob
set raw_storage_key = $4, lifecycle_state = 'RAW',
  row_version = row_version + 1, updated_at = clock_timestamp()
where tenant_id = $1::uuid and project_id = $2::uuid
  and content_blob_id = $3::uuid and content_hash = decode($5, 'hex')
  and byte_size = $6::bigint and raw_storage_key is null
  and lifecycle_state = 'FINGERPRINTED'
  and security.security_rank(security_level) <= security.security_rank($7)
  and policy_version <= $8::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning content_blob_id, raw_storage_key, lifecycle_state
`;

const COMMIT_SESSION_SQL = `
/* ingestion.runtime.commit-session */
update ingestion.session set state = 'COMMITTED', row_version = row_version + 1,
  updated_at = clock_timestamp()
where ingestion_id = $1::uuid and tenant_id = $2::uuid and project_id = $3::uuid
  and state = 'APPROVED' and row_version = $4::bigint
  and security_level = $5 and policy_version = $6::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning state, row_version
`;

const COMMITTED_VERSION_SQL = `
/* ingestion.runtime.committed-version */
select version_id
from catalog.data_item_version
where tenant_id = $1::uuid and project_id = $2::uuid
  and data_item_id = $3::uuid and source_hash = decode($4, 'hex')
  and security_level = $5 and policy_version = $6::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
order by version_number desc limit 1
`;

const FROZEN_CHECKPOINT_LOCK_SQL = `
/* ingestion.runtime.frozen-checkpoint-lock */
select plan
from ingestion.transform_plan
where tenant_id = $1::uuid and project_id = $2::uuid
  and ingestion_id = $3::uuid and plan_hash = decode($4, 'hex')
  and status in ('REVIEW_REQUIRED', 'APPROVED')
  and security_level = $5 and policy_version = $6::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
order by plan_version desc limit 1
for key share
`;

const EVIDENCE_FRAGMENT_SQL = `
/* ingestion.runtime.evidence-fragment */
insert into knowledge.evidence_fragment (
  evidence_fragment_id, tenant_id, project_id, data_item_id, version_id,
  asset_id, locator, content_hash, excerpt, security_level, policy_version,
  row_version
) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
  $7::jsonb, decode($8, 'hex'), $9, $10, $11::bigint, 1)
on conflict (tenant_id, project_id, evidence_fragment_id) do nothing
`;

const SPATIAL_EXTENT_SQL = `
/* ingestion.runtime.spatial-extent */
with source as (
  select st_setsrid(st_geomfromgeojson($6), $7::integer) as geometry
)
insert into catalog.spatial_extent (
  spatial_extent_id, tenant_id, project_id, data_item_id, version_id,
  source_geometry, source_crs, canonical_geometry, canonical_crs,
  display_geometry, security_level, policy_version, row_version
)
select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, source.geometry,
  $8, st_transform(source.geometry, 4490), 'EPSG:4490',
  st_transform(source.geometry, 3857), $9, $10::bigint, 1
from source
on conflict (tenant_id, project_id, spatial_extent_id) do nothing
`;

const OUTBOX_SQL = `
/* ingestion.runtime.outbox data.version.committed */
insert into event.outbox_event (
  tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload,
  idempotency_key, security_level, policy_version, row_version
) values (
  $1::uuid, $2::uuid, 'data-item-version', $3, 'data.version.committed',
  $4::jsonb, 'data.version.committed:' || $3, $5, $6::bigint, 1
) on conflict (tenant_id, project_id, idempotency_key) do nothing
`;

function runtimeError(category: string, retryable = true) {
  return new IngestionPipelinePortError(
    category,
    retryable,
    'The ingestion runtime dependency failed.',
  );
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string')
    throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
  return value;
}

function integer(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value))
    throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
  return value;
}

function uuidV5(identity: string): string {
  const bytes = createHash('sha1')
    .update(Buffer.from('0e729faa0e7b57f3a5c31941c23f1f78', 'hex'))
    .update(identity)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function rollback(client: IngestionRuntimeClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the sanitized runtime error.
  }
}

export interface PostgresIngestionAuthorityOptions {
  readonly pool: IngestionRuntimePool;
  readonly objectStore: IngestionObjectAuthority;
  readonly workerActorId: string;
  readonly maximumPolicyVersion: number;
}

export interface IngestionObjectAuthority {
  commitQuarantineObject(input: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly uploadId: string;
    readonly versionId: string;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly contentType: string;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly raw: { readonly bucket: string; readonly key: string };
    readonly version: { readonly bucket: string; readonly key: string };
    readonly reused: { readonly raw: boolean; readonly version: boolean };
  }>;
}

interface FrozenAssetFact {
  readonly assetId: string;
  readonly ordinal: number;
  readonly uploadId: string;
  readonly quarantineObjectRef: string;
  readonly sourceKind: 'document' | 'geojson';
  readonly mediaType: string;
  readonly size: number;
  readonly sourceHash: string;
  readonly scanHash: string;
  readonly parserHash: string;
  readonly profileHash: string;
  readonly classificationHash: string;
  readonly evidenceExcerpt?: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SECURITY_LEVELS = new Set<PipelineSecurityLevel>([
  'L0_PUBLIC',
  'L1_INTERNAL',
  'L2_RESTRICTED',
  'L3_CONFIDENTIAL',
]);
const SECURITY_RANK: Readonly<Record<PipelineSecurityLevel, number>> = {
  L0_PUBLIC: 0,
  L1_INTERNAL: 1,
  L2_RESTRICTED: 2,
  L3_CONFIDENTIAL: 3,
};

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
  }
  return value as Readonly<Record<string, unknown>>;
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'string') return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
  }
}

function frozenCheckpoint(value: unknown): FrozenIngestionCheckpoint {
  const candidate = jsonRecord(value);
  const reviewHash = candidate.reviewHash;
  const assetIds = candidate.assetIds;
  const assetManifest = candidate.assetManifest;
  const quality = candidate.quality;
  const alignment = candidate.alignment;
  if (
    typeof reviewHash !== 'string' ||
    !SHA256.test(reviewHash) ||
    !Array.isArray(assetIds) ||
    assetIds.length < 1 ||
    assetIds.some(
      (assetId) => typeof assetId !== 'string' || !UUID.test(assetId),
    ) ||
    assetIds.length !== new Set(assetIds).size
  ) {
    throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
  }
  const checkpoint: FrozenIngestionCheckpoint = {
    reviewHash,
    assetIds: Object.freeze(
      assetIds.map((assetId) => {
        if (typeof assetId !== 'string') {
          throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
        }
        return assetId;
      }),
    ),
    assetManifest: jsonRecord(assetManifest),
    quality: record(quality) as unknown as FrozenIngestionCheckpoint['quality'],
    alignment: jsonRecord(alignment),
  };
  const expected = canonicalPipelineHash({
    assetIds: checkpoint.assetIds,
    assetManifest: checkpoint.assetManifest,
    quality: checkpoint.quality,
    alignment: checkpoint.alignment,
  });
  if (expected !== checkpoint.reviewHash) {
    throw runtimeError('INGESTION_REVIEW_HASH_CONFLICT', false);
  }
  return Object.freeze(checkpoint);
}

function frozenAssets(
  checkpoint: FrozenIngestionCheckpoint,
): FrozenAssetFact[] {
  const assets = checkpoint.assetManifest.assets;
  if (!Array.isArray(assets) || assets.length !== checkpoint.assetIds.length) {
    throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
  }
  return assets.map((value, index) => {
    const asset = record(value);
    const result = {
      assetId: text(asset, 'assetId'),
      ordinal: integer(asset, 'ordinal'),
      uploadId: text(asset, 'uploadId'),
      quarantineObjectRef: text(asset, 'quarantineObjectRef'),
      sourceKind: text(asset, 'sourceKind') as FrozenAssetFact['sourceKind'],
      mediaType: text(asset, 'mediaType'),
      size: integer(asset, 'size'),
      sourceHash: text(asset, 'sourceHash'),
      scanHash: text(asset, 'scanHash'),
      parserHash: text(asset, 'parserHash'),
      profileHash: text(asset, 'profileHash'),
      classificationHash: text(asset, 'classificationHash'),
      ...(asset['evidenceExcerpt'] === undefined
        ? {}
        : { evidenceExcerpt: text(asset, 'evidenceExcerpt') }),
    };
    if (
      result.assetId !== checkpoint.assetIds[index] ||
      result.ordinal !== index ||
      !UUID.test(result.assetId) ||
      !UUID.test(result.uploadId) ||
      !['document', 'geojson'].includes(result.sourceKind) ||
      result.mediaType.length > 512 ||
      result.size < 0 ||
      ![
        result.sourceHash,
        result.scanHash,
        result.parserHash,
        result.profileHash,
        result.classificationHash,
      ].every((digest) => SHA256.test(digest)) ||
      (result.evidenceExcerpt !== undefined &&
        (result.evidenceExcerpt.length > 8_192 ||
          [...result.evidenceExcerpt].some((character) => {
            const code = character.charCodeAt(0);
            return (
              code === 0 ||
              (code < 32 && !['\t', '\n', '\r'].includes(character))
            );
          })))
    ) {
      throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
    }
    return result;
  });
}

function validateScope(scope: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly securityLevel: PipelineSecurityLevel;
  readonly policyVersion: number;
}): void {
  if (
    !UUID.test(scope.tenantId) ||
    !UUID.test(scope.projectId) ||
    !SECURITY_LEVELS.has(scope.securityLevel) ||
    !Number.isSafeInteger(scope.policyVersion) ||
    scope.policyVersion < 1
  ) {
    throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
  }
}

function uploadIdFromKey(
  key: string,
  tenantId: string,
  projectId: string,
): string {
  const escapedTenant = tenantId.replaceAll('-', '\\-');
  const escapedProject = projectId.replaceAll('-', '\\-');
  const match = new RegExp(
    `^tenants/${escapedTenant}/projects/${escapedProject}/quarantine/([0-9a-f-]{36})/object$`,
  ).exec(key);
  if (match?.[1] === undefined || !UUID.test(match[1])) {
    throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
  }
  return match[1];
}

function safeLocation(value: unknown): {
  readonly bucket: string;
  readonly key: string;
} {
  const location = record(value);
  const bucket = text(location, 'bucket');
  const key = text(location, 'key');
  if (
    bucket.length > 255 ||
    key.length > 2_048 ||
    [...`${bucket}${key}`].some((character) => character.charCodeAt(0) < 32) ||
    key.split('/').some((segment) => segment === '..')
  ) {
    throw runtimeError('OBJECT_STORE_COMMIT_INVALID', false);
  }
  return Object.freeze({ bucket, key });
}

export class PostgresIngestionAuthority implements IngestionAuthorityPort {
  readonly #pool: IngestionRuntimePool;
  readonly #objectStore: IngestionObjectAuthority;
  readonly #workerActorId: string;
  readonly #policyVersion: number;

  constructor(options: PostgresIngestionAuthorityOptions) {
    if (
      typeof options.pool?.connect !== 'function' ||
      typeof options.objectStore?.commitQuarantineObject !== 'function' ||
      !UUID.test(options.workerActorId) ||
      !Number.isSafeInteger(options.maximumPolicyVersion) ||
      options.maximumPolicyVersion < 1
    ) {
      throw runtimeError('INVALID_INGESTION_AUTHORITY_CONFIG', false);
    }
    this.#pool = options.pool;
    this.#objectStore = options.objectStore;
    this.#workerActorId = options.workerActorId;
    this.#policyVersion = options.maximumPolicyVersion;
  }

  async load(request: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly ingestionId: string;
    readonly securityLevel: PipelineSecurityLevel;
    readonly policyVersion: number;
  }) {
    validateScope(request);
    if (!UUID.test(request.ingestionId)) {
      throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
    }
    return this.#transaction(request, true, async (client) => {
      const result = await client.query(LOAD_SQL, [
        request.tenantId,
        request.projectId,
        request.ingestionId,
        request.securityLevel,
        request.policyVersion,
      ]);
      if (result.rows.length < 1)
        throw runtimeError('INGESTION_NOT_FOUND', false);
      const first = result.rows[0]!;
      const state = text(first, 'state') as PipelineIngestionState;
      const securityLevel = text(
        first,
        'security_level',
      ) as PipelineSecurityLevel;
      const policyVersion = integer(first, 'policy_version');
      if (
        securityLevel !== request.securityLevel ||
        policyVersion !== request.policyVersion
      ) {
        throw runtimeError('INGESTION_AUTHORITY_CONFLICT', false);
      }
      const assets: IngestionAssetCheckpoint[] = result.rows.map((row) => {
        const objectRef = text(row, 'storage_key');
        const mediaType = text(row, 'media_type');
        const sourceHash = row.source_hash;
        const contentBlobId = row.content_blob_id;
        const normalizedMediaType = mediaType
          .split(';', 1)[0]!
          .trim()
          .toLowerCase();
        return {
          assetId: text(row, 'asset_id'),
          ordinal: integer(row, 'ordinal'),
          uploadId: uploadIdFromKey(
            objectRef,
            request.tenantId,
            request.projectId,
          ),
          ...(typeof contentBlobId === 'string' ? { contentBlobId } : {}),
          objectRef,
          mediaType,
          sourceKind:
            normalizedMediaType === 'application/geo+json'
              ? 'geojson'
              : 'document',
          size: integer(row, 'byte_size'),
          ...(sourceHash === null || sourceHash === undefined
            ? {}
            : { sourceHash: text(row, 'source_hash') }),
        };
      });
      const versionId = first.version_id;
      const persistedFrozen = first.frozen_checkpoint;
      return {
        state,
        version: integer(first, 'row_version'),
        securityLevel,
        policyVersion,
        assets: Object.freeze(assets),
        ...(typeof versionId === 'string' ? { versionId } : {}),
        ...(persistedFrozen === null || persistedFrozen === undefined
          ? {}
          : { frozenCheckpoint: frozenCheckpoint(persistedFrozen) }),
      };
    });
  }

  async transition(request: IngestionTransitionRequest) {
    validateScope(request);
    if (
      !UUID.test(request.ingestionId) ||
      !SHA256.test(request.evidence.inputHash) ||
      !SHA256.test(request.evidence.outputHash)
    ) {
      throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
    }
    return this.#transaction(request, false, async (client) => {
      const locked = await client.query(LOCK_SQL, [
        request.tenantId,
        request.projectId,
        request.ingestionId,
        request.securityLevel,
        request.policyVersion,
      ]);
      const row = locked.rows[0];
      if (
        row === undefined ||
        text(row, 'state') !== request.expectedState ||
        integer(row, 'row_version') !== request.expectedVersion ||
        text(row, 'security_level') !== request.securityLevel ||
        integer(row, 'policy_version') !== request.policyVersion
      ) {
        throw runtimeError('INGESTION_AUTHORITY_CONFLICT', false);
      }
      const security = request.securityLevel;
      if (request.evidence.agentRun) {
        const agentRunId = uuidV5(
          `${request.ingestionId}:${request.expectedVersion}:${request.evidence.step}:run`,
        );
        await client.query(AGENT_RUN_SQL, [
          agentRunId,
          request.tenantId,
          request.projectId,
          request.ingestionId,
          request.evidence.inputHash,
          request.evidence.outputHash,
          security,
          request.policyVersion,
        ]);
        await client.query(AGENT_ACTION_SQL, [
          uuidV5(`${agentRunId}:action`),
          request.tenantId,
          request.projectId,
          agentRunId,
          request.evidence.step,
          request.evidence.inputHash,
          request.evidence.outputHash,
          security,
          request.policyVersion,
        ]);
        await client.query(TRANSFORM_PLAN_SQL, [
          uuidV5(`${request.ingestionId}:${request.expectedVersion}:plan`),
          request.tenantId,
          request.projectId,
          request.ingestionId,
          request.expectedVersion,
          request.evidence.inputHash,
          request.evidence.outputHash,
          security,
          request.policyVersion,
        ]);
      }
      await this.#audit(client, request, security, 'SUCCEEDED');
      const updated = await client.query(TRANSITION_SQL, [
        request.ingestionId,
        request.toState,
        request.tenantId,
        request.projectId,
        request.expectedState,
        request.expectedVersion,
        request.securityLevel,
        request.policyVersion,
      ]);
      const result = updated.rows[0];
      if (result === undefined)
        throw runtimeError('INGESTION_AUTHORITY_CONFLICT', false);
      return {
        state: text(result, 'state') as PipelineIngestionState,
        version: integer(result, 'row_version'),
      };
    });
  }

  async recordFingerprints(
    request: Parameters<IngestionAuthorityPort['recordFingerprints']>[0],
  ) {
    validateScope(request);
    if (
      !UUID.test(request.ingestionId) ||
      request.expectedState !== 'SECURITY_SCANNED' ||
      request.fingerprints.length < 1 ||
      request.fingerprints.length > 10_000 ||
      !SHA256.test(request.evidence.inputHash) ||
      !SHA256.test(request.evidence.outputHash)
    ) {
      throw runtimeError('INGESTION_FINGERPRINT_INVALID', false);
    }
    const seen = new Set<string>();
    const seenHashes = new Set<string>();
    for (const [index, fingerprint] of request.fingerprints.entries()) {
      if (seenHashes.has(fingerprint.sourceHash)) {
        throw runtimeError('INGESTION_DUPLICATE_CONTENT', false);
      }
      if (
        !UUID.test(fingerprint.assetId) ||
        seen.has(fingerprint.assetId) ||
        fingerprint.ordinal !== index ||
        !Number.isSafeInteger(fingerprint.size) ||
        fingerprint.size < 0 ||
        fingerprint.mediaType.length < 1 ||
        fingerprint.mediaType.length > 512 ||
        !SHA256.test(fingerprint.sourceHash)
      ) {
        throw runtimeError('INGESTION_FINGERPRINT_INVALID', false);
      }
      seen.add(fingerprint.assetId);
      seenHashes.add(fingerprint.sourceHash);
    }
    return this.#transaction(request, false, async (client) => {
      const lockedSession = await client.query(LOCK_SQL, [
        request.tenantId,
        request.projectId,
        request.ingestionId,
        request.securityLevel,
        request.policyVersion,
      ]);
      const session = lockedSession.rows[0];
      if (
        session === undefined ||
        text(session, 'state') !== request.expectedState ||
        integer(session, 'row_version') !== request.expectedVersion ||
        text(session, 'security_level') !== request.securityLevel ||
        integer(session, 'policy_version') !== request.policyVersion
      ) {
        throw runtimeError('INGESTION_AUTHORITY_CONFLICT', false);
      }
      const lockedAssets = await client.query(FINGERPRINT_ASSETS_LOCK_SQL, [
        request.tenantId,
        request.projectId,
        request.ingestionId,
        request.securityLevel,
        request.policyVersion,
      ]);
      if (lockedAssets.rows.length !== request.fingerprints.length) {
        throw runtimeError('INGESTION_FINGERPRINT_CONFLICT', false);
      }
      for (const [index, fingerprint] of request.fingerprints.entries()) {
        const asset = lockedAssets.rows[index]!;
        if (
          text(asset, 'asset_id') !== fingerprint.assetId ||
          integer(asset, 'ordinal') !== fingerprint.ordinal ||
          integer(asset, 'byte_size') !== fingerprint.size ||
          text(asset, 'media_type') !== fingerprint.mediaType
        ) {
          throw runtimeError('INGESTION_FINGERPRINT_CONFLICT', false);
        }
        const currentBlobId = asset.content_blob_id;
        const currentTrustedHash = asset.trusted_hash;
        let contentBlobId: string;
        if (typeof currentBlobId === 'string') {
          if (currentTrustedHash !== fingerprint.sourceHash) {
            throw runtimeError('INGESTION_FINGERPRINT_CONFLICT', false);
          }
          contentBlobId = currentBlobId;
        } else {
          const proposedBlobId = uuidV5(
            `${request.tenantId}:${request.projectId}:${fingerprint.sourceHash}:blob`,
          );
          const inserted = await client.query(CONTENT_BLOB_UPSERT_SQL, [
            proposedBlobId,
            request.tenantId,
            request.projectId,
            fingerprint.sourceHash,
            fingerprint.size,
            request.securityLevel,
            request.policyVersion,
          ]);
          let blob = inserted.rows[0];
          if (blob === undefined) {
            const existing = await client.query(CONTENT_BLOB_LOCK_SQL, [
              request.tenantId,
              request.projectId,
              fingerprint.sourceHash,
              request.securityLevel,
              request.policyVersion,
            ]);
            blob = existing.rows[0];
          }
          if (
            blob === undefined ||
            text(blob, 'trusted_hash') !== fingerprint.sourceHash ||
            integer(blob, 'byte_size') !== fingerprint.size
          ) {
            throw runtimeError('INGESTION_CONTENT_BLOB_CONFLICT', false);
          }
          contentBlobId = text(blob, 'content_blob_id');
          const blobSecurity = text(
            blob,
            'security_level',
          ) as PipelineSecurityLevel;
          const blobPolicy = integer(blob, 'policy_version');
          if (!SECURITY_LEVELS.has(blobSecurity)) {
            throw runtimeError('INGESTION_CONTENT_BLOB_CONFLICT', false);
          }
          if (
            SECURITY_RANK[blobSecurity] <
              SECURITY_RANK[request.securityLevel] ||
            blobPolicy < request.policyVersion
          ) {
            const raised = await client.query(CONTENT_BLOB_RAISE_SECURITY_SQL, [
              request.tenantId,
              request.projectId,
              contentBlobId,
              request.securityLevel,
              request.policyVersion,
            ]);
            if (raised.rows.length !== 1) {
              throw runtimeError('INGESTION_CONTENT_BLOB_CONFLICT', false);
            }
          }
          const bound = await client.query(ASSET_CONTENT_BIND_SQL, [
            fingerprint.assetId,
            request.tenantId,
            request.projectId,
            fingerprint.size,
            fingerprint.sourceHash,
            contentBlobId,
            request.securityLevel,
            request.policyVersion,
          ]);
          if (bound.rows.length !== 1) {
            throw runtimeError('INGESTION_FINGERPRINT_CONFLICT', false);
          }
        }
        const inputFingerprint = asset.input_fingerprint;
        if (inputFingerprint !== fingerprint.sourceHash) {
          const persistedInput = await client.query(INPUT_FINGERPRINT_SQL, [
            fingerprint.assetId,
            request.tenantId,
            request.projectId,
            request.ingestionId,
            fingerprint.sourceHash,
            request.securityLevel,
            request.policyVersion,
          ]);
          if (persistedInput.rows.length !== 1) {
            throw runtimeError('INGESTION_FINGERPRINT_CONFLICT', false);
          }
        }
      }
      await this.#audit(client, request, request.securityLevel, 'SUCCEEDED');
      const advanced = await client.query(TRANSITION_SQL, [
        request.ingestionId,
        'FINGERPRINTED',
        request.tenantId,
        request.projectId,
        request.expectedState,
        request.expectedVersion,
        request.securityLevel,
        request.policyVersion,
      ]);
      const result = advanced.rows[0];
      if (result === undefined) {
        throw runtimeError('INGESTION_AUTHORITY_CONFLICT', false);
      }
      return {
        state: text(result, 'state') as 'FINGERPRINTED',
        version: integer(result, 'row_version'),
      };
    });
  }

  async freezeCheckpoint(
    request: Parameters<IngestionAuthorityPort['freezeCheckpoint']>[0],
  ) {
    validateScope(request);
    const checkpoint = frozenCheckpoint(request.checkpoint);
    if (
      !UUID.test(request.ingestionId) ||
      request.expectedState !== 'SPATIOTEMPORAL_ALIGNED' ||
      !['REVIEW_REQUIRED', 'APPROVED'].includes(request.toState) ||
      !SHA256.test(request.evidence.inputHash) ||
      !SHA256.test(request.evidence.outputHash)
    ) {
      throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
    }
    return this.#transaction(request, false, async (client) => {
      const locked = await client.query(LOCK_SQL, [
        request.tenantId,
        request.projectId,
        request.ingestionId,
        request.securityLevel,
        request.policyVersion,
      ]);
      const row = locked.rows[0];
      if (
        row === undefined ||
        text(row, 'state') !== request.expectedState ||
        integer(row, 'row_version') !== request.expectedVersion ||
        text(row, 'security_level') !== request.securityLevel ||
        integer(row, 'policy_version') !== request.policyVersion
      ) {
        throw runtimeError('INGESTION_AUTHORITY_CONFLICT', false);
      }
      const planId = uuidV5(
        `${request.ingestionId}:${checkpoint.reviewHash}:review`,
      );
      const persisted = await client.query(REVIEW_CHECKPOINT_SQL, [
        planId,
        request.tenantId,
        request.projectId,
        request.ingestionId,
        request.expectedVersion,
        JSON.stringify(checkpoint),
        checkpoint.reviewHash,
        request.toState,
        request.securityLevel,
        request.policyVersion,
      ]);
      if (persisted.rows.length !== 1) {
        throw runtimeError('INGESTION_REVIEW_HASH_CONFLICT', false);
      }
      const checkRunId = uuidV5(
        `${request.ingestionId}:${checkpoint.reviewHash}:quality`,
      );
      await client.query(QUALITY_CHECK_RUN_SQL, [
        checkRunId,
        request.tenantId,
        request.projectId,
        request.ingestionId,
        request.securityLevel,
        request.policyVersion,
      ]);
      await client.query(QUALITY_SCORECARD_SQL, [
        uuidV5(`${checkRunId}:scorecard`),
        request.tenantId,
        request.projectId,
        checkRunId,
        checkpoint.quality.score,
        checkpoint.quality.grade,
        request.securityLevel,
        request.policyVersion,
      ]);
      const operationId = text(row, 'operation_id');
      await client.query(LINEAGE_PROCESS_SQL, [
        uuidV5(`${request.ingestionId}:${checkpoint.reviewHash}:lineage`),
        request.tenantId,
        request.projectId,
        request.ingestionId,
        operationId,
        JSON.stringify({
          assetIds: checkpoint.assetIds,
          reviewHash: checkpoint.reviewHash,
        }),
        JSON.stringify({
          transformHash: checkpoint.assetManifest.transformedHash,
          alignmentHash: checkpoint.alignment.alignmentHash,
        }),
        request.securityLevel,
        request.policyVersion,
      ]);
      await this.#audit(client, request, request.securityLevel, 'SUCCEEDED');
      const updated = await client.query(FREEZE_SESSION_SQL, [
        request.ingestionId,
        request.toState,
        request.tenantId,
        request.projectId,
        request.expectedState,
        request.expectedVersion,
        request.securityLevel,
        request.policyVersion,
      ]);
      const result = updated.rows[0];
      if (result === undefined) {
        throw runtimeError('INGESTION_AUTHORITY_CONFLICT', false);
      }
      return {
        state: text(result, 'state') as 'REVIEW_REQUIRED' | 'APPROVED',
        version: integer(result, 'row_version'),
        reviewHash: checkpoint.reviewHash,
      };
    });
  }

  async commit(request: Parameters<IngestionAuthorityPort['commit']>[0]) {
    validateScope(request);
    if (!UUID.test(request.ingestionId)) {
      throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
    }
    const checkpoint = frozenCheckpoint(request.checkpoint);
    const assetFacts = frozenAssets(checkpoint);
    const persisted = await this.load(request);
    if (
      persisted.state === 'COMMITTED' ||
      persisted.state === 'PROJECTING' ||
      persisted.state === 'PUBLISHED'
    ) {
      if (persisted.versionId === undefined) {
        throw runtimeError('INGESTION_AUTHORITY_CONFLICT', false);
      }
      return {
        state: 'COMMITTED' as const,
        version: persisted.version,
        versionId: persisted.versionId,
      };
    }
    if (
      persisted.state !== request.expectedState ||
      persisted.version !== request.expectedVersion ||
      persisted.frozenCheckpoint?.reviewHash !== checkpoint.reviewHash ||
      persisted.assets.length !== assetFacts.length ||
      persisted.assets.some((asset, index) => {
        const fact = assetFacts[index]!;
        return (
          asset.contentBlobId === undefined ||
          asset.assetId !== fact.assetId ||
          asset.ordinal !== fact.ordinal ||
          asset.uploadId !== fact.uploadId ||
          asset.objectRef !== fact.quarantineObjectRef ||
          asset.mediaType !== fact.mediaType ||
          asset.sourceKind !== fact.sourceKind ||
          asset.size !== fact.size ||
          asset.sourceHash !== fact.sourceHash
        );
      })
    ) {
      throw runtimeError('INGESTION_AUTHORITY_CONFLICT', false);
    }
    const versionId = uuidV5(`${request.ingestionId}:${checkpoint.reviewHash}`);
    const committedObjects: Array<{
      readonly asset: FrozenAssetFact;
      readonly contentBlobId: string;
      readonly raw: { readonly bucket: string; readonly key: string };
      readonly version: { readonly bucket: string; readonly key: string };
    }> = [];
    try {
      for (const [index, asset] of assetFacts.entries()) {
        const contentBlobId = persisted.assets[index]?.contentBlobId;
        if (contentBlobId === undefined) {
          throw runtimeError('INGESTION_FINGERPRINT_CONFLICT', false);
        }
        const committed = await this.#objectStore.commitQuarantineObject({
          tenantId: request.tenantId,
          projectId: request.projectId,
          uploadId: asset.uploadId,
          versionId,
          sha256: asset.sourceHash,
          sizeBytes: asset.size,
          contentType: asset.mediaType,
        });
        committedObjects.push({
          asset,
          contentBlobId,
          raw: safeLocation(committed.raw),
          version: safeLocation(committed.version),
        });
      }
    } catch (error) {
      if (error instanceof IngestionPipelinePortError) throw error;
      throw runtimeError('OBJECT_STORE_COMMIT_FAILED');
    }
    const transformedHash = text(checkpoint.assetManifest, 'transformedHash');
    const validatedPlan = record(checkpoint.assetManifest.validatedPlan);
    const planHash = text(validatedPlan, 'planHash');
    if (!SHA256.test(transformedHash) || !SHA256.test(planHash)) {
      throw runtimeError('INGESTION_AUTHORITY_INVALID', false);
    }
    const finalManifest = Object.freeze({
      assets: committedObjects.map(
        ({ asset, contentBlobId, raw, version }) => ({
          assetId: asset.assetId,
          contentBlobId,
          ordinal: asset.ordinal,
          sourceKind: asset.sourceKind,
          mediaType: asset.mediaType,
          size: asset.size,
          sourceHash: asset.sourceHash,
          rawObject: raw,
          versionObject: version,
        }),
      ),
      reviewHash: checkpoint.reviewHash,
      transformedHash,
      planHash,
    });
    return this.#transaction(request, false, async (client) => {
      const locked = await client.query(LOCK_SQL, [
        request.tenantId,
        request.projectId,
        request.ingestionId,
        request.securityLevel,
        request.policyVersion,
      ]);
      const row = locked.rows[0];
      if (row === undefined) throw runtimeError('INGESTION_NOT_FOUND', false);
      const currentState = text(row, 'state');
      if (currentState === 'COMMITTED') {
        const actual = await client.query(COMMITTED_VERSION_SQL, [
          request.tenantId,
          request.projectId,
          request.ingestionId,
          checkpoint.reviewHash,
          request.securityLevel,
          request.policyVersion,
        ]);
        const actualVersion = actual.rows[0];
        if (actualVersion === undefined) {
          throw runtimeError('INGESTION_AUTHORITY_CONFLICT', false);
        }
        return {
          state: 'COMMITTED' as const,
          version: integer(row, 'row_version'),
          versionId: text(actualVersion, 'version_id'),
        };
      }
      if (
        currentState !== request.expectedState ||
        integer(row, 'row_version') !== request.expectedVersion ||
        text(row, 'security_level') !== request.securityLevel ||
        integer(row, 'policy_version') !== request.policyVersion
      ) {
        throw runtimeError('INGESTION_AUTHORITY_CONFLICT', false);
      }
      const frozen = await client.query(FROZEN_CHECKPOINT_LOCK_SQL, [
        request.tenantId,
        request.projectId,
        request.ingestionId,
        checkpoint.reviewHash,
        request.securityLevel,
        request.policyVersion,
      ]);
      if (
        frozen.rows[0] === undefined ||
        frozenCheckpoint(frozen.rows[0].plan).reviewHash !==
          checkpoint.reviewHash
      ) {
        throw runtimeError('INGESTION_REVIEW_HASH_CONFLICT', false);
      }
      const security = request.securityLevel;
      const intendedUses = Array.isArray(row.intended_uses)
        ? row.intended_uses
        : [];
      const dataItemId = request.ingestionId;
      const metadataHash = canonicalPipelineHash({
        quality: checkpoint.quality,
        alignment: checkpoint.alignment,
        evidence: request.evidence,
      });
      await client.query(DATA_ITEM_SQL, [
        dataItemId,
        request.tenantId,
        request.projectId,
        `Ingestion ${request.ingestionId}`,
        intendedUses,
        checkpoint.quality.grade,
        security,
        request.policyVersion,
      ]);
      const insertedVersion = await client.query(VERSION_SQL, [
        versionId,
        request.tenantId,
        request.projectId,
        dataItemId,
        JSON.stringify(finalManifest),
        checkpoint.reviewHash,
        metadataHash,
        checkpoint.quality.grade,
        security,
        request.policyVersion,
      ]);
      if (insertedVersion.rows.length !== 1) {
        throw runtimeError('INGESTION_VERSION_IMMUTABLE_CONFLICT', false);
      }
      for (const { asset, contentBlobId, raw } of committedObjects) {
        const lockedBlob = await client.query(CONTENT_BLOB_LOCK_SQL, [
          request.tenantId,
          request.projectId,
          asset.sourceHash,
          request.securityLevel,
          request.policyVersion,
        ]);
        const blob = lockedBlob.rows[0];
        if (
          blob === undefined ||
          text(blob, 'content_blob_id') !== contentBlobId ||
          text(blob, 'trusted_hash') !== asset.sourceHash ||
          integer(blob, 'byte_size') !== asset.size
        ) {
          throw runtimeError('INGESTION_CONTENT_BLOB_CONFLICT', false);
        }
        const rawStorageKey = blob.raw_storage_key;
        if (rawStorageKey === null || rawStorageKey === undefined) {
          const promoted = await client.query(CONTENT_BLOB_PROMOTE_SQL, [
            request.tenantId,
            request.projectId,
            contentBlobId,
            raw.key,
            asset.sourceHash,
            asset.size,
            request.securityLevel,
            request.policyVersion,
          ]);
          if (promoted.rows.length !== 1) {
            throw runtimeError('INGESTION_CONTENT_BLOB_CONFLICT', false);
          }
        } else if (
          rawStorageKey !== raw.key ||
          text(blob, 'lifecycle_state') !== 'RAW'
        ) {
          throw runtimeError('INGESTION_CONTENT_BLOB_CONFLICT', false);
        }
      }
      const boundAssets = await client.query(ASSET_COMMIT_SQL, [
        request.tenantId,
        request.projectId,
        request.ingestionId,
        checkpoint.assetIds,
        committedObjects.map(({ version }) => version.key),
        versionId,
        request.securityLevel,
        request.policyVersion,
      ]);
      if (
        boundAssets.rows.length !== checkpoint.assetIds.length ||
        new Set(boundAssets.rows.map((asset) => text(asset, 'asset_id')))
          .size !== checkpoint.assetIds.length
      ) {
        throw runtimeError('INGESTION_ASSET_REBIND_CONFLICT', false);
      }
      const evidenceFragmentIds: string[] = [];
      for (const { asset, version } of committedObjects) {
        const evidenceFragmentId = uuidV5(
          `${versionId}:${asset.assetId}:${asset.sourceHash}:evidence`,
        );
        evidenceFragmentIds.push(evidenceFragmentId);
        await client.query(EVIDENCE_FRAGMENT_SQL, [
          evidenceFragmentId,
          request.tenantId,
          request.projectId,
          dataItemId,
          versionId,
          asset.assetId,
          JSON.stringify({
            assetId: asset.assetId,
            ordinal: asset.ordinal,
            sourceHash: asset.sourceHash,
            versionObject: version,
          }),
          asset.sourceHash,
          asset.evidenceExcerpt ?? null,
          security,
          request.policyVersion,
        ]);
      }
      const spatialExtentIds = await this.#persistSpatialFacts(
        client,
        request,
        checkpoint,
        dataItemId,
        versionId,
      );
      const session = await client.query(COMMIT_SESSION_SQL, [
        request.ingestionId,
        request.tenantId,
        request.projectId,
        request.expectedVersion,
        request.securityLevel,
        request.policyVersion,
      ]);
      await this.#audit(client, request, security, 'SUCCEEDED');
      const checkRunId = uuidV5(
        `${request.ingestionId}:${checkpoint.reviewHash}:quality`,
      );
      const processRunId = uuidV5(
        `${request.ingestionId}:${checkpoint.reviewHash}:lineage`,
      );
      await client.query(OUTBOX_SQL, [
        request.tenantId,
        request.projectId,
        versionId,
        JSON.stringify({
          dataItemId,
          versionId,
          assetIds: checkpoint.assetIds,
          contentBlobIds: committedObjects.map(
            ({ contentBlobId }) => contentBlobId,
          ),
          checkRunId,
          processRunId,
          evidenceFragmentIds,
          spatialExtentIds,
        }),
        security,
        request.policyVersion,
      ]);
      const updated = session.rows[0];
      if (updated === undefined)
        throw runtimeError('INGESTION_AUTHORITY_CONFLICT', false);
      return {
        state: 'COMMITTED' as const,
        version: integer(updated, 'row_version'),
        versionId,
      };
    });
  }

  async #persistSpatialFacts(
    client: IngestionRuntimeClient,
    request: Parameters<IngestionAuthorityPort['commit']>[0],
    checkpoint: FrozenIngestionCheckpoint,
    dataItemId: string,
    versionId: string,
  ): Promise<string[]> {
    const value = checkpoint.alignment.spatialFacts;
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > checkpoint.assetIds.length) {
      throw runtimeError('INGESTION_SPATIAL_FACT_INVALID', false);
    }
    const identifiers: string[] = [];
    for (const entry of value) {
      const fact = record(entry);
      const assetId = text(fact, 'assetId');
      const sourceCrs = text(fact, 'sourceCrs');
      const sourceGeoJson = record(fact.sourceGeoJson);
      const srid =
        sourceCrs === 'EPSG:4326'
          ? 4326
          : sourceCrs === 'EPSG:4490'
            ? 4490
            : sourceCrs === 'EPSG:3857'
              ? 3857
              : undefined;
      if (!checkpoint.assetIds.includes(assetId) || srid === undefined) {
        throw runtimeError('INGESTION_SPATIAL_FACT_INVALID', false);
      }
      const identifier = uuidV5(`${versionId}:${assetId}:spatial`);
      identifiers.push(identifier);
      await client.query(SPATIAL_EXTENT_SQL, [
        identifier,
        request.tenantId,
        request.projectId,
        dataItemId,
        versionId,
        JSON.stringify(sourceGeoJson),
        srid,
        sourceCrs,
        request.securityLevel,
        request.policyVersion,
      ]);
    }
    return identifiers;
  }

  async #audit(
    client: IngestionRuntimeClient,
    request: {
      readonly tenantId: string;
      readonly projectId: string;
      readonly ingestionId: string;
      readonly evidence: HashOnlyPipelineEvidence;
      readonly policyVersion: number;
    },
    security: string,
    decision: string,
  ): Promise<void> {
    await client.query(AUDIT_SQL, [
      request.tenantId,
      request.projectId,
      this.#workerActorId,
      `ingestion.${request.evidence.step}`,
      request.ingestionId,
      decision,
      request.evidence.step,
      request.evidence.inputHash,
      request.evidence.outputHash,
      security,
      request.policyVersion,
    ]);
  }

  async #transaction<Result>(
    scope: {
      readonly tenantId: string;
      readonly projectId: string;
      readonly securityLevel: PipelineSecurityLevel;
      readonly policyVersion: number;
    },
    readOnly: boolean,
    work: (client: IngestionRuntimeClient) => Promise<Result>,
  ): Promise<Result> {
    validateScope(scope);
    if (scope.policyVersion > this.#policyVersion) {
      throw runtimeError('INGESTION_POLICY_VERSION_EXCEEDED', false);
    }
    let client: IngestionRuntimeClient;
    try {
      client = await this.#pool.connect();
    } catch {
      throw runtimeError('INGESTION_DATABASE_UNAVAILABLE');
    }
    try {
      await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
      await client.query(SET_SCOPE_SQL, [
        scope.tenantId,
        scope.projectId,
        scope.securityLevel,
        String(scope.policyVersion),
      ]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await rollback(client);
      if (error instanceof IngestionPipelinePortError) throw error;
      throw runtimeError('INGESTION_DATABASE_UNAVAILABLE');
    } finally {
      client.release();
    }
  }
}

export interface ClamAvInstreamScannerOptions {
  readonly read: (objectRef: string) => Promise<ByteSource>;
  readonly exchange?: (chunks: AsyncIterable<Uint8Array>) => Promise<string>;
  readonly host?: string;
  readonly port?: number;
  readonly timeoutMs: number;
  readonly maximumBytes: number;
  readonly maximumResponseBytes: number;
}

type ByteSource = Uint8Array | AsyncIterable<Uint8Array>;

async function* byteSource(source: ByteSource): AsyncIterable<Uint8Array> {
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  if (
    source === null ||
    typeof source !== 'object' ||
    typeof source[Symbol.asyncIterator] !== 'function'
  ) {
    throw runtimeError('INVALID_BYTE_SOURCE', false);
  }
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) {
      throw runtimeError('INVALID_BYTE_SOURCE', false);
    }
    yield chunk;
  }
}

async function* clamFrames(
  source: ByteSource,
  maximumBytes: number,
): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode('zINSTREAM\0');
  let total = 0;
  for await (const input of byteSource(source)) {
    total += input.length;
    if (total > maximumBytes) {
      throw runtimeError('CLAMAV_INPUT_LIMIT', false);
    }
    for (let offset = 0; offset < input.length; offset += 64 * 1024) {
      const chunk = input.subarray(
        offset,
        Math.min(input.length, offset + 64 * 1024),
      );
      const frame = Buffer.allocUnsafe(4 + chunk.length);
      frame.writeUInt32BE(chunk.length, 0);
      frame.set(chunk, 4);
      yield frame;
    }
  }
  yield Buffer.alloc(4);
}

function withTimeout<Result>(
  promise: Promise<Result>,
  timeoutMs: number,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('dependency failed'));
      },
    );
  });
}

async function tcpExchange(
  host: string,
  port: number,
  chunks: AsyncIterable<Uint8Array>,
  timeoutMs: number,
  maxResponse: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const response: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(
      () => socket.destroy(new Error('timeout')),
      timeoutMs,
    );
    socket.on('connect', () => {
      void (async () => {
        for await (const chunk of chunks) {
          if (!socket.write(chunk)) await once(socket, 'drain');
        }
      })().catch(() => socket.destroy(new Error('write failed')));
    });
    socket.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxResponse) socket.destroy(new Error('response too large'));
      else response.push(chunk);
      if (chunk.includes(0)) socket.end();
    });
    socket.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(response).toString('utf8'));
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export class ClamAvInstreamScanner {
  constructor(private readonly options: ClamAvInstreamScannerOptions) {
    if (
      typeof options.read !== 'function' ||
      (options.exchange !== undefined &&
        typeof options.exchange !== 'function') ||
      !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 100 ||
      !Number.isSafeInteger(options.maximumBytes) ||
      options.maximumBytes < 1 ||
      !Number.isSafeInteger(options.maximumResponseBytes) ||
      options.maximumResponseBytes < 16
    ) {
      throw runtimeError('INVALID_CLAMAV_CONFIG', false);
    }
  }

  async scan(input: {
    readonly objectRef: string;
  }): Promise<{ clean: boolean }> {
    try {
      const source = await this.options.read(input.objectRef);
      const frames = clamFrames(source, this.options.maximumBytes);
      const response = this.options.exchange
        ? await withTimeout(
            this.options.exchange(frames),
            this.options.timeoutMs,
          )
        : await tcpExchange(
            this.options.host ?? '127.0.0.1',
            this.options.port ?? 3310,
            frames,
            this.options.timeoutMs,
            this.options.maximumResponseBytes,
          );
      if (Buffer.byteLength(response) > this.options.maximumResponseBytes) {
        throw runtimeError('CLAMAV_RESPONSE_LIMIT', false);
      }
      const normalized = response.endsWith('\0')
        ? response.slice(0, -1)
        : response;
      if (normalized.endsWith(' OK')) return { clean: true };
      if (normalized.endsWith(' FOUND')) return { clean: false };
      throw runtimeError('CLAMAV_INVALID_RESPONSE');
    } catch (error) {
      if (error instanceof IngestionPipelinePortError) throw error;
      throw runtimeError('CLAMAV_TEMPORARY');
    }
  }
}

export interface TikaIngestionParserOptions {
  readonly endpoint: string;
  readonly read: (objectRef: string) => Promise<ByteSource>;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs: number;
  readonly maximumInputBytes: number;
  readonly maximumResponseBytes: number;
}

async function boundedResponse(
  response: Response,
  maximum: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    const chunk: unknown = result.value;
    if (!(chunk instanceof Uint8Array)) {
      throw runtimeError('TIKA_INVALID_RESPONSE', false);
    }
    size += chunk.length;
    if (size > maximum) {
      await reader.cancel().catch(() => undefined);
      throw runtimeError('TIKA_RESPONSE_LIMIT', false);
    }
    chunks.push(chunk);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(output);
}

async function collectBytes(
  source: ByteSource,
  maximum: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of byteSource(source)) {
    size += chunk.length;
    if (size > maximum) throw runtimeError('TIKA_INPUT_LIMIT', false);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function* hashingBody(
  source: ByteSource,
  maximum: number,
  digest: ReturnType<typeof createHash>,
): AsyncIterable<Uint8Array> {
  let size = 0;
  for await (const chunk of byteSource(source)) {
    size += chunk.length;
    if (size > maximum) throw runtimeError('TIKA_INPUT_LIMIT', false);
    digest.update(chunk);
    yield chunk;
  }
}

export class TikaIngestionParser {
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(private readonly options: TikaIngestionParserOptions) {
    let endpoint: URL;
    try {
      endpoint = new URL(options.endpoint);
    } catch {
      throw runtimeError('INVALID_TIKA_CONFIG', false);
    }
    if (
      typeof options.read !== 'function' ||
      (options.fetch !== undefined && typeof options.fetch !== 'function') ||
      !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 100 ||
      !Number.isSafeInteger(options.maximumInputBytes) ||
      options.maximumInputBytes < 1 ||
      !Number.isSafeInteger(options.maximumResponseBytes) ||
      options.maximumResponseBytes < 16 ||
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.pathname !== '/' ||
      endpoint.search ||
      endpoint.hash
    ) {
      throw runtimeError('INVALID_TIKA_CONFIG', false);
    }
    this.#endpoint = endpoint.origin;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async parse(input: {
    readonly objectRef: string;
    readonly mediaType: string;
    readonly sourceKind: 'document' | 'geojson';
  }) {
    try {
      if (
        input.mediaType.length < 1 ||
        input.mediaType.length > 512 ||
        [...input.mediaType].some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
      ) {
        throw runtimeError('TIKA_INVALID_MEDIA_TYPE', false);
      }
      const source = await this.options.read(input.objectRef);
      if (input.sourceKind === 'geojson') {
        const bytes = await collectBytes(
          source,
          this.options.maximumInputBytes,
        );
        const contentHash = createHash('sha256').update(bytes).digest('hex');
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (
          parsed === null ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          ![
            'Feature',
            'FeatureCollection',
            'GeometryCollection',
            'Point',
            'MultiPoint',
            'LineString',
            'MultiLineString',
            'Polygon',
            'MultiPolygon',
          ].includes(String((parsed as Record<string, unknown>).type))
        ) {
          throw runtimeError('TIKA_INVALID_RESPONSE', false);
        }
        let sourceCrs = 'EPSG:4326';
        const crs = (parsed as Record<string, unknown>)['crs'];
        if (crs !== undefined) {
          const crsRecord = record(crs);
          const properties = record(crsRecord['properties']);
          const name = properties['name'];
          if (
            crsRecord['type'] !== 'name' ||
            typeof name !== 'string' ||
            !['EPSG:4326', 'EPSG:4490', 'EPSG:3857'].includes(name)
          ) {
            throw runtimeError('TIKA_INVALID_RESPONSE', false);
          }
          sourceCrs = name;
        }
        return {
          kind: 'geojson' as const,
          contentHash,
          metadata: {
            geojson: true,
            sourceCrs,
            sourceGeoJson: parsed as Readonly<Record<string, unknown>>,
          },
        };
      }
      const digest = createHash('sha256');
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.options.timeoutMs,
      );
      timer.unref();
      let response: Response | undefined;
      try {
        const init: RequestInit & { readonly duplex: 'half' } = {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            'Content-Type': input.mediaType,
          },
          body: Readable.from(
            hashingBody(source, this.options.maximumInputBytes, digest),
          ),
          duplex: 'half',
          signal: controller.signal,
        };
        response = await this.#fetch(`${this.#endpoint}/rmeta/text`, init);
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw runtimeError('TIKA_TEMPORARY');
        }
        const body = await boundedResponse(
          response,
          this.options.maximumResponseBytes,
        );
        const parsed: unknown = JSON.parse(body);
        if (
          !Array.isArray(parsed) ||
          parsed.length < 1 ||
          parsed[0] === null ||
          typeof parsed[0] !== 'object'
        ) {
          throw runtimeError('TIKA_INVALID_RESPONSE', false);
        }
        const metadata = { ...(parsed[0] as Record<string, unknown>) };
        const extractedText = metadata['X-TIKA:content'];
        delete metadata['X-TIKA:content'];
        if (typeof extractedText === 'string') {
          const excerpt = extractedText.trim().slice(0, 8_192);
          if (excerpt.length > 0) metadata['wiser:excerpt'] = excerpt;
        }
        return {
          kind: 'document' as const,
          contentHash: digest.digest('hex'),
          metadata,
        };
      } finally {
        clearTimeout(timer);
        if (controller.signal.aborted) {
          await response?.body?.cancel().catch(() => undefined);
        }
      }
    } catch (error) {
      if (error instanceof IngestionPipelinePortError) throw error;
      throw runtimeError('TIKA_TEMPORARY');
    }
  }
}

export class FixtureFakeAiPlanner {
  propose(input: unknown): Promise<unknown> {
    const inputHash = canonicalPipelineHash(input);
    return Promise.resolve(
      Object.freeze({
        plannerId: 'wiser.fixture-ingestion-planner',
        plannerVersion: '1.0.0',
        inputHash,
        schemaPlan: Object.freeze({
          version: '1.0.0',
          mode: 'deterministic-fixture',
        }),
        semanticPlan: Object.freeze({
          version: '1.0.0',
          concepts: Object.freeze(['water-data']),
        }),
        confidence: 1,
      }),
    );
  }
}

export class FixtureFakeAiPlanValidator {
  validate(input: unknown) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw runtimeError('AI_PLAN_INVALID', false);
    }
    const candidate = input as Record<string, unknown>;
    const expected = [
      'confidence',
      'inputHash',
      'plannerId',
      'plannerVersion',
      'schemaPlan',
      'semanticPlan',
    ];
    if (
      Object.keys(candidate).sort().join(',') !== expected.sort().join(',') ||
      candidate.plannerId !== 'wiser.fixture-ingestion-planner' ||
      candidate.plannerVersion !== '1.0.0' ||
      typeof candidate.inputHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(candidate.inputHash) ||
      candidate.confidence !== 1 ||
      candidate.schemaPlan === null ||
      typeof candidate.schemaPlan !== 'object' ||
      candidate.semanticPlan === null ||
      typeof candidate.semanticPlan !== 'object'
    ) {
      throw runtimeError('AI_PLAN_INVALID', false);
    }
    return {
      schemaPlan: candidate.schemaPlan as Readonly<Record<string, unknown>>,
      semanticPlan: candidate.semanticPlan as Readonly<Record<string, unknown>>,
      confidence: 1,
    };
  }
}
