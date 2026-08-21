import { createHash, randomUUID } from 'node:crypto';

import {
  DATA_INGESTION_PROCESS_JOB_TYPE,
  type DataIngestionProcessJobPayload,
} from '@wiser/data-infra';
import {
  ApproveIngestionInputSchema,
  CancelOperationInputSchema,
  CompleteUploadSessionInputSchema,
  CreateDataItemInputSchema,
  CreateIngestionInputSchema,
  CreateUploadSessionInputSchema,
  DATA_CAPABILITY_REGISTRY,
  RejectIngestionInputSchema,
  SubmitIngestionInputSchema,
  type DataCapabilityId,
  type DataItemDto,
  type IngestionDto,
  type OperationDto,
  type SecurityLevel,
  type UploadSessionDto,
} from '@wiser/data-contracts';
import type { S3AuthorityObjectStore } from '@wiser/data-infra/object-store';

import type {
  DataCapabilityExecutionContext,
  DataCapabilityExecutor,
} from './capability-handler.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MIN_MULTIPART_PART_SIZE = 5 * 1024 * 1024;
const PREFERRED_MULTIPART_PART_SIZE = 64 * 1024 * 1024;
const MAX_MULTIPART_PART_SIZE = 5 * 1024 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10_000;
const MAX_SINGLE_PUT_SIZE = 5 * 1024 * 1024 * 1024;
const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
const DEFAULT_UPLOAD_SESSION_TTL_SECONDS = 3_600;

const SECURITY_RANK: Readonly<Record<SecurityLevel, number>> = {
  L0_PUBLIC: 0,
  L1_INTERNAL: 1,
  L2_RESTRICTED: 2,
  L3_CONFIDENTIAL: 3,
};

const SET_SCOPE_SQL = `
/* data.command.scope */
select
  set_config('wiser.tenant_id', $1, true),
  set_config('wiser.project_id', $2, true),
  set_config('wiser.max_security_level', $3, true),
  set_config('wiser.policy_version', $4, true),
  set_config('statement_timeout', $5, true)
`;

const IDEMPOTENCY_LOCK_SQL = `
/* data.command.idempotency.lock */
select pg_advisory_xact_lock(hashtextextended($1::text, 0))
`;

const IDEMPOTENCY_READ_SQL = `
/* data.command.idempotency.read */
select payload
from event.outbox_event
where idempotency_key = $1
  and tenant_id = $2::uuid and project_id = $3::uuid
  and security.security_rank(security_level) <= security.security_rank($4)
  and policy_version <= $5::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
for update
`;

const OPERATION_INSERT_SQL = `
/* data.command.operation.insert */
insert into service.operation (
  operation_id, tenant_id, project_id, capability_id, actor_id, status,
  progress_percent, idempotency_key, request_payload, result_payload,
  security_level, policy_version, row_version, created_at, updated_at,
  started_at, completed_at
) values (
  $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7::integer, $8,
  $9::jsonb, $10::jsonb, $11, $12::bigint, 1, $13::timestamptz,
  $13::timestamptz,
  case when $6 in ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
    then $13::timestamptz else null end,
  case when $6 in ('SUCCEEDED', 'FAILED', 'CANCELLED')
    then $13::timestamptz else null end
)
`;

const OPERATION_EVENT_INSERT_SQL = `
/* data.command.operation-event.insert */
insert into service.operation_event (
  tenant_id, project_id, operation_id, event_id, sequence_number,
  from_status, to_status, event_type, payload, security_level,
  policy_version, row_version, created_at
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid,
  (select coalesce(max(sequence_number), 0) + 1
   from service.operation_event
   where tenant_id = $1::uuid and project_id = $2::uuid
     and operation_id = $3::uuid
     and security.security_rank(security_level) <= security.security_rank($10)
     and policy_version <= $11::bigint),
  $5, $6, $7, $8::jsonb, $9, $11::bigint, 1, $12::timestamptz
)
`;

const AUDIT_INSERT_SQL = `
/* data.command.audit.insert */
insert into security.audit_event (
  tenant_id, project_id, event_id, actor_id, action, resource_type,
  resource_id, decision, purpose, context, security_level, policy_version,
  row_version, created_at
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, 'ALLOWED', $8,
  jsonb_build_object('traceId', $9::text, 'requestHash', $10::text),
  $11, $12::bigint, 1, $13::timestamptz
)
`;

const OUTBOX_INSERT_SQL = `
/* data.command.outbox.insert */
insert into event.outbox_event (
  tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload,
  headers, idempotency_key, security_level, policy_version, row_version,
  created_at
) values (
  $1::uuid, $2::uuid, 'data-command', $3, $4, $5::jsonb,
  jsonb_build_object('traceId', $6::text), $7, $8, $9::bigint, 1,
  $10::timestamptz
)
`;

const CATALOG_INSERT_SQL = `
/* data.catalog.create */
insert into catalog.data_item (
  data_item_id, tenant_id, project_id, owner_project_id, name,
  business_domains, source_natures, source_channels, processing_stage,
  intended_uses, source_organization, source_contact, authorization_scope,
  citation_requirements, source_crs, canonical_crs, timezone,
  temporal_resolution, schema_version_id, unit_definitions,
  missing_value_rules, anomaly_rules, generation_method, quality_grade,
  acceptance_status, publication_status, security_level, version,
  update_mode, policy_version, row_version, created_at, updated_at
) values (
  $1::uuid, $2::uuid, $3::uuid, $3::uuid, $4, $5::text[], $6::text[],
  $7::text[], $8, $9::text[], $10, $11::jsonb, $12, $13::text[], $14,
  $15, $16, $17, $18::uuid, $19::jsonb, $20::jsonb, $21::jsonb, $22,
  'C', 'PENDING', 'UNPUBLISHED', $23, 1, $24, $25::bigint, 1,
  $26::timestamptz, $26::timestamptz
)
`;

const CATALOG_SPATIAL_INSERT_SQL = `
/* data.catalog.spatial-extent.insert */
insert into catalog.spatial_extent (
  spatial_extent_id, tenant_id, project_id, data_item_id, version_id,
  source_geometry, source_crs, canonical_geometry, canonical_crs,
  display_geometry, security_level, policy_version, row_version,
  created_at, updated_at
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, null,
  ST_SetSRID(ST_MakeEnvelope($5, $6, $7, $8), $9::integer), $10,
  ST_Transform(ST_SetSRID(ST_MakeEnvelope($5, $6, $7, $8), $9::integer), 4490),
  'EPSG:4490',
  ST_Transform(ST_SetSRID(ST_MakeEnvelope($5, $6, $7, $8), $9::integer), 3857),
  $11, $12::bigint, 1, $13::timestamptz, $13::timestamptz
)
`;

const CATALOG_TEMPORAL_INSERT_SQL = `
/* data.catalog.temporal-extent.insert */
insert into catalog.temporal_extent (
  temporal_extent_id, tenant_id, project_id, data_item_id, version_id,
  starts_at, ends_at, timezone, temporal_resolution, security_level,
  policy_version, row_version, created_at, updated_at
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, null, $5::timestamptz,
  $6::timestamptz, $7, $8, $9, $10::bigint, 1,
  $11::timestamptz, $11::timestamptz
)
`;

const UPLOAD_LOCK_SQL = `
/* data.upload.session.lock */
select operation_id, status, row_version, request_payload, result_payload,
  security_level, policy_version, created_at, updated_at
from service.operation
where operation_id = $1::uuid
  and tenant_id = $2::uuid and project_id = $3::uuid
  and capability_id = 'data.uploadSession.create'
  and security.security_rank(security_level) <= security.security_rank($4)
  and policy_version <= $5::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
for update
`;

const UPLOAD_COMPLETE_SQL = `
/* data.upload.session.complete.update */
update service.operation
set status = 'SUCCEEDED', progress_percent = 100, result_payload = $2::jsonb,
  request_payload = request_payload ||
    jsonb_build_object('completionClaims', $10::jsonb),
  row_version = row_version + 1, updated_at = $3::timestamptz,
  started_at = coalesce(started_at, $3::timestamptz),
  completed_at = $3::timestamptz, security_level = $9
where operation_id = $1::uuid
  and tenant_id = $4::uuid and project_id = $5::uuid
  and status = 'WAITING_INPUT' and row_version = $6::bigint
  and security.security_rank(security_level) <= security.security_rank($7)
  and policy_version <= $8::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning row_version
`;

const ASSET_INSERT_SQL = `
/* data.upload.asset.insert */
insert into catalog.asset (
  asset_id, tenant_id, project_id, version_id, storage_key, content_hash,
  content_blob_id, media_type, byte_size, lifecycle_state, security_level,
  policy_version, row_version, created_at, updated_at
) values (
  $1::uuid, $2::uuid, $3::uuid, null, $4, null, null, $5,
  $6::bigint, 'QUARANTINED', $7, $8::bigint, 1,
  $9::timestamptz, $9::timestamptz
)
returning asset_id, content_hash, content_blob_id, security_level, row_version
`;

const ASSETS_LOCK_SQL = `
/* data.ingestion.assets.lock */
select asset.asset_id, asset.security_level, asset.policy_version,
  asset.row_version, asset.lifecycle_state, asset.version_id,
  input.ingestion_id as bound_ingestion_id
from catalog.asset as asset
left join ingestion.input_asset as input
  on input.tenant_id = asset.tenant_id
 and input.project_id = asset.project_id
 and input.asset_id = asset.asset_id
where asset.asset_id = any($1::uuid[])
  and asset.tenant_id = $2::uuid and asset.project_id = $3::uuid
  and security.security_rank(asset.security_level) <= security.security_rank($4)
  and asset.policy_version <= $5::bigint
  and security.authorized_row(
    asset.tenant_id, asset.project_id, asset.security_level, asset.policy_version
  )
order by asset.asset_id
for update of asset
`;

const ASSET_SECURITY_ELEVATE_SQL = `
/* data.ingestion.asset-security.update */
update catalog.asset
set security_level = $2, row_version = row_version + 1,
  updated_at = $3::timestamptz
where asset_id = $1::uuid
  and tenant_id = $4::uuid and project_id = $5::uuid
  and lifecycle_state = 'QUARANTINED' and version_id is null
  and row_version = $6::bigint
  and security.security_rank($2) >= security.security_rank(security_level)
  and security.security_rank(security_level) <= security.security_rank($7)
  and policy_version <= $8::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning asset_id, security_level, row_version
`;

const INGESTION_INSERT_SQL = `
/* data.ingestion.create */
insert into ingestion.session (
  ingestion_id, tenant_id, project_id, operation_id, owner_project_id,
  state, intended_uses, expected_version, requested_security_level,
  security_level, policy_version, row_version, created_at, updated_at
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $3::uuid, 'RECEIVED',
  $5::text[], 1, $6, $6, $7::bigint, 1, $8::timestamptz,
  $8::timestamptz
)
`;

const INPUT_ASSET_INSERT_SQL = `
/* data.ingestion.input-asset.insert */
insert into ingestion.input_asset (
  input_asset_id, tenant_id, project_id, ingestion_id, asset_id, ordinal,
  scan_status, security_level, policy_version, row_version, created_at,
  updated_at
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::integer,
  'PENDING', $7, $8::bigint, 1, $9::timestamptz, $9::timestamptz
)
`;

const INGESTION_LOCK_SQL = `
/* data.ingestion.session.lock */
select ingestion_id, state, row_version, intended_uses,
  requested_security_level, security_level, policy_version, operation_id,
  created_at, updated_at
from ingestion.session
where ingestion_id = $1::uuid
  and tenant_id = $2::uuid and project_id = $3::uuid
  and security.security_rank(security_level) <= security.security_rank($4)
  and policy_version <= $5::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
for update
`;

const INGESTION_ASSET_IDS_SQL = `
/* data.ingestion.asset-ids.read */
select asset_id, ordinal
from ingestion.input_asset
where ingestion_id = $1::uuid
  and tenant_id = $2::uuid and project_id = $3::uuid
  and security.security_rank(security_level) <= security.security_rank($4)
  and policy_version <= $5::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
order by ordinal
`;

const INGESTION_APPROVE_SQL = `
/* data.ingestion.approve.update */
update ingestion.session
set state = 'APPROVED', approved_by_actor_id = $2::uuid,
  approved_at = $3::timestamptz, row_version = row_version + 1,
  updated_at = $3::timestamptz
where ingestion_id = $1::uuid
  and tenant_id = $4::uuid and project_id = $5::uuid
  and state = 'REVIEW_REQUIRED' and row_version = $6::bigint
  and security.security_rank(security_level) <= security.security_rank($7)
  and policy_version <= $8::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning row_version
`;

const INGESTION_REJECT_SQL = `
/* data.ingestion.reject.update */
update ingestion.session
set state = 'REJECTED', row_version = row_version + 1,
  updated_at = $2::timestamptz
where ingestion_id = $1::uuid
  and tenant_id = $3::uuid and project_id = $4::uuid
  and state = 'REVIEW_REQUIRED' and row_version = $5::bigint
  and security.security_rank(security_level) <= security.security_rank($6)
  and policy_version <= $7::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning row_version
`;

const INGESTION_BY_OPERATION_LOCK_SQL = `
/* data.operation.ingestion.lock */
select ingestion_id, state, row_version, security_level, policy_version
from ingestion.session
where operation_id = $1::uuid
  and tenant_id = $2::uuid and project_id = $3::uuid
  and security.security_rank(security_level) <= security.security_rank($4)
  and policy_version <= $5::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
for update
`;

const INGESTION_CANCEL_SQL = `
/* data.ingestion.cancel.update */
update ingestion.session
set state = 'CANCELLED', row_version = row_version + 1,
  updated_at = $2::timestamptz
where ingestion_id = $1::uuid
  and tenant_id = $3::uuid and project_id = $4::uuid
  and state = $5 and row_version = $6::bigint
  and security.security_rank(security_level) <= security.security_rank($7)
  and policy_version <= $8::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning ingestion_id, row_version
`;

const REVIEW_INSERT_SQL = `
/* data.ingestion.review.insert */
insert into ingestion.review (
  review_id, tenant_id, project_id, ingestion_id, reviewer_actor_id,
  decision, rationale, conditions, security_level, policy_version,
  row_version, created_at, updated_at
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7,
  $8::jsonb, $9, $10::bigint, 1, $11::timestamptz, $11::timestamptz
)
`;

const REVIEW_CHECKPOINT_LOCK_SQL = `
/* data.ingestion.review-checkpoint.lock */
select transform_plan_id, encode(plan_hash, 'hex') as review_hash, plan,
  row_version, security_level, policy_version
from ingestion.transform_plan
where ingestion_id = $1::uuid
  and tenant_id = $2::uuid and project_id = $3::uuid
  and status = 'REVIEW_REQUIRED'
  and security.security_rank(security_level) <= security.security_rank($4)
  and policy_version <= $5::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
order by plan_version desc
limit 1
for update
`;

const REVIEW_CHECKPOINT_APPROVE_SQL = `
/* data.ingestion.review-checkpoint.approve */
update ingestion.transform_plan
set status = 'APPROVED', approved_by_actor_id = $2::uuid,
  row_version = row_version + 1, updated_at = $3::timestamptz
where transform_plan_id = $1::uuid
  and tenant_id = $4::uuid and project_id = $5::uuid
  and status = 'REVIEW_REQUIRED' and row_version = $6::bigint
  and security.security_rank(security_level) <= security.security_rank($7)
  and policy_version <= $8::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning encode(plan_hash, 'hex') as review_hash
`;

const JOB_INSERT_SQL = `
/* data.ingestion.job.insert */
insert into ingestion.job (
  job_id, tenant_id, project_id, ingestion_id, operation_id, job_type,
  status, idempotency_key, priority, payload, max_attempts,
  backoff_base_seconds, next_attempt_at, timeout_at, security_level,
  policy_version, row_version, created_at, updated_at
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
  'data.ingestion.process', 'PENDING', $6, 100, $7::jsonb, 5, 5,
  $8::timestamptz, $9::timestamptz, $10, $11::bigint, 1,
  $8::timestamptz, $8::timestamptz
)
`;

const JOB_LOCK_SQL = `
/* data.ingestion.job.lock */
select job_id, status, row_version, operation_id, security_level,
  policy_version
from ingestion.job
where ingestion_id = $1::uuid and operation_id = $2::uuid
  and tenant_id = $3::uuid and project_id = $4::uuid
  and job_type = 'data.ingestion.process'
  and security.security_rank(security_level) <= security.security_rank($5)
  and policy_version <= $6::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
for update
`;

const JOB_WAKE_SQL = `
/* data.ingestion.job.wake */
update ingestion.job
set status = 'PENDING', payload = $2::jsonb, next_attempt_at = $3::timestamptz,
  lease_owner = null, lease_expires_at = null, heartbeat_at = null,
  cancel_requested_at = null, completed_at = null,
  timeout_at = $9::timestamptz,
  row_version = row_version + 1, updated_at = $3::timestamptz
where job_id = $1::uuid
  and tenant_id = $4::uuid and project_id = $5::uuid
  and status = 'WAITING_REVIEW' and row_version = $6::bigint
  and security.security_rank(security_level) <= security.security_rank($7)
  and policy_version <= $8::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning row_version
`;

const JOB_REJECT_SQL = `
/* data.ingestion.job.reject.update */
update ingestion.job
set status = 'CANCELLED', cancel_requested_at = $2::timestamptz,
  completed_at = $2::timestamptz, lease_owner = null,
  lease_expires_at = null, heartbeat_at = null,
  row_version = row_version + 1, updated_at = $2::timestamptz
where job_id = $1::uuid
  and tenant_id = $3::uuid and project_id = $4::uuid
  and status = 'WAITING_REVIEW' and row_version = $5::bigint
  and security.security_rank(security_level) <= security.security_rank($6)
  and policy_version <= $7::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning row_version
`;

const JOBS_FOR_OPERATION_LOCK_SQL = `
/* data.operation.jobs.lock */
select job_id, status, row_version, attempt_count, lease_owner,
  lease_expires_at, security_level, policy_version
from ingestion.job
where operation_id = $1::uuid
  and tenant_id = $2::uuid and project_id = $3::uuid
  and security.security_rank(security_level) <= security.security_rank($4)
  and policy_version <= $5::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
order by job_id
for update
`;

const REQUEST_JOB_CANCELLATION_SQL = `
/* data.operation.job-cancellation.request */
select requested.*
from ingestion.request_job_cancellation(
  $1::uuid, $2::uuid, $3::uuid, $4::timestamptz
) as requested
`;

const OPERATION_AFTER_LIFECYCLE_SQL = `
/* data.operation.after-lifecycle.read */
select operation_id, capability_id, status, progress_percent, row_version,
  security_level, policy_version, created_at, updated_at, started_at,
  completed_at, error_code, error_message, error_retryable
from service.operation
where operation_id = $1::uuid
  and tenant_id = $2::uuid and project_id = $3::uuid
  and security.security_rank(security_level) <= security.security_rank($4)
  and policy_version <= $5::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
`;

const OPERATION_LOCK_SQL = `
/* data.operation.lock */
select operation_id, capability_id, status, progress_percent, row_version,
  security_level, policy_version, created_at, updated_at, started_at,
  completed_at, error_code, error_message, error_retryable
from service.operation
where operation_id = $1::uuid
  and tenant_id = $2::uuid and project_id = $3::uuid
  and security.security_rank(security_level) <= security.security_rank($4)
  and policy_version <= $5::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
for update
`;

const OPERATION_SUBMIT_SQL = `
/* data.ingestion.submit.operation.update */
update service.operation
set status = 'RUNNING', started_at = coalesce(started_at, $2::timestamptz),
  updated_at = $2::timestamptz, row_version = row_version + 1
where operation_id = $1::uuid
  and tenant_id = $3::uuid and project_id = $4::uuid
  and status = 'WAITING_INPUT' and row_version = $5::bigint
  and security.security_rank(security_level) <= security.security_rank($6)
  and policy_version <= $7::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning row_version
`;

const OPERATION_APPROVE_SQL = `
/* data.ingestion.approve.operation.update */
update service.operation
set status = 'RUNNING', completed_at = null, error_code = null,
  error_message = null, error_retryable = null,
  updated_at = $2::timestamptz, row_version = row_version + 1
where operation_id = $1::uuid
  and tenant_id = $3::uuid and project_id = $4::uuid
  and status = 'WAITING_REVIEW' and row_version = $5::bigint
  and security.security_rank(security_level) <= security.security_rank($6)
  and policy_version <= $7::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning row_version
`;

const OPERATION_REJECT_SQL = `
/* data.ingestion.reject.operation.update */
update service.operation
set status = 'FAILED', error_code = $2, error_message = $3,
  error_retryable = false, completed_at = $4::timestamptz,
  updated_at = $4::timestamptz, row_version = row_version + 1
where operation_id = $1::uuid
  and tenant_id = $5::uuid and project_id = $6::uuid
  and status = 'WAITING_REVIEW' and row_version = $7::bigint
  and security.security_rank(security_level) <= security.security_rank($8)
  and policy_version <= $9::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning row_version
`;

const OPERATION_CANCEL_SQL = `
/* data.operation.cancel.update */
update service.operation
set status = 'CANCELLED', completed_at = $2::timestamptz,
  updated_at = $2::timestamptz, row_version = row_version + 1
where operation_id = $1::uuid
  and tenant_id = $3::uuid and project_id = $4::uuid
  and status not in ('SUCCEEDED', 'FAILED', 'CANCELLED')
  and row_version = $5::bigint
  and security.security_rank(security_level) <= security.security_rank($6)
  and policy_version <= $7::bigint
  and security.authorized_row(tenant_id, project_id, security_level, policy_version)
returning row_version
`;

export interface PostgresDataCommandQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount?: number | null;
}

export interface PostgresDataCommandClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresDataCommandQueryResult>;
  release(): void;
}

export interface PostgresDataCommandPool {
  connect(): Promise<PostgresDataCommandClient>;
  end(): Promise<void>;
}

export type DataCommandObjectStore = Pick<
  S3AuthorityObjectStore,
  | 'planQuarantinePut'
  | 'planQuarantineMultipart'
  | 'resignQuarantineMultipart'
  | 'completeQuarantineMultipart'
  | 'verifyQuarantineObject'
  | 'abortQuarantineObject'
>;

export type PostgresDataCommandErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_INPUT'
  | 'OWNER_PROJECT_MISMATCH'
  | 'SECURITY_LEVEL_EXCEEDED'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'UPLOAD_SESSION_EXPIRED'
  | 'VERSION_CONFLICT'
  | 'STATE_CONFLICT'
  | 'NOT_FOUND'
  | 'COMMAND_ABORTED'
  | 'OBJECT_STORE_UNAVAILABLE'
  | 'PERSISTENCE_FAILED';

const ERROR_STATUS: Readonly<Record<PostgresDataCommandErrorCode, number>> = {
  INVALID_CONFIGURATION: 500,
  INVALID_INPUT: 422,
  OWNER_PROJECT_MISMATCH: 403,
  SECURITY_LEVEL_EXCEEDED: 403,
  IDEMPOTENCY_KEY_REQUIRED: 422,
  IDEMPOTENCY_CONFLICT: 409,
  UPLOAD_SESSION_EXPIRED: 409,
  VERSION_CONFLICT: 409,
  STATE_CONFLICT: 409,
  NOT_FOUND: 404,
  COMMAND_ABORTED: 408,
  OBJECT_STORE_UNAVAILABLE: 503,
  PERSISTENCE_FAILED: 503,
};

export class PostgresDataCommandError extends Error {
  readonly statusCode: number;

  constructor(readonly code: PostgresDataCommandErrorCode) {
    super(`Data command failed: ${code}.`);
    this.name = 'PostgresDataCommandError';
    this.statusCode = ERROR_STATUS[code];
  }
}

export interface PostgresDataCommandRuntime {
  readonly executors: readonly DataCapabilityExecutor[];
  close(): Promise<void>;
}

export interface PostgresDataCommandRuntimeOptions {
  readonly idFactory?: () => string;
  readonly clock?: () => Date;
  readonly defaultUploadSecurityLevel?: SecurityLevel;
  readonly signedUrlTtlSeconds?: number;
  readonly uploadSessionTtlSeconds?: number;
}

interface StoredAssetPlan {
  readonly assetId: string;
  readonly uploadId: string;
  readonly fileName: string;
  readonly sha256?: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly securityLevel: SecurityLevel;
  readonly method: 'PRESIGNED_PUT' | 'MULTIPART';
  readonly storageKey: string;
  readonly multipartUploadId?: string;
  readonly partSizeBytes?: number;
}

interface CommandOutcome {
  readonly output: unknown;
  readonly replayResult: unknown;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly securityLevel: SecurityLevel;
  readonly rollbackCompensation?: () => Promise<void>;
}

interface StoredCommandLedger {
  readonly capabilityId: DataCapabilityId;
  readonly requestHash: string;
  readonly result: unknown;
}

function commandError(code: PostgresDataCommandErrorCode) {
  return new PostgresDataCommandError(code);
}

function isAssetAlreadyBoundError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return (
    Reflect.get(error, 'code') === '23505' &&
    Reflect.get(error, 'constraint') === 'input_asset_one_ingestion_per_asset'
  );
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}

function requestHash(
  capabilityId: DataCapabilityId,
  input: unknown,
  context: DataCapabilityExecutionContext,
) {
  return createHash('sha256')
    .update(
      canonical({
        capabilityId,
        input,
        actorId: context.principal.actorId,
        tenantId: context.authorization.tenantId,
        projectId: context.authorization.projectId,
      }),
    )
    .digest('hex');
}

function text(row: Readonly<Record<string, unknown>>, key: string): string {
  const value = row[key];
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  throw commandError('PERSISTENCE_FAILED');
}

function optionalText(
  row: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  return text(row, key);
}

function integer(row: Readonly<Record<string, unknown>>, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value)) throw commandError('PERSISTENCE_FAILED');
  return value;
}

function parseStoredPayload(value: unknown) {
  let candidate = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      throw commandError('PERSISTENCE_FAILED');
    }
  }
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate)
  ) {
    throw commandError('PERSISTENCE_FAILED');
  }
  return candidate as Readonly<Record<string, unknown>>;
}

function stringArray(
  row: Readonly<Record<string, unknown>>,
  key: string,
): string[] {
  const value = row[key];
  if (!Array.isArray(value)) throw commandError('PERSISTENCE_FAILED');
  return value.map((entry) => {
    if (typeof entry !== 'string') throw commandError('PERSISTENCE_FAILED');
    return entry;
  });
}

function storedAssets(value: unknown): readonly StoredAssetPlan[] {
  const assets = parseStoredPayload(value)['assets'];
  if (!Array.isArray(assets)) throw commandError('PERSISTENCE_FAILED');
  return assets.map((candidate): StoredAssetPlan => {
    const asset = parseStoredPayload(candidate);
    const method = asset['method'];
    const sha256 = asset['sha256'];
    const multipartUploadId = asset['multipartUploadId'];
    const partSizeBytes = asset['partSizeBytes'];
    if (
      typeof asset['assetId'] !== 'string' ||
      !UUID_PATTERN.test(asset['assetId']) ||
      typeof asset['uploadId'] !== 'string' ||
      !UUID_PATTERN.test(asset['uploadId']) ||
      typeof asset['fileName'] !== 'string' ||
      asset['fileName'].length < 1 ||
      (sha256 !== undefined &&
        (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256))) ||
      typeof asset['sizeBytes'] !== 'number' ||
      !Number.isSafeInteger(asset['sizeBytes']) ||
      asset['sizeBytes'] < 1 ||
      typeof asset['contentType'] !== 'string' ||
      typeof asset['storageKey'] !== 'string' ||
      !Object.hasOwn(SECURITY_RANK, String(asset['securityLevel'])) ||
      (method !== 'PRESIGNED_PUT' && method !== 'MULTIPART') ||
      (multipartUploadId !== undefined &&
        typeof multipartUploadId !== 'string') ||
      (partSizeBytes !== undefined &&
        (typeof partSizeBytes !== 'number' ||
          !Number.isSafeInteger(partSizeBytes)))
    ) {
      throw commandError('PERSISTENCE_FAILED');
    }
    return {
      assetId: asset['assetId'],
      uploadId: asset['uploadId'],
      fileName: asset['fileName'],
      ...(sha256 === undefined ? {} : { sha256 }),
      sizeBytes: asset['sizeBytes'],
      contentType: asset['contentType'],
      securityLevel: asset['securityLevel'] as SecurityLevel,
      method,
      storageKey: asset['storageKey'],
      ...(multipartUploadId === undefined ? {} : { multipartUploadId }),
      ...(partSizeBytes === undefined ? {} : { partSizeBytes }),
    };
  });
}

function now(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw commandError('INVALID_CONFIGURATION');
  }
  return value.toISOString();
}

function nextId(factory: () => string): string {
  const value = factory();
  if (!UUID_PATTERN.test(value)) throw commandError('INVALID_CONFIGURATION');
  return value;
}

function assertActive(context: DataCapabilityExecutionContext): void {
  if (context.signal.aborted) throw commandError('COMMAND_ABORTED');
}

function commandKey(context: DataCapabilityExecutionContext): string {
  if (
    context.idempotencyKey === undefined ||
    !UUID_PATTERN.test(context.idempotencyKey)
  ) {
    throw commandError('IDEMPOTENCY_KEY_REQUIRED');
  }
  return context.idempotencyKey;
}

function assertOwner(
  ownerProjectId: string,
  context: DataCapabilityExecutionContext,
): void {
  if (ownerProjectId !== context.authorization.projectId) {
    throw commandError('OWNER_PROJECT_MISMATCH');
  }
}

function assertSecurity(
  securityLevel: SecurityLevel,
  context: DataCapabilityExecutionContext,
): void {
  if (
    SECURITY_RANK[securityLevel] >
    SECURITY_RANK[context.effectiveMaxSecurityLevel]
  ) {
    throw commandError('SECURITY_LEVEL_EXCEEDED');
  }
}

function maximumSecurity(...levels: readonly SecurityLevel[]): SecurityLevel {
  let result: SecurityLevel = 'L0_PUBLIC';
  for (const level of levels) {
    if (SECURITY_RANK[level] > SECURITY_RANK[result]) result = level;
  }
  return result;
}

function affected(result: PostgresDataCommandQueryResult): number {
  if (result.rowCount === null || result.rowCount === undefined) {
    throw commandError('PERSISTENCE_FAILED');
  }
  return result.rowCount;
}

function exactlyOne(result: PostgresDataCommandQueryResult): void {
  if (affected(result) !== 1) throw commandError('PERSISTENCE_FAILED');
}

function singleRow(
  result: PostgresDataCommandQueryResult,
): Readonly<Record<string, unknown>> | undefined {
  if (affected(result) !== result.rows.length || result.rows.length > 1) {
    throw commandError('PERSISTENCE_FAILED');
  }
  return result.rows[0];
}

function operation(
  operationId: string,
  capabilityId: DataCapabilityId,
  status: OperationDto['status'],
  timestamp: string,
  context: DataCapabilityExecutionContext,
  version = 1,
  progressPercent = status === 'SUCCEEDED' ? 100 : 0,
): OperationDto {
  return {
    operationId,
    tenantId: context.authorization.tenantId,
    projectId: context.authorization.projectId,
    capabilityId,
    status,
    resource: `operation://${operationId}`,
    progressPercent,
    version,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(status === 'RUNNING' ||
    ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status)
      ? { startedAt: timestamp }
      : {}),
    ...(status === 'SUCCEEDED' || status === 'CANCELLED'
      ? { completedAt: timestamp }
      : {}),
  };
}

function operationFromLocked(
  row: Readonly<Record<string, unknown>>,
  status: OperationDto['status'],
  timestamp: string,
  context: DataCapabilityExecutionContext,
  version: number,
): OperationDto {
  const operationId = text(row, 'operation_id');
  const startedAt = optionalText(row, 'started_at');
  return {
    operationId,
    tenantId: context.authorization.tenantId,
    projectId: context.authorization.projectId,
    capabilityId: text(row, 'capability_id'),
    status,
    resource: `operation://${operationId}`,
    progressPercent: integer(row, 'progress_percent'),
    version,
    createdAt: text(row, 'created_at'),
    updatedAt: timestamp,
    ...([
      'RUNNING',
      'WAITING_REVIEW',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
    ].includes(status)
      ? { startedAt: startedAt ?? timestamp }
      : {}),
    ...(status === 'CANCELLED' ? { completedAt: timestamp } : {}),
  };
}

function multipartPartSize(sizeBytes: number): number {
  const minimumForPartLimit = Math.ceil(sizeBytes / MAX_MULTIPART_PARTS);
  const unrounded = Math.max(
    MIN_MULTIPART_PART_SIZE,
    PREFERRED_MULTIPART_PART_SIZE,
    minimumForPartLimit,
  );
  const mebibyte = 1024 * 1024;
  const rounded = Math.ceil(unrounded / mebibyte) * mebibyte;
  if (rounded > MAX_MULTIPART_PART_SIZE) throw commandError('INVALID_INPUT');
  return rounded;
}

function parseEpsg(value: string): number {
  const match = /^EPSG:([1-9][0-9]{0,5})$/i.exec(value);
  const srid = Number(match?.[1]);
  if (!Number.isSafeInteger(srid) || srid < 1 || srid > 999_999) {
    throw commandError('INVALID_INPUT');
  }
  return srid;
}

function statementTimeout(context: DataCapabilityExecutionContext): string {
  if (!Number.isSafeInteger(context.timeoutMs) || context.timeoutMs < 1) {
    throw commandError('INVALID_CONFIGURATION');
  }
  return `${Math.min(context.timeoutMs, 120_000)}ms`;
}

class CommandTransactions {
  constructor(
    readonly pool: PostgresDataCommandPool,
    readonly idFactory: () => string,
    readonly clock: () => Date,
  ) {}

  async query(
    client: PostgresDataCommandClient,
    context: DataCapabilityExecutionContext,
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<PostgresDataCommandQueryResult> {
    assertActive(context);
    const result = await client.query(sql, values);
    assertActive(context);
    return result;
  }

  async run(
    capabilityId: DataCapabilityId,
    input: unknown,
    context: DataCapabilityExecutionContext,
    action: (
      client: PostgresDataCommandClient,
      timestamp: string,
      idempotencyKey: string,
      hash: string,
    ) => Promise<CommandOutcome>,
    replay?: (
      client: PostgresDataCommandClient,
      timestamp: string,
      ledger: StoredCommandLedger,
    ) => Promise<unknown>,
  ): Promise<unknown> {
    const idempotencyKey = commandKey(context);
    const hash = requestHash(capabilityId, input, context);
    const timestamp = now(this.clock);
    assertActive(context);
    const client = await this.pool.connect();
    let began = false;
    let commitAttempted = false;
    let outcome: CommandOutcome | undefined;
    try {
      await this.query(client, context, 'begin');
      began = true;
      exactlyOne(
        await this.query(client, context, SET_SCOPE_SQL, [
          context.authorization.tenantId,
          context.authorization.projectId,
          context.effectiveMaxSecurityLevel,
          String(context.authorization.authzVersion),
          statementTimeout(context),
        ]),
      );
      exactlyOne(
        await this.query(client, context, IDEMPOTENCY_LOCK_SQL, [
          idempotencyKey,
        ]),
      );
      const previous = await this.query(client, context, IDEMPOTENCY_READ_SQL, [
        idempotencyKey,
        context.authorization.tenantId,
        context.authorization.projectId,
        context.effectiveMaxSecurityLevel,
        context.authorization.authzVersion,
      ]);
      const previousRow = singleRow(previous);
      if (previousRow !== undefined) {
        const payload = parseStoredPayload(previousRow['payload']);
        if (
          payload['requestHash'] !== hash ||
          payload['capabilityId'] !== capabilityId
        ) {
          throw commandError('IDEMPOTENCY_CONFLICT');
        }
        const ledger: StoredCommandLedger = {
          capabilityId,
          requestHash: hash,
          result: payload['result'],
        };
        let value: unknown;
        if (replay === undefined) {
          const parsed = DATA_CAPABILITY_REGISTRY[
            capabilityId
          ].outputSchema.safeParse(ledger.result);
          if (!parsed.success) throw commandError('PERSISTENCE_FAILED');
          value = parsed.data;
        } else {
          value = await replay(client, timestamp, ledger);
        }
        commitAttempted = true;
        await this.query(client, context, 'commit');
        return value;
      }

      outcome = await action(client, timestamp, idempotencyKey, hash);
      const parsedOutput = DATA_CAPABILITY_REGISTRY[
        capabilityId
      ].outputSchema.safeParse(outcome.output);
      if (!parsedOutput.success) throw commandError('PERSISTENCE_FAILED');
      const safePayload = {
        schemaVersion: 1,
        capabilityId,
        requestHash: hash,
        result: outcome.replayResult,
      };
      exactlyOne(
        await this.query(client, context, AUDIT_INSERT_SQL, [
          context.authorization.tenantId,
          context.authorization.projectId,
          nextId(this.idFactory),
          context.principal.actorId,
          capabilityId,
          'data-command',
          outcome.aggregateId,
          context.authorization.purpose,
          context.traceId,
          hash,
          outcome.securityLevel,
          context.authorization.authzVersion,
          timestamp,
        ]),
      );
      exactlyOne(
        await this.query(client, context, OUTBOX_INSERT_SQL, [
          context.authorization.tenantId,
          context.authorization.projectId,
          outcome.aggregateId,
          outcome.eventType,
          JSON.stringify(safePayload),
          context.traceId,
          idempotencyKey,
          outcome.securityLevel,
          context.authorization.authzVersion,
          timestamp,
        ]),
      );
      commitAttempted = true;
      await this.query(client, context, 'commit');
      return parsedOutput.data;
    } catch (error) {
      if (began) {
        try {
          await client.query('rollback');
        } catch {
          // Preserve only the sanitized command error below.
        }
      }
      if (!commitAttempted && outcome?.rollbackCompensation !== undefined) {
        try {
          await outcome.rollbackCompensation();
        } catch {
          // Compensation is best effort and object-store details stay private.
        }
      }
      if (error instanceof PostgresDataCommandError) throw error;
      if (isAssetAlreadyBoundError(error)) throw commandError('STATE_CONFLICT');
      throw commandError('PERSISTENCE_FAILED');
    } finally {
      client.release();
    }
  }

  async insertOperation(
    client: PostgresDataCommandClient,
    value: OperationDto,
    context: DataCapabilityExecutionContext,
    idempotencyKey: string,
    requestPayload: unknown,
    resultPayload: unknown,
    securityLevel: SecurityLevel,
    timestamp: string,
  ): Promise<void> {
    exactlyOne(
      await this.query(client, context, OPERATION_INSERT_SQL, [
        value.operationId,
        context.authorization.tenantId,
        context.authorization.projectId,
        value.capabilityId,
        context.principal.actorId,
        value.status,
        value.progressPercent,
        idempotencyKey,
        JSON.stringify(requestPayload),
        resultPayload === null ? null : JSON.stringify(resultPayload),
        securityLevel,
        context.authorization.authzVersion,
        timestamp,
      ]),
    );
    await this.appendOperationEvent(
      client,
      value.operationId,
      null,
      value.status,
      value.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'CREATED',
      value.progressPercent,
      securityLevel,
      context,
      timestamp,
    );
  }

  async appendOperationEvent(
    client: PostgresDataCommandClient,
    operationId: string,
    fromStatus: string | null,
    toStatus: string,
    eventType: string,
    progressPercent: number,
    securityLevel: SecurityLevel,
    context: DataCapabilityExecutionContext,
    timestamp: string,
  ): Promise<void> {
    exactlyOne(
      await this.query(client, context, OPERATION_EVENT_INSERT_SQL, [
        context.authorization.tenantId,
        context.authorization.projectId,
        operationId,
        nextId(this.idFactory),
        fromStatus,
        toStatus,
        eventType,
        JSON.stringify({ progressPercent }),
        securityLevel,
        context.effectiveMaxSecurityLevel,
        context.authorization.authzVersion,
        timestamp,
      ]),
    );
  }
}

function define(
  id: DataCapabilityId,
  execute: DataCapabilityExecutor['execute'],
): DataCapabilityExecutor {
  return Object.freeze({ id, execute });
}

function boundedSeconds(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw commandError('INVALID_CONFIGURATION');
  }
  return resolved;
}

async function objectStoreCall<T>(
  context: DataCapabilityExecutionContext,
  action: () => Promise<T>,
): Promise<T> {
  assertActive(context);
  try {
    const result = await action();
    assertActive(context);
    return result;
  } catch (error) {
    if (error instanceof PostgresDataCommandError) throw error;
    if (context.signal.aborted) throw commandError('COMMAND_ABORTED');
    throw commandError('OBJECT_STORE_UNAVAILABLE');
  }
}

function scopeValues(context: DataCapabilityExecutionContext) {
  return [
    context.authorization.tenantId,
    context.authorization.projectId,
    context.effectiveMaxSecurityLevel,
    context.authorization.authzVersion,
  ] as const;
}

function uploadSessionFromStored(
  operationId: string,
  requestPayload: unknown,
  assetIds: readonly string[],
  context: DataCapabilityExecutionContext,
  status: UploadSessionDto['status'],
  version: number,
  completedAt?: string,
): UploadSessionDto {
  const payload = parseStoredPayload(requestPayload);
  const expiresAt = payload['expiresAt'];
  const createdAt = payload['createdAt'];
  if (typeof expiresAt !== 'string' || typeof createdAt !== 'string') {
    throw commandError('PERSISTENCE_FAILED');
  }
  return {
    uploadSessionId: operationId,
    tenantId: context.authorization.tenantId,
    projectId: context.authorization.projectId,
    status,
    assetIds: [...assetIds],
    version,
    expiresAt,
    createdAt,
    ...(completedAt === undefined ? {} : { completedAt }),
  };
}

function assertSessionOpen(
  row: Readonly<Record<string, unknown>>,
  timestamp: string,
): void {
  if (text(row, 'status') !== 'WAITING_INPUT') {
    throw commandError('STATE_CONFLICT');
  }
  const expiresAt = parseStoredPayload(row['request_payload'])['expiresAt'];
  if (
    typeof expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw commandError('PERSISTENCE_FAILED');
  }
  if (Date.parse(expiresAt) <= Date.parse(timestamp)) {
    throw commandError('UPLOAD_SESSION_EXPIRED');
  }
}

async function signStoredAssets(
  objectStore: DataCommandObjectStore,
  assets: readonly StoredAssetPlan[],
  context: DataCapabilityExecutionContext,
  signedUrlTtlSeconds: number,
): Promise<readonly unknown[]> {
  const targets: unknown[] = [];
  for (const asset of assets) {
    const common = {
      tenantId: context.authorization.tenantId,
      projectId: context.authorization.projectId,
      uploadId: asset.uploadId,
      sizeBytes: asset.sizeBytes,
      contentType: asset.contentType,
      signal: context.signal,
      ...(asset.sha256 === undefined ? {} : { sha256: asset.sha256 }),
    };
    if (asset.method === 'PRESIGNED_PUT') {
      const plan = await objectStoreCall(context, () =>
        objectStore.planQuarantinePut({
          ...common,
          ttlSeconds: signedUrlTtlSeconds,
        }),
      );
      if (plan.key !== asset.storageKey) {
        throw commandError('OBJECT_STORE_UNAVAILABLE');
      }
      targets.push({
        assetId: asset.assetId,
        method: 'PRESIGNED_PUT',
        uploadUrl: plan.url,
        headers: plan.requiredHeaders,
      });
      continue;
    }
    if (
      asset.multipartUploadId === undefined ||
      asset.partSizeBytes === undefined
    ) {
      throw commandError('PERSISTENCE_FAILED');
    }
    const plan = await objectStoreCall(context, () =>
      objectStore.resignQuarantineMultipart({
        ...common,
        multipartUploadId: asset.multipartUploadId!,
        partSizeBytes: asset.partSizeBytes!,
        ttlSeconds: signedUrlTtlSeconds,
      }),
    );
    if (
      plan.key !== asset.storageKey ||
      plan.uploadId !== asset.multipartUploadId
    ) {
      throw commandError('OBJECT_STORE_UNAVAILABLE');
    }
    targets.push({
      assetId: asset.assetId,
      method: 'MULTIPART',
      headers: {},
      multipartUploadId: plan.uploadId,
      partSizeBytes: asset.partSizeBytes,
      parts: plan.parts.map((part) => ({
        partNumber: part.partNumber,
        sizeBytes: part.sizeBytes,
        uploadUrl: part.url,
        expiresAt: part.expiresAt,
      })),
    });
  }
  return targets;
}

async function lockOperation(
  transactions: CommandTransactions,
  client: PostgresDataCommandClient,
  operationId: string,
  context: DataCapabilityExecutionContext,
) {
  const result = await transactions.query(client, context, OPERATION_LOCK_SQL, [
    operationId,
    ...scopeValues(context),
  ]);
  const row = singleRow(result);
  if (row === undefined) throw commandError('NOT_FOUND');
  return row;
}

async function lockIngestion(
  transactions: CommandTransactions,
  client: PostgresDataCommandClient,
  ingestionId: string,
  expectedVersion: number,
  expectedState: string,
  context: DataCapabilityExecutionContext,
) {
  const result = await transactions.query(client, context, INGESTION_LOCK_SQL, [
    ingestionId,
    ...scopeValues(context),
  ]);
  const row = singleRow(result);
  if (row === undefined) throw commandError('NOT_FOUND');
  if (integer(row, 'row_version') !== expectedVersion) {
    throw commandError('VERSION_CONFLICT');
  }
  if (text(row, 'state') !== expectedState) {
    throw commandError('STATE_CONFLICT');
  }
  const assets = await transactions.query(
    client,
    context,
    INGESTION_ASSET_IDS_SQL,
    [ingestionId, ...scopeValues(context)],
  );
  if (affected(assets) !== assets.rows.length || assets.rows.length < 1) {
    throw commandError('PERSISTENCE_FAILED');
  }
  return {
    row,
    assetIds: assets.rows.map((asset) => text(asset, 'asset_id')),
  };
}

async function lockPipelineJob(
  transactions: CommandTransactions,
  client: PostgresDataCommandClient,
  ingestionId: string,
  operationId: string,
  context: DataCapabilityExecutionContext,
) {
  const result = await transactions.query(client, context, JOB_LOCK_SQL, [
    ingestionId,
    operationId,
    ...scopeValues(context),
  ]);
  const row = singleRow(result);
  if (row === undefined) throw commandError('NOT_FOUND');
  return row;
}

export function createPostgresDataCommandRuntime(
  pool: PostgresDataCommandPool,
  objectStore: DataCommandObjectStore,
  options: PostgresDataCommandRuntimeOptions = {},
): PostgresDataCommandRuntime {
  if (
    pool === null ||
    typeof pool?.connect !== 'function' ||
    typeof pool.end !== 'function' ||
    objectStore === null ||
    typeof objectStore?.planQuarantinePut !== 'function' ||
    typeof objectStore.planQuarantineMultipart !== 'function' ||
    typeof objectStore.resignQuarantineMultipart !== 'function' ||
    typeof objectStore.completeQuarantineMultipart !== 'function' ||
    typeof objectStore.verifyQuarantineObject !== 'function' ||
    typeof objectStore.abortQuarantineObject !== 'function'
  ) {
    throw commandError('INVALID_CONFIGURATION');
  }
  const idFactory = options.idFactory ?? randomUUID;
  const clock = options.clock ?? (() => new Date());
  const defaultUploadSecurityLevel =
    options.defaultUploadSecurityLevel ?? 'L1_INTERNAL';
  if (!Object.hasOwn(SECURITY_RANK, defaultUploadSecurityLevel)) {
    throw commandError('INVALID_CONFIGURATION');
  }
  const signedUrlTtlSeconds = boundedSeconds(
    options.signedUrlTtlSeconds,
    DEFAULT_SIGNED_URL_TTL_SECONDS,
    60,
    900,
  );
  const uploadSessionTtlSeconds = boundedSeconds(
    options.uploadSessionTtlSeconds,
    DEFAULT_UPLOAD_SESSION_TTL_SECONDS,
    signedUrlTtlSeconds,
    86_400,
  );
  const transactions = new CommandTransactions(pool, idFactory, clock);

  const executors = Object.freeze([
    define('data.catalog.create', async (raw, context) => {
      const input = CreateDataItemInputSchema.parse(raw);
      assertOwner(input.ownerProjectId, context);
      assertSecurity(input.securityLevel, context);
      let spatialReference: number | undefined;
      if (input.spatialExtent !== undefined) {
        spatialReference = parseEpsg(input.spatialExtent.crs);
        if (
          input.sourceCrs !== undefined &&
          input.sourceCrs.toUpperCase() !==
            input.spatialExtent.crs.toUpperCase()
        ) {
          throw commandError('INVALID_INPUT');
        }
        if (
          input.canonicalCrs !== undefined &&
          input.canonicalCrs.toUpperCase() !== 'EPSG:4490'
        ) {
          throw commandError('INVALID_INPUT');
        }
      }
      return transactions.run(
        'data.catalog.create',
        input,
        context,
        async (client, timestamp, key) => {
          const dataItemId = nextId(idFactory);
          const item: DataItemDto = {
            tenantId: context.authorization.tenantId,
            dataItemId,
            ...input,
            qualityGrade: 'C',
            acceptanceStatus: 'PENDING',
            publicationStatus: 'UNPUBLISHED',
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          exactlyOne(
            await transactions.query(client, context, CATALOG_INSERT_SQL, [
              dataItemId,
              context.authorization.tenantId,
              context.authorization.projectId,
              input.name,
              input.businessDomains,
              input.sourceNatures,
              input.sourceChannels,
              input.processingStage,
              input.intendedUses,
              input.sourceOrganization,
              JSON.stringify(input.sourceContact ?? null),
              input.authorizationScope,
              input.citationRequirements,
              input.sourceCrs ?? input.spatialExtent?.crs ?? null,
              input.canonicalCrs ??
                (input.spatialExtent === undefined ? null : 'EPSG:4490'),
              input.timezone ?? null,
              input.temporalResolution ?? null,
              input.schemaVersionId ?? null,
              JSON.stringify(input.unitDefinitions),
              JSON.stringify(input.missingValueRules),
              JSON.stringify(input.anomalyRules),
              input.generationMethod,
              input.securityLevel,
              input.updateMode,
              context.authorization.authzVersion,
              timestamp,
            ]),
          );
          if (input.spatialExtent !== undefined) {
            const [minX, minY, maxX, maxY] = input.spatialExtent.bbox;
            exactlyOne(
              await transactions.query(
                client,
                context,
                CATALOG_SPATIAL_INSERT_SQL,
                [
                  nextId(idFactory),
                  context.authorization.tenantId,
                  context.authorization.projectId,
                  dataItemId,
                  minX,
                  minY,
                  maxX,
                  maxY,
                  spatialReference,
                  input.spatialExtent.crs,
                  input.securityLevel,
                  context.authorization.authzVersion,
                  timestamp,
                ],
              ),
            );
          }
          if (input.temporalExtent !== undefined) {
            exactlyOne(
              await transactions.query(
                client,
                context,
                CATALOG_TEMPORAL_INSERT_SQL,
                [
                  nextId(idFactory),
                  context.authorization.tenantId,
                  context.authorization.projectId,
                  dataItemId,
                  input.temporalExtent.start,
                  input.temporalExtent.end,
                  input.timezone ?? 'Etc/UTC',
                  input.temporalResolution ?? null,
                  input.securityLevel,
                  context.authorization.authzVersion,
                  timestamp,
                ],
              ),
            );
          }
          const output = { item };
          const commandOperation = operation(
            nextId(idFactory),
            'data.catalog.create',
            'SUCCEEDED',
            timestamp,
            context,
          );
          await transactions.insertOperation(
            client,
            commandOperation,
            context,
            key,
            input,
            output,
            input.securityLevel,
            timestamp,
          );
          return {
            output,
            replayResult: output,
            aggregateId: dataItemId,
            eventType: 'data.catalog-draft.created',
            securityLevel: input.securityLevel,
          };
        },
      );
    }),

    define('data.uploadSession.create', async (raw, context) => {
      const input = CreateUploadSessionInputSchema.parse(raw);
      assertOwner(input.ownerProjectId, context);
      assertSecurity(defaultUploadSecurityLevel, context);
      return transactions.run(
        'data.uploadSession.create',
        input,
        context,
        async (client, timestamp, key) => {
          const uploadSessionId = nextId(idFactory);
          const stored: StoredAssetPlan[] = [];
          const targets: unknown[] = [];
          try {
            for (const object of input.objects) {
              const assetId = nextId(idFactory);
              const common = {
                tenantId: context.authorization.tenantId,
                projectId: context.authorization.projectId,
                uploadId: assetId,
                sizeBytes: object.sizeBytes,
                contentType: object.mediaType,
                signal: context.signal,
                ...(object.sha256 === undefined
                  ? {}
                  : { sha256: object.sha256 }),
              };
              const multipart =
                input.preferredMode === 'MULTIPART' ||
                object.sizeBytes > MAX_SINGLE_PUT_SIZE;
              if (multipart) {
                const partSizeBytes = multipartPartSize(object.sizeBytes);
                const plan = await objectStoreCall(context, () =>
                  objectStore.planQuarantineMultipart({
                    ...common,
                    partSizeBytes,
                    ttlSeconds: signedUrlTtlSeconds,
                  }),
                );
                stored.push({
                  assetId,
                  uploadId: assetId,
                  fileName: object.fileName,
                  ...(object.sha256 === undefined
                    ? {}
                    : { sha256: object.sha256 }),
                  sizeBytes: object.sizeBytes,
                  contentType: object.mediaType,
                  securityLevel: defaultUploadSecurityLevel,
                  method: 'MULTIPART',
                  storageKey: plan.key,
                  multipartUploadId: plan.uploadId,
                  partSizeBytes,
                });
                targets.push({
                  assetId,
                  method: 'MULTIPART',
                  headers: {},
                  multipartUploadId: plan.uploadId,
                  partSizeBytes,
                  parts: plan.parts.map((part) => ({
                    partNumber: part.partNumber,
                    sizeBytes: part.sizeBytes,
                    uploadUrl: part.url,
                    expiresAt: part.expiresAt,
                  })),
                });
              } else {
                const plan = await objectStoreCall(context, () =>
                  objectStore.planQuarantinePut({
                    ...common,
                    ttlSeconds: signedUrlTtlSeconds,
                  }),
                );
                stored.push({
                  assetId,
                  uploadId: assetId,
                  fileName: object.fileName,
                  ...(object.sha256 === undefined
                    ? {}
                    : { sha256: object.sha256 }),
                  sizeBytes: object.sizeBytes,
                  contentType: object.mediaType,
                  securityLevel: defaultUploadSecurityLevel,
                  method: 'PRESIGNED_PUT',
                  storageKey: plan.key,
                });
                targets.push({
                  assetId,
                  method: 'PRESIGNED_PUT',
                  uploadUrl: plan.url,
                  headers: plan.requiredHeaders,
                });
              }
            }
            const expiresAt = new Date(
              Date.parse(timestamp) + uploadSessionTtlSeconds * 1_000,
            ).toISOString();
            const uploadSession: UploadSessionDto = {
              uploadSessionId,
              tenantId: context.authorization.tenantId,
              projectId: context.authorization.projectId,
              status: 'OPEN',
              assetIds: stored.map(({ assetId }) => assetId),
              version: 1,
              expiresAt,
              createdAt: timestamp,
            };
            const output = { uploadSession, uploadTargets: targets };
            await transactions.insertOperation(
              client,
              operation(
                uploadSessionId,
                'data.uploadSession.create',
                'WAITING_INPUT',
                timestamp,
                context,
              ),
              context,
              key,
              {
                assets: stored,
                expiresAt,
                createdAt: timestamp,
                securityLevel: defaultUploadSecurityLevel,
              },
              { uploadSession },
              defaultUploadSecurityLevel,
              timestamp,
            );
            return {
              output,
              replayResult: { uploadSession },
              aggregateId: uploadSessionId,
              eventType: 'data.upload-session.created',
              securityLevel: defaultUploadSecurityLevel,
              rollbackCompensation: async () => {
                await Promise.allSettled(
                  stored.map((asset) =>
                    objectStore.abortQuarantineObject({
                      tenantId: context.authorization.tenantId,
                      projectId: context.authorization.projectId,
                      uploadId: asset.uploadId,
                      sizeBytes: asset.sizeBytes,
                      contentType: asset.contentType,
                      ...(asset.sha256 === undefined
                        ? {}
                        : { sha256: asset.sha256 }),
                      ...(asset.multipartUploadId === undefined
                        ? {}
                        : { multipartUploadId: asset.multipartUploadId }),
                    }),
                  ),
                );
              },
            };
          } catch (error) {
            await Promise.allSettled(
              stored.map((asset) =>
                objectStore.abortQuarantineObject({
                  tenantId: context.authorization.tenantId,
                  projectId: context.authorization.projectId,
                  uploadId: asset.uploadId,
                  sizeBytes: asset.sizeBytes,
                  contentType: asset.contentType,
                  ...(asset.sha256 === undefined
                    ? {}
                    : { sha256: asset.sha256 }),
                  ...(asset.multipartUploadId === undefined
                    ? {}
                    : { multipartUploadId: asset.multipartUploadId }),
                }),
              ),
            );
            throw error;
          }
        },
        async (client, timestamp, ledger) => {
          const result = parseStoredPayload(ledger.result);
          const safeSession = parseStoredPayload(result['uploadSession']);
          const uploadSessionId = safeSession['uploadSessionId'];
          if (
            typeof uploadSessionId !== 'string' ||
            !UUID_PATTERN.test(uploadSessionId)
          ) {
            throw commandError('PERSISTENCE_FAILED');
          }
          const locked = await transactions.query(
            client,
            context,
            UPLOAD_LOCK_SQL,
            [uploadSessionId, ...scopeValues(context)],
          );
          const row = singleRow(locked);
          if (row === undefined) throw commandError('NOT_FOUND');
          assertSessionOpen(row, timestamp);
          const assets = storedAssets(row['request_payload']);
          const uploadSession = uploadSessionFromStored(
            uploadSessionId,
            row['request_payload'],
            assets.map(({ assetId }) => assetId),
            context,
            'OPEN',
            integer(row, 'row_version'),
          );
          const uploadTargets = await signStoredAssets(
            objectStore,
            assets,
            context,
            signedUrlTtlSeconds,
          );
          const replayOutput = { uploadSession, uploadTargets };
          const parsed =
            DATA_CAPABILITY_REGISTRY[
              'data.uploadSession.create'
            ].outputSchema.safeParse(replayOutput);
          if (!parsed.success) throw commandError('PERSISTENCE_FAILED');
          return parsed.data;
        },
      );
    }),

    define('data.uploadSession.complete', async (raw, context) => {
      const input = CompleteUploadSessionInputSchema.parse(raw);
      return transactions.run(
        'data.uploadSession.complete',
        input,
        context,
        async (client, timestamp) => {
          const locked = await transactions.query(
            client,
            context,
            UPLOAD_LOCK_SQL,
            [input.uploadSessionId, ...scopeValues(context)],
          );
          const row = singleRow(locked);
          if (row === undefined) throw commandError('NOT_FOUND');
          if (integer(row, 'row_version') !== input.expectedVersion) {
            throw commandError('VERSION_CONFLICT');
          }
          assertSessionOpen(row, timestamp);
          const assets = storedAssets(row['request_payload']);
          const requestedIds = new Set(
            input.objects.map(({ assetId }) => assetId),
          );
          if (
            assets.length !== input.objects.length ||
            requestedIds.size !== input.objects.length ||
            assets.some(({ assetId }) => !requestedIds.has(assetId))
          ) {
            throw commandError('INVALID_INPUT');
          }
          let commandSecurity = text(row, 'security_level') as SecurityLevel;
          assertSecurity(commandSecurity, context);

          const completedById = new Map(
            input.objects.map((completed) => [completed.assetId, completed]),
          );
          for (const asset of assets) {
            const completed = completedById.get(asset.assetId);
            if (
              completed === undefined ||
              completed.sizeBytes !== asset.sizeBytes ||
              (asset.sha256 !== undefined && completed.sha256 !== asset.sha256)
            ) {
              throw commandError('INVALID_INPUT');
            }
            const authorityInput = {
              tenantId: context.authorization.tenantId,
              projectId: context.authorization.projectId,
              uploadId: asset.uploadId,
              sha256: completed.sha256,
              sizeBytes: asset.sizeBytes,
              contentType: asset.contentType,
              signal: context.signal,
            };
            if (asset.method === 'MULTIPART') {
              if (
                asset.multipartUploadId === undefined ||
                completed.multipartUploadId !== asset.multipartUploadId ||
                completed.parts === undefined
              ) {
                throw commandError('INVALID_INPUT');
              }
              try {
                await objectStoreCall(context, () =>
                  objectStore.completeQuarantineMultipart({
                    ...authorityInput,
                    multipartUploadId: asset.multipartUploadId!,
                    parts: completed.parts!,
                  }),
                );
              } catch (error) {
                if (
                  error instanceof PostgresDataCommandError &&
                  error.code === 'COMMAND_ABORTED'
                ) {
                  throw error;
                }
                try {
                  await objectStoreCall(context, () =>
                    objectStore.verifyQuarantineObject({
                      ...authorityInput,
                      allowMissingSha256Metadata: asset.sha256 === undefined,
                      ...(completed.etag === undefined
                        ? {}
                        : { expectedEtag: completed.etag }),
                    }),
                  );
                } catch {
                  throw commandError('OBJECT_STORE_UNAVAILABLE');
                }
              }
            }
            await objectStoreCall(context, () =>
              objectStore.verifyQuarantineObject({
                ...authorityInput,
                allowMissingSha256Metadata: asset.sha256 === undefined,
                ...(completed.etag === undefined
                  ? {}
                  : { expectedEtag: completed.etag }),
              }),
            );
          }

          for (const asset of assets) {
            const classification = maximumSecurity(
              commandSecurity,
              asset.securityLevel,
            );
            assertSecurity(classification, context);
            const inserted = singleRow(
              await transactions.query(client, context, ASSET_INSERT_SQL, [
                asset.assetId,
                context.authorization.tenantId,
                context.authorization.projectId,
                asset.storageKey,
                asset.contentType,
                asset.sizeBytes,
                classification,
                context.authorization.authzVersion,
                timestamp,
              ]),
            );
            if (
              inserted === undefined ||
              text(inserted, 'asset_id') !== asset.assetId ||
              inserted['content_hash'] !== null ||
              inserted['content_blob_id'] !== null
            ) {
              throw commandError('PERSISTENCE_FAILED');
            }
            commandSecurity = maximumSecurity(commandSecurity, classification);
          }

          const uploadSession = uploadSessionFromStored(
            input.uploadSessionId,
            row['request_payload'],
            assets.map(({ assetId }) => assetId),
            context,
            'COMPLETED',
            input.expectedVersion + 1,
            timestamp,
          );
          const output = { uploadSession };
          exactlyOne(
            await transactions.query(client, context, UPLOAD_COMPLETE_SQL, [
              input.uploadSessionId,
              JSON.stringify(output),
              timestamp,
              context.authorization.tenantId,
              context.authorization.projectId,
              input.expectedVersion,
              context.effectiveMaxSecurityLevel,
              context.authorization.authzVersion,
              commandSecurity,
              JSON.stringify(
                input.objects.map(({ assetId, sha256 }) => ({
                  assetId,
                  claimedSha256: sha256,
                })),
              ),
            ]),
          );
          await transactions.appendOperationEvent(
            client,
            input.uploadSessionId,
            'WAITING_INPUT',
            'SUCCEEDED',
            'SUCCEEDED',
            100,
            commandSecurity,
            context,
            timestamp,
          );
          return {
            output,
            replayResult: output,
            aggregateId: input.uploadSessionId,
            eventType: 'data.upload-session.completed',
            securityLevel: commandSecurity,
          };
        },
      );
    }),

    define('data.ingestion.create', async (raw, context) => {
      const input = CreateIngestionInputSchema.parse(raw);
      assertOwner(input.ownerProjectId, context);
      assertSecurity(input.requestedSecurityLevel, context);
      return transactions.run(
        'data.ingestion.create',
        input,
        context,
        async (client, timestamp, key) => {
          const assetRows = await transactions.query(
            client,
            context,
            ASSETS_LOCK_SQL,
            [input.assetIds, ...scopeValues(context)],
          );
          if (affected(assetRows) !== assetRows.rows.length) {
            throw commandError('PERSISTENCE_FAILED');
          }
          if (new Set(input.assetIds).size !== input.assetIds.length) {
            throw commandError('INVALID_INPUT');
          }
          const available = new Set(
            assetRows.rows.map((asset) => text(asset, 'asset_id')),
          );
          if (
            available.size !== new Set(input.assetIds).size ||
            input.assetIds.some((assetId) => !available.has(assetId))
          ) {
            throw commandError('NOT_FOUND');
          }
          if (
            assetRows.rows.some(
              (asset) =>
                text(asset, 'lifecycle_state') !== 'QUARANTINED' ||
                asset['version_id'] !== null ||
                (asset['bound_ingestion_id'] !== null &&
                  asset['bound_ingestion_id'] !== undefined),
            )
          ) {
            throw commandError('STATE_CONFLICT');
          }
          const inheritedSecurity = maximumSecurity(
            input.requestedSecurityLevel,
            ...assetRows.rows.map(
              (asset) => text(asset, 'security_level') as SecurityLevel,
            ),
          );
          assertSecurity(inheritedSecurity, context);
          for (const asset of assetRows.rows) {
            const elevated = singleRow(
              await transactions.query(
                client,
                context,
                ASSET_SECURITY_ELEVATE_SQL,
                [
                  text(asset, 'asset_id'),
                  inheritedSecurity,
                  timestamp,
                  context.authorization.tenantId,
                  context.authorization.projectId,
                  integer(asset, 'row_version'),
                  context.effectiveMaxSecurityLevel,
                  context.authorization.authzVersion,
                ],
              ),
            );
            if (
              elevated === undefined ||
              text(elevated, 'security_level') !== inheritedSecurity ||
              integer(elevated, 'row_version') !==
                integer(asset, 'row_version') + 1
            ) {
              throw commandError('STATE_CONFLICT');
            }
          }
          const ingestionId = nextId(idFactory);
          const operationId = nextId(idFactory);
          const createdOperation = operation(
            operationId,
            'data.ingestion.create',
            'WAITING_INPUT',
            timestamp,
            context,
          );
          await transactions.insertOperation(
            client,
            createdOperation,
            context,
            key,
            { ...input, requestedSecurityLevel: inheritedSecurity },
            null,
            inheritedSecurity,
            timestamp,
          );
          exactlyOne(
            await transactions.query(client, context, INGESTION_INSERT_SQL, [
              ingestionId,
              context.authorization.tenantId,
              context.authorization.projectId,
              operationId,
              input.intendedUses,
              inheritedSecurity,
              context.authorization.authzVersion,
              timestamp,
            ]),
          );
          for (const [ordinal, assetId] of input.assetIds.entries()) {
            exactlyOne(
              await transactions.query(
                client,
                context,
                INPUT_ASSET_INSERT_SQL,
                [
                  nextId(idFactory),
                  context.authorization.tenantId,
                  context.authorization.projectId,
                  ingestionId,
                  assetId,
                  ordinal,
                  inheritedSecurity,
                  context.authorization.authzVersion,
                  timestamp,
                ],
              ),
            );
          }
          const output = { ingestionId, operation: createdOperation };
          return {
            output,
            replayResult: output,
            aggregateId: ingestionId,
            eventType: 'data.ingestion.created',
            securityLevel: inheritedSecurity,
          };
        },
      );
    }),

    define('data.ingestion.submit', async (raw, context) => {
      const input = SubmitIngestionInputSchema.parse(raw);
      return transactions.run(
        'data.ingestion.submit',
        input,
        context,
        async (client, timestamp) => {
          const ingestion = await lockIngestion(
            transactions,
            client,
            input.ingestionId,
            input.expectedVersion,
            'RECEIVED',
            context,
          );
          const operationId = text(ingestion.row, 'operation_id');
          const lockedOperation = await lockOperation(
            transactions,
            client,
            operationId,
            context,
          );
          if (text(lockedOperation, 'status') !== 'WAITING_INPUT') {
            throw commandError('STATE_CONFLICT');
          }
          const operationVersion = integer(lockedOperation, 'row_version');
          const securityLevel = maximumSecurity(
            text(ingestion.row, 'requested_security_level') as SecurityLevel,
            text(ingestion.row, 'security_level') as SecurityLevel,
            text(lockedOperation, 'security_level') as SecurityLevel,
          );
          assertSecurity(securityLevel, context);
          const jobPayload: DataIngestionProcessJobPayload = {
            ingestionId: input.ingestionId,
            expectedState: 'RECEIVED' as const,
            expectedVersion: input.expectedVersion,
          };
          exactlyOne(
            await transactions.query(client, context, OPERATION_SUBMIT_SQL, [
              operationId,
              timestamp,
              context.authorization.tenantId,
              context.authorization.projectId,
              operationVersion,
              context.effectiveMaxSecurityLevel,
              context.authorization.authzVersion,
            ]),
          );
          exactlyOne(
            await transactions.query(client, context, JOB_INSERT_SQL, [
              nextId(idFactory),
              context.authorization.tenantId,
              context.authorization.projectId,
              input.ingestionId,
              operationId,
              `${DATA_INGESTION_PROCESS_JOB_TYPE}:${input.ingestionId}`,
              JSON.stringify(jobPayload),
              timestamp,
              new Date(
                Date.parse(timestamp) + Math.min(context.timeoutMs, 120_000),
              ).toISOString(),
              securityLevel,
              context.authorization.authzVersion,
            ]),
          );
          const running = operationFromLocked(
            lockedOperation,
            'RUNNING',
            timestamp,
            context,
            operationVersion + 1,
          );
          await transactions.appendOperationEvent(
            client,
            operationId,
            'WAITING_INPUT',
            'RUNNING',
            'STARTED',
            running.progressPercent,
            securityLevel,
            context,
            timestamp,
          );
          const output = { operation: running };
          return {
            output,
            replayResult: output,
            aggregateId: input.ingestionId,
            eventType: 'data.ingestion.submitted',
            securityLevel,
          };
        },
      );
    }),

    define('data.ingestion.approve', async (raw, context) => {
      const input = ApproveIngestionInputSchema.parse(raw);
      return transactions.run(
        'data.ingestion.approve',
        input,
        context,
        async (client, timestamp) => {
          const ingestion = await lockIngestion(
            transactions,
            client,
            input.ingestionId,
            input.expectedVersion,
            'REVIEW_REQUIRED',
            context,
          );
          const operationId = text(ingestion.row, 'operation_id');
          const lockedOperation = await lockOperation(
            transactions,
            client,
            operationId,
            context,
          );
          if (text(lockedOperation, 'status') !== 'WAITING_REVIEW') {
            throw commandError('STATE_CONFLICT');
          }
          const job = await lockPipelineJob(
            transactions,
            client,
            input.ingestionId,
            operationId,
            context,
          );
          if (text(job, 'status') !== 'WAITING_REVIEW') {
            throw commandError('STATE_CONFLICT');
          }
          const checkpointResult = await transactions.query(
            client,
            context,
            REVIEW_CHECKPOINT_LOCK_SQL,
            [input.ingestionId, ...scopeValues(context)],
          );
          const checkpoint = singleRow(checkpointResult);
          if (checkpoint === undefined) throw commandError('STATE_CONFLICT');
          const reviewHash = text(checkpoint, 'review_hash');
          const frozenPlan = parseStoredPayload(checkpoint['plan']);
          if (
            !SHA256_PATTERN.test(reviewHash) ||
            frozenPlan['reviewHash'] !== reviewHash
          ) {
            throw commandError('STATE_CONFLICT');
          }
          const securityLevel = maximumSecurity(
            text(ingestion.row, 'requested_security_level') as SecurityLevel,
            text(ingestion.row, 'security_level') as SecurityLevel,
            text(lockedOperation, 'security_level') as SecurityLevel,
            text(job, 'security_level') as SecurityLevel,
            text(checkpoint, 'security_level') as SecurityLevel,
          );
          assertSecurity(securityLevel, context);
          exactlyOne(
            await transactions.query(client, context, REVIEW_INSERT_SQL, [
              nextId(idFactory),
              context.authorization.tenantId,
              context.authorization.projectId,
              input.ingestionId,
              context.principal.actorId,
              'APPROVED',
              input.reviewNote ?? null,
              JSON.stringify({
                conditions: input.conditions ?? [],
                transformPlanId: text(checkpoint, 'transform_plan_id'),
                reviewHash,
              }),
              securityLevel,
              context.authorization.authzVersion,
              timestamp,
            ]),
          );
          const approvedCheckpoint = singleRow(
            await transactions.query(
              client,
              context,
              REVIEW_CHECKPOINT_APPROVE_SQL,
              [
                text(checkpoint, 'transform_plan_id'),
                context.principal.actorId,
                timestamp,
                context.authorization.tenantId,
                context.authorization.projectId,
                integer(checkpoint, 'row_version'),
                context.effectiveMaxSecurityLevel,
                context.authorization.authzVersion,
              ],
            ),
          );
          if (
            approvedCheckpoint === undefined ||
            text(approvedCheckpoint, 'review_hash') !== reviewHash
          ) {
            throw commandError('STATE_CONFLICT');
          }
          exactlyOne(
            await transactions.query(client, context, INGESTION_APPROVE_SQL, [
              input.ingestionId,
              context.principal.actorId,
              timestamp,
              context.authorization.tenantId,
              context.authorization.projectId,
              input.expectedVersion,
              context.effectiveMaxSecurityLevel,
              context.authorization.authzVersion,
            ]),
          );
          const approvedVersion = input.expectedVersion + 1;
          const jobPayload: DataIngestionProcessJobPayload = {
            ingestionId: input.ingestionId,
            expectedState: 'APPROVED' as const,
            expectedVersion: approvedVersion,
          };
          exactlyOne(
            await transactions.query(client, context, JOB_WAKE_SQL, [
              text(job, 'job_id'),
              JSON.stringify(jobPayload),
              timestamp,
              context.authorization.tenantId,
              context.authorization.projectId,
              integer(job, 'row_version'),
              context.effectiveMaxSecurityLevel,
              context.authorization.authzVersion,
              new Date(
                Date.parse(timestamp) + Math.min(context.timeoutMs, 120_000),
              ).toISOString(),
            ]),
          );
          const operationVersion = integer(lockedOperation, 'row_version');
          exactlyOne(
            await transactions.query(client, context, OPERATION_APPROVE_SQL, [
              operationId,
              timestamp,
              context.authorization.tenantId,
              context.authorization.projectId,
              operationVersion,
              context.effectiveMaxSecurityLevel,
              context.authorization.authzVersion,
            ]),
          );
          const running = operationFromLocked(
            lockedOperation,
            'RUNNING',
            timestamp,
            context,
            operationVersion + 1,
          );
          await transactions.appendOperationEvent(
            client,
            operationId,
            'WAITING_REVIEW',
            'RUNNING',
            'STARTED',
            running.progressPercent,
            securityLevel,
            context,
            timestamp,
          );
          const output = { operation: running };
          return {
            output,
            replayResult: output,
            aggregateId: input.ingestionId,
            eventType: 'data.ingestion.approved',
            securityLevel,
          };
        },
      );
    }),

    define('data.ingestion.reject', async (raw, context) => {
      const input = RejectIngestionInputSchema.parse(raw);
      return transactions.run(
        'data.ingestion.reject',
        input,
        context,
        async (client, timestamp) => {
          const ingestion = await lockIngestion(
            transactions,
            client,
            input.ingestionId,
            input.expectedVersion,
            'REVIEW_REQUIRED',
            context,
          );
          const operationId = text(ingestion.row, 'operation_id');
          const lockedOperation = await lockOperation(
            transactions,
            client,
            operationId,
            context,
          );
          if (text(lockedOperation, 'status') !== 'WAITING_REVIEW') {
            throw commandError('STATE_CONFLICT');
          }
          const job = await lockPipelineJob(
            transactions,
            client,
            input.ingestionId,
            operationId,
            context,
          );
          if (text(job, 'status') !== 'WAITING_REVIEW') {
            throw commandError('STATE_CONFLICT');
          }
          const securityLevel = maximumSecurity(
            text(ingestion.row, 'requested_security_level') as SecurityLevel,
            text(ingestion.row, 'security_level') as SecurityLevel,
            text(lockedOperation, 'security_level') as SecurityLevel,
            text(job, 'security_level') as SecurityLevel,
          );
          assertSecurity(securityLevel, context);
          exactlyOne(
            await transactions.query(client, context, REVIEW_INSERT_SQL, [
              nextId(idFactory),
              context.authorization.tenantId,
              context.authorization.projectId,
              input.ingestionId,
              context.principal.actorId,
              'REJECTED',
              input.reason,
              JSON.stringify([{ reasonCode: input.reasonCode }]),
              securityLevel,
              context.authorization.authzVersion,
              timestamp,
            ]),
          );
          exactlyOne(
            await transactions.query(client, context, INGESTION_REJECT_SQL, [
              input.ingestionId,
              timestamp,
              context.authorization.tenantId,
              context.authorization.projectId,
              input.expectedVersion,
              context.effectiveMaxSecurityLevel,
              context.authorization.authzVersion,
            ]),
          );
          exactlyOne(
            await transactions.query(client, context, JOB_REJECT_SQL, [
              text(job, 'job_id'),
              timestamp,
              context.authorization.tenantId,
              context.authorization.projectId,
              integer(job, 'row_version'),
              context.effectiveMaxSecurityLevel,
              context.authorization.authzVersion,
            ]),
          );
          const operationVersion = integer(lockedOperation, 'row_version');
          exactlyOne(
            await transactions.query(client, context, OPERATION_REJECT_SQL, [
              operationId,
              input.reasonCode,
              'The ingestion was rejected by an authorized reviewer.',
              timestamp,
              context.authorization.tenantId,
              context.authorization.projectId,
              operationVersion,
              context.effectiveMaxSecurityLevel,
              context.authorization.authzVersion,
            ]),
          );
          await transactions.appendOperationEvent(
            client,
            operationId,
            'WAITING_REVIEW',
            'FAILED',
            'FAILED',
            integer(lockedOperation, 'progress_percent'),
            securityLevel,
            context,
            timestamp,
          );
          const ingestionOutput: IngestionDto = {
            ingestionId: input.ingestionId,
            tenantId: context.authorization.tenantId,
            projectId: context.authorization.projectId,
            assetIds: ingestion.assetIds,
            intendedUses: stringArray(ingestion.row, 'intended_uses'),
            requestedSecurityLevel: securityLevel,
            state: 'REJECTED',
            operationId,
            version: input.expectedVersion + 1,
            createdAt: text(ingestion.row, 'created_at'),
            updatedAt: timestamp,
          };
          const output = { ingestion: ingestionOutput };
          return {
            output,
            replayResult: output,
            aggregateId: input.ingestionId,
            eventType: 'data.ingestion.rejected',
            securityLevel,
          };
        },
      );
    }),

    define('data.operation.cancel', async (raw, context) => {
      const input = CancelOperationInputSchema.parse(raw);
      return transactions.run(
        'data.operation.cancel',
        input,
        context,
        async (client, timestamp) => {
          const sessionResult = await transactions.query(
            client,
            context,
            INGESTION_BY_OPERATION_LOCK_SQL,
            [input.operationId, ...scopeValues(context)],
          );
          const session = singleRow(sessionResult);
          if (
            session !== undefined &&
            [
              'REJECTED',
              'COMMITTED',
              'PROJECTING',
              'PUBLISHED',
              'FAILED',
              'CANCELLED',
            ].includes(text(session, 'state'))
          ) {
            throw commandError('STATE_CONFLICT');
          }
          const jobs = await transactions.query(
            client,
            context,
            JOBS_FOR_OPERATION_LOCK_SQL,
            [input.operationId, ...scopeValues(context)],
          );
          if (affected(jobs) !== jobs.rows.length) {
            throw commandError('PERSISTENCE_FAILED');
          }
          const row = await lockOperation(
            transactions,
            client,
            input.operationId,
            context,
          );
          if (integer(row, 'row_version') !== input.expectedVersion) {
            throw commandError('VERSION_CONFLICT');
          }
          const previousStatus = text(row, 'status');
          if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(previousStatus)) {
            throw commandError('STATE_CONFLICT');
          }
          const securityLevel = text(row, 'security_level') as SecurityLevel;
          assertSecurity(securityLevel, context);
          if (session !== undefined) {
            exactlyOne(
              await transactions.query(client, context, INGESTION_CANCEL_SQL, [
                text(session, 'ingestion_id'),
                timestamp,
                context.authorization.tenantId,
                context.authorization.projectId,
                text(session, 'state'),
                integer(session, 'row_version'),
                context.effectiveMaxSecurityLevel,
                context.authorization.authzVersion,
              ]),
            );
          }

          if (jobs.rows.length > 0) {
            if (
              jobs.rows.every((job) =>
                ['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'].includes(
                  text(job, 'status'),
                ),
              )
            ) {
              throw commandError('STATE_CONFLICT');
            }
            for (const job of jobs.rows) {
              if (
                ['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'].includes(
                  text(job, 'status'),
                )
              ) {
                continue;
              }
              const cancelled = singleRow(
                await transactions.query(
                  client,
                  context,
                  REQUEST_JOB_CANCELLATION_SQL,
                  [
                    context.authorization.tenantId,
                    context.authorization.projectId,
                    text(job, 'job_id'),
                    timestamp,
                  ],
                ),
              );
              if (cancelled === undefined) {
                throw commandError('PERSISTENCE_FAILED');
              }
              if (text(job, 'status') === 'RUNNING') {
                if (
                  text(cancelled, 'status') !== 'RUNNING' ||
                  integer(cancelled, 'attempt_count') !==
                    integer(job, 'attempt_count') ||
                  optionalText(cancelled, 'lease_owner') !==
                    optionalText(job, 'lease_owner') ||
                  optionalText(cancelled, 'lease_expires_at') !==
                    optionalText(job, 'lease_expires_at') ||
                  optionalText(cancelled, 'cancel_requested_at') === undefined
                ) {
                  throw commandError('PERSISTENCE_FAILED');
                }
              } else if (text(cancelled, 'status') !== 'CANCELLED') {
                throw commandError('PERSISTENCE_FAILED');
              }
            }
            const refreshed = singleRow(
              await transactions.query(
                client,
                context,
                OPERATION_AFTER_LIFECYCLE_SQL,
                [input.operationId, ...scopeValues(context)],
              ),
            );
            if (refreshed === undefined)
              throw commandError('PERSISTENCE_FAILED');
            const refreshedStatus = text(
              refreshed,
              'status',
            ) as OperationDto['status'];
            const output = operationFromLocked(
              refreshed,
              refreshedStatus,
              text(refreshed, 'updated_at'),
              context,
              integer(refreshed, 'row_version'),
            );
            return {
              output,
              replayResult: output,
              aggregateId: input.operationId,
              eventType:
                refreshedStatus === 'CANCELLED'
                  ? 'data.operation.cancelled'
                  : 'data.operation.cancellation-requested',
              securityLevel,
            };
          }

          exactlyOne(
            await transactions.query(client, context, OPERATION_CANCEL_SQL, [
              input.operationId,
              timestamp,
              context.authorization.tenantId,
              context.authorization.projectId,
              input.expectedVersion,
              context.effectiveMaxSecurityLevel,
              context.authorization.authzVersion,
            ]),
          );
          const output = operationFromLocked(
            row,
            'CANCELLED',
            timestamp,
            context,
            input.expectedVersion + 1,
          );
          await transactions.appendOperationEvent(
            client,
            input.operationId,
            previousStatus,
            'CANCELLED',
            'CANCELLED',
            output.progressPercent,
            securityLevel,
            context,
            timestamp,
          );
          return {
            output,
            replayResult: output,
            aggregateId: input.operationId,
            eventType: 'data.operation.cancelled',
            securityLevel,
          };
        },
      );
    }),
  ] satisfies readonly DataCapabilityExecutor[]);

  return Object.freeze({
    executors,
    async close() {
      try {
        await pool.end();
      } catch {
        throw commandError('PERSISTENCE_FAILED');
      }
    },
  });
}
