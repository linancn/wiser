import { createHash } from 'node:crypto';

import {
  DATA_CAPABILITY_REGISTRY,
  type AgentRunSummaryDto,
  type DataCapabilityId,
  type DataItemDto,
  type DataItemVersionDto,
  type IngestionDto,
  type OperationDto,
  type OperationEventDto,
  type ProjectionStatusSummaryDto,
  type QualityIssueSummaryDto,
  type SecurityLevel,
} from '@wiser/data-contracts';

import type {
  DataCapabilityAuditPort,
  DataCapabilityAuditRecord,
  DataCapabilityExecutionContext,
  DataCapabilityExecutor,
} from './capability-handler.js';

const SET_SCOPE_SQL = `
select
  set_config('wiser.tenant_id', $1, true),
  set_config('wiser.project_id', $2, true),
  set_config('wiser.max_security_level', $3, true),
  set_config('wiser.policy_version', $4, true)
`;

const ITEM_COLUMNS = `
  tenant_id, data_item_id, name, business_domains, source_natures,
  source_channels, processing_stage, intended_uses, owner_project_id,
  source_organization, source_contact, authorization_scope,
  citation_requirements, source_crs, canonical_crs, timezone,
  temporal_resolution, schema_version_id, unit_definitions,
  missing_value_rules, anomaly_rules, generation_method, quality_grade,
  acceptance_status, publication_status, security_level, version,
  update_mode, created_at, updated_at
`;

const SEARCH_SQL = `
/* data.catalog.search */
select ${ITEM_COLUMNS}
from catalog.data_item
where ($1::text is null or name ilike '%' || $1 || '%')
  and ($2::text[] is null or business_domains && $2)
  and ($3::text[] is null or processing_stage = any($3))
  and ($4::text[] is null or security_level = any($4))
  and ($5::text[] is null or quality_grade = any($5))
  and ($6::text[] is null or acceptance_status = any($6))
  and ($7::timestamptz is null or (updated_at, data_item_id) < ($7, $8::uuid))
order by updated_at desc, data_item_id desc
limit $9::integer
`;

const ITEM_SQL = `
/* data.catalog.item */
select ${ITEM_COLUMNS}
from catalog.data_item
where data_item_id = $1::uuid
`;

const VERSION_COLUMNS = `
  version.tenant_id, version.data_item_id, version.version_id,
  version.version_number, coalesce(array_agg(asset.asset_id)
    filter (where asset.asset_id is not null), '{}') as asset_ids,
  encode(version.source_hash, 'hex') as source_hash,
  encode(version.metadata_hash, 'hex') as metadata_hash,
  version.schema_version_id, version.processing_stage,
  version.generation_method, version.quality_grade,
  version.acceptance_status, version.publication_status,
  version.security_level, version.created_at, version.committed_at,
  version.published_at, version.supersedes_version_id
`;

const VERSION_GET_SQL = `
/* data.catalog.version.get */
select ${VERSION_COLUMNS}
from catalog.data_item_version as version
left join catalog.asset as asset
  on asset.tenant_id = version.tenant_id
 and asset.project_id = version.project_id
 and asset.version_id = version.version_id
where version.data_item_id = $1::uuid
  and ($2::uuid is null or version.version_id = $2)
group by version.version_id
order by version.version_number desc, version.version_id desc
limit 1
`;

const VERSION_LIST_SQL = `
/* data.catalog.version.list */
select ${VERSION_COLUMNS}
from catalog.data_item_version as version
left join catalog.asset as asset
  on asset.tenant_id = version.tenant_id
 and asset.project_id = version.project_id
 and asset.version_id = version.version_id
where version.data_item_id = $1::uuid
  and ($2::bigint is null or (version.version_number, version.version_id) < ($2, $3::uuid))
group by version.version_id
order by version.version_number desc, version.version_id desc
limit $4::integer
`;

const INGESTION_SQL = `
/* data.ingestion.get */
select session.ingestion_id, session.tenant_id, session.project_id,
  coalesce(array_agg(input.asset_id order by input.ordinal)
    filter (where input.asset_id is not null), '{}') as asset_ids,
  session.intended_uses, session.requested_security_level, session.state,
  session.operation_id, session.row_version, session.created_at,
  session.updated_at
from ingestion.session as session
left join ingestion.input_asset as input
  on input.tenant_id = session.tenant_id
 and input.project_id = session.project_id
 and input.ingestion_id = session.ingestion_id
where session.ingestion_id = $1::uuid
group by session.ingestion_id
`;

const INGESTION_QUALITY_ISSUES_SQL = `
/* data.ingestion.quality-issues */
select issue.issue_id, issue.severity, issue.status, issue.field_path,
  issue.message, issue.created_at
from quality.issue as issue
join quality.check_run as check_run
  on check_run.tenant_id = issue.tenant_id
 and check_run.project_id = issue.project_id
 and check_run.check_run_id = issue.check_run_id
where check_run.ingestion_id = $1::uuid
order by issue.created_at desc, issue.issue_id desc
limit 200
`;

const INGESTION_AGENT_RUNS_SQL = `
/* data.ingestion.agent-runs */
select agent_run_id, agent_kind, provider, model, deterministic,
  encode(input_hash, 'hex') as input_hash,
  encode(output_hash, 'hex') as output_hash,
  status, created_at, updated_at
from ingestion.agent_run
where ingestion_id = $1::uuid
order by created_at desc, agent_run_id desc
limit 200
`;

const INGESTION_LINKED_ITEMS_SQL = `
/* data.ingestion.linked-items */
select distinct version.data_item_id, version.version_id
from ingestion.input_asset as input
join catalog.asset as asset
  on asset.tenant_id = input.tenant_id
 and asset.project_id = input.project_id
 and asset.asset_id = input.asset_id
join catalog.data_item_version as version
  on version.tenant_id = asset.tenant_id
 and version.project_id = asset.project_id
 and version.version_id = asset.version_id
where input.ingestion_id = $1::uuid
order by version.data_item_id, version.version_id
limit 200
`;

const INGESTION_PROJECTION_STATUSES_SQL = `
/* data.ingestion.projection-statuses */
select projection.data_item_id, projection.version_id,
  projection.projection_kind, projection.status, projection.attempt_count,
  projection.projected_at, projection.updated_at
from service.projection_status as projection
join unnest($1::uuid[], $2::uuid[]) as linked(data_item_id, version_id)
  on linked.data_item_id = projection.data_item_id
 and linked.version_id = projection.version_id
order by projection.updated_at desc, projection.projection_kind,
  projection.projection_status_id
limit 200
`;

const OPERATION_SQL = `
/* data.operation.get */
select operation_id, tenant_id, project_id, capability_id, status,
  progress_percent, row_version, created_at, updated_at, started_at,
  completed_at, error_code, error_message, error_retryable
from service.operation
where operation_id = $1::uuid
`;

const OPERATION_EXISTS_SQL = `
/* data.operation.exists */
select true as exists from service.operation where operation_id = $1::uuid
`;

const OPERATION_EVENTS_SQL = `
/* data.operation.events */
select event_id, operation_id, sequence_number, event_type, to_status,
  coalesce((payload ->> 'progressPercent')::integer,
    case when to_status = 'SUCCEEDED' then 100 else 0 end) as progress_percent,
  sequence_number as operation_version, created_at,
  nullif(payload ->> 'message', '') as message
from service.operation_event
where operation_id = $1::uuid
  and ($2::bigint is null or sequence_number > $2)
order by sequence_number asc
limit $3::integer
`;

const AUDIT_INSERT_SQL = `
/* data.audit.append */
insert into security.audit_event (
  tenant_id, project_id, actor_id, action, resource_type, resource_id,
  decision, purpose, context, security_level, policy_version, row_version,
  created_at
)
values (
  $1::uuid, $2::uuid, $3::uuid, $4, 'data_capability', $5, $6, $7,
  jsonb_strip_nulls(jsonb_build_object(
    'traceId', $10, 'auditLevel', $11, 'actorType', $12,
    'delegatedBy', $13, 'inputHash', $14, 'outputHash', $15,
    'errorCode', $16
  )),
  $8, $9::bigint, 1, $17::timestamptz
)
`;

export interface PostgresDataReadQueryResult {
  readonly rows: readonly Record<string, unknown>[];
}

export interface PostgresDataReadClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresDataReadQueryResult>;
  release(): void;
}

export interface PostgresDataReadPool {
  connect(): Promise<PostgresDataReadClient>;
  end(): Promise<void>;
}

export class PostgresDataReadError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PostgresDataReadError';
  }
}

export class PostgresDataReadNotFoundError extends PostgresDataReadError {
  constructor() {
    super(
      'DATA_RESOURCE_NOT_FOUND',
      404,
      'The requested data resource was not found.',
    );
    this.name = 'PostgresDataReadNotFoundError';
  }
}

export class PostgresDataReadCursorError extends PostgresDataReadError {
  constructor() {
    super(
      'INVALID_DATA_CURSOR',
      400,
      'The data cursor is invalid for this request.',
    );
    this.name = 'PostgresDataReadCursorError';
  }
}

interface CursorScope {
  readonly capabilityId: DataCapabilityId;
  readonly tenantId: string;
  readonly projectId: string;
  readonly securityLevel: SecurityLevel;
  readonly policyVersion: number;
  readonly queryHash: string;
}

interface CursorPayload extends CursorScope {
  readonly version: 1;
  readonly position: readonly (number | string)[];
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}

function queryHash(input: Record<string, unknown>): string {
  const { after: _after, first: _first, ...filters } = input;
  return createHash('sha256').update(canonical(filters)).digest('hex');
}

function cursorScope(
  id: DataCapabilityId,
  context: DataCapabilityExecutionContext,
  input: Record<string, unknown>,
): CursorScope {
  return {
    capabilityId: id,
    tenantId: context.authorization.tenantId,
    projectId: context.authorization.projectId,
    securityLevel: context.effectiveMaxSecurityLevel,
    policyVersion: context.authorization.authzVersion,
    queryHash: queryHash(input),
  };
}

function encodeCursor(
  scope: CursorScope,
  position: readonly (number | string)[],
): string {
  return Buffer.from(
    JSON.stringify({ version: 1, ...scope, position }),
  ).toString('base64url');
}

function decodeCursor(
  value: unknown,
  scope: CursorScope,
): readonly (number | string)[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 2_048) {
    throw new PostgresDataReadCursorError();
  }
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decoded).toString('base64url') !== value) {
      throw new PostgresDataReadCursorError();
    }
    const parsedValue: unknown = JSON.parse(decoded);
    if (
      parsedValue === null ||
      typeof parsedValue !== 'object' ||
      Array.isArray(parsedValue)
    ) {
      throw new PostgresDataReadCursorError();
    }
    const parsed = parsedValue as Partial<CursorPayload>;
    if (
      parsed.version !== 1 ||
      parsed.capabilityId !== scope.capabilityId ||
      parsed.tenantId !== scope.tenantId ||
      parsed.projectId !== scope.projectId ||
      parsed.securityLevel !== scope.securityLevel ||
      parsed.policyVersion !== scope.policyVersion ||
      parsed.queryHash !== scope.queryHash ||
      !Array.isArray(parsed.position) ||
      parsed.position.some(
        (item) => typeof item !== 'string' && typeof item !== 'number',
      )
    ) {
      throw new PostgresDataReadCursorError();
    }
    const position: Array<number | string> = [];
    for (const item of parsed.position as unknown[]) {
      if (typeof item !== 'string' && typeof item !== 'number') {
        throw new PostgresDataReadCursorError();
      }
      position.push(item);
    }
    return Object.freeze(position);
  } catch (error) {
    if (error instanceof PostgresDataReadCursorError) throw error;
    throw new PostgresDataReadCursorError();
  }
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  throw new TypeError(`Invalid database field ${key}.`);
}

function optionalText(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];
  return value === null || value === undefined ? undefined : text(row, key);
}

function integer(row: Record<string, unknown>, key: string): number {
  const parsed = Number(row[key]);
  if (!Number.isSafeInteger(parsed))
    throw new TypeError(`Invalid database field ${key}.`);
  return parsed;
}

function boolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== 'boolean')
    throw new TypeError(`Invalid database field ${key}.`);
  return value;
}

function strings(row: Record<string, unknown>, key: string): string[] {
  const value = row[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`Invalid database field ${key}.`);
  }
  const result: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') {
      throw new TypeError(`Invalid database field ${key}.`);
    }
    result.push(item);
  }
  return result;
}

function jsonArray(row: Record<string, unknown>, key: string): unknown[] {
  const value = row[key];
  if (!Array.isArray(value))
    throw new TypeError(`Invalid database field ${key}.`);
  return structuredClone(value) as unknown[];
}

function dataItem(row: Record<string, unknown>): DataItemDto {
  return {
    tenantId: text(row, 'tenant_id'),
    dataItemId: text(row, 'data_item_id'),
    name: text(row, 'name'),
    businessDomains: strings(row, 'business_domains'),
    sourceNatures: strings(row, 'source_natures'),
    sourceChannels: strings(row, 'source_channels'),
    processingStage: text(
      row,
      'processing_stage',
    ) as DataItemDto['processingStage'],
    intendedUses: strings(row, 'intended_uses'),
    ownerProjectId: text(row, 'owner_project_id'),
    sourceOrganization: text(row, 'source_organization'),
    ...(row.source_contact === null || row.source_contact === undefined
      ? {}
      : {
          sourceContact: structuredClone(
            row.source_contact,
          ) as DataItemDto['sourceContact'],
        }),
    authorizationScope: text(row, 'authorization_scope'),
    citationRequirements: strings(row, 'citation_requirements'),
    ...(optionalText(row, 'source_crs') === undefined
      ? {}
      : { sourceCrs: optionalText(row, 'source_crs')! }),
    ...(optionalText(row, 'canonical_crs') === undefined
      ? {}
      : { canonicalCrs: optionalText(row, 'canonical_crs')! }),
    ...(optionalText(row, 'timezone') === undefined
      ? {}
      : { timezone: optionalText(row, 'timezone')! }),
    ...(optionalText(row, 'temporal_resolution') === undefined
      ? {}
      : { temporalResolution: optionalText(row, 'temporal_resolution')! }),
    ...(optionalText(row, 'schema_version_id') === undefined
      ? {}
      : { schemaVersionId: optionalText(row, 'schema_version_id')! }),
    unitDefinitions: jsonArray(
      row,
      'unit_definitions',
    ) as DataItemDto['unitDefinitions'],
    missingValueRules: jsonArray(
      row,
      'missing_value_rules',
    ) as DataItemDto['missingValueRules'],
    anomalyRules: jsonArray(
      row,
      'anomaly_rules',
    ) as DataItemDto['anomalyRules'],
    generationMethod: text(
      row,
      'generation_method',
    ) as DataItemDto['generationMethod'],
    qualityGrade: text(row, 'quality_grade') as DataItemDto['qualityGrade'],
    acceptanceStatus: text(
      row,
      'acceptance_status',
    ) as DataItemDto['acceptanceStatus'],
    publicationStatus: text(
      row,
      'publication_status',
    ) as DataItemDto['publicationStatus'],
    securityLevel: text(row, 'security_level') as DataItemDto['securityLevel'],
    version: integer(row, 'version'),
    updateMode: text(row, 'update_mode') as DataItemDto['updateMode'],
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function version(row: Record<string, unknown>): DataItemVersionDto {
  return {
    tenantId: text(row, 'tenant_id'),
    dataItemId: text(row, 'data_item_id'),
    versionId: text(row, 'version_id'),
    version: integer(row, 'version_number'),
    assetIds: strings(row, 'asset_ids'),
    sourceHash: text(row, 'source_hash'),
    metadataHash: text(row, 'metadata_hash'),
    ...(optionalText(row, 'schema_version_id') === undefined
      ? {}
      : { schemaVersionId: optionalText(row, 'schema_version_id')! }),
    processingStage: text(
      row,
      'processing_stage',
    ) as DataItemVersionDto['processingStage'],
    generationMethod: text(
      row,
      'generation_method',
    ) as DataItemVersionDto['generationMethod'],
    qualityGrade: text(
      row,
      'quality_grade',
    ) as DataItemVersionDto['qualityGrade'],
    acceptanceStatus: text(
      row,
      'acceptance_status',
    ) as DataItemVersionDto['acceptanceStatus'],
    publicationStatus: text(
      row,
      'publication_status',
    ) as DataItemVersionDto['publicationStatus'],
    securityLevel: text(
      row,
      'security_level',
    ) as DataItemVersionDto['securityLevel'],
    createdAt: text(row, 'created_at'),
    ...(optionalText(row, 'committed_at') === undefined
      ? {}
      : { committedAt: optionalText(row, 'committed_at')! }),
    ...(optionalText(row, 'published_at') === undefined
      ? {}
      : { publishedAt: optionalText(row, 'published_at')! }),
    ...(optionalText(row, 'supersedes_version_id') === undefined
      ? {}
      : { supersedesVersionId: optionalText(row, 'supersedes_version_id')! }),
  };
}

function ingestion(row: Record<string, unknown>): IngestionDto {
  return {
    ingestionId: text(row, 'ingestion_id'),
    tenantId: text(row, 'tenant_id'),
    projectId: text(row, 'project_id'),
    assetIds: strings(row, 'asset_ids'),
    intendedUses: strings(row, 'intended_uses'),
    requestedSecurityLevel: text(
      row,
      'requested_security_level',
    ) as IngestionDto['requestedSecurityLevel'],
    state: text(row, 'state') as IngestionDto['state'],
    ...(optionalText(row, 'operation_id') === undefined
      ? {}
      : { operationId: optionalText(row, 'operation_id')! }),
    version: integer(row, 'row_version'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function qualityIssue(row: Record<string, unknown>): QualityIssueSummaryDto {
  return {
    issueId: text(row, 'issue_id'),
    severity: text(row, 'severity'),
    status: text(row, 'status'),
    ...(optionalText(row, 'field_path') === undefined
      ? {}
      : { fieldPath: optionalText(row, 'field_path')! }),
    message: text(row, 'message'),
    createdAt: text(row, 'created_at'),
  };
}

function agentRun(row: Record<string, unknown>): AgentRunSummaryDto {
  return {
    agentRunId: text(row, 'agent_run_id'),
    agentKind: text(row, 'agent_kind'),
    provider: text(row, 'provider'),
    model: text(row, 'model'),
    deterministic: boolean(row, 'deterministic'),
    inputHash: text(row, 'input_hash'),
    ...(optionalText(row, 'output_hash') === undefined
      ? {}
      : { outputHash: optionalText(row, 'output_hash')! }),
    status: text(row, 'status'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function projectionStatus(
  row: Record<string, unknown>,
): ProjectionStatusSummaryDto {
  return {
    dataItemId: text(row, 'data_item_id'),
    versionId: text(row, 'version_id'),
    projectionKind: text(row, 'projection_kind'),
    status: text(row, 'status') as ProjectionStatusSummaryDto['status'],
    attemptCount: integer(row, 'attempt_count'),
    ...(optionalText(row, 'projected_at') === undefined
      ? {}
      : { projectedAt: optionalText(row, 'projected_at')! }),
    updatedAt: text(row, 'updated_at'),
  };
}

function operation(row: Record<string, unknown>): OperationDto {
  const operationId = text(row, 'operation_id');
  return {
    operationId,
    tenantId: text(row, 'tenant_id'),
    projectId: text(row, 'project_id'),
    capabilityId: text(row, 'capability_id'),
    status: text(row, 'status') as OperationDto['status'],
    resource: `operation://${operationId}`,
    progressPercent: integer(row, 'progress_percent'),
    version: integer(row, 'row_version'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    ...(optionalText(row, 'started_at') === undefined
      ? {}
      : { startedAt: optionalText(row, 'started_at')! }),
    ...(optionalText(row, 'completed_at') === undefined
      ? {}
      : { completedAt: optionalText(row, 'completed_at')! }),
    ...(optionalText(row, 'error_code') === undefined
      ? {}
      : {
          error: {
            code: optionalText(row, 'error_code')!,
            message: optionalText(row, 'error_message') ?? 'Operation failed.',
            retryable: row.error_retryable === true,
          },
        }),
  };
}

function operationEvent(row: Record<string, unknown>): OperationEventDto {
  return {
    eventId: text(row, 'event_id'),
    operationId: text(row, 'operation_id'),
    sequence: integer(row, 'sequence_number'),
    eventType: text(row, 'event_type') as OperationEventDto['eventType'],
    status: text(row, 'to_status') as OperationEventDto['status'],
    progressPercent: integer(row, 'progress_percent'),
    operationVersion: integer(row, 'operation_version'),
    occurredAt: text(row, 'created_at'),
    ...(optionalText(row, 'message') === undefined
      ? {}
      : { message: optionalText(row, 'message')! }),
  };
}

async function rollback(client: PostgresDataReadClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The original sanitized error remains authoritative.
  }
}

class ReadTransactions {
  constructor(private readonly pool: PostgresDataReadPool) {}

  async run<Result>(
    context: DataCapabilityExecutionContext,
    work: (client: PostgresDataReadClient) => Promise<Result>,
  ): Promise<Result> {
    let client: PostgresDataReadClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw new PostgresDataReadError(
        'DATA_READ_FAILED',
        503,
        'The data authority read failed.',
      );
    }
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(SET_SCOPE_SQL, [
        context.authorization.tenantId,
        context.authorization.projectId,
        context.effectiveMaxSecurityLevel,
        String(context.authorization.authzVersion),
      ]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await rollback(client);
      if (error instanceof PostgresDataReadError) throw error;
      throw new PostgresDataReadError(
        'DATA_READ_FAILED',
        503,
        'The data authority read failed.',
      );
    } finally {
      client.release();
    }
  }
}

function parsedInput(
  id: DataCapabilityId,
  value: unknown,
): Record<string, unknown> {
  const parsed = DATA_CAPABILITY_REGISTRY[id].inputSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data === null ||
    typeof parsed.data !== 'object'
  ) {
    throw new PostgresDataReadError(
      'INVALID_DATA_INPUT',
      400,
      'The data read input is invalid.',
    );
  }
  return parsed.data as Record<string, unknown>;
}

function requireRow(
  rows: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const row = rows[0];
  if (row === undefined) throw new PostgresDataReadNotFoundError();
  return row;
}

class PostgresAppendOnlyAuditPort implements DataCapabilityAuditPort {
  constructor(
    private readonly pool: PostgresDataReadPool,
    private readonly policyVersion: number,
  ) {}

  async record(record: DataCapabilityAuditRecord): Promise<void> {
    let client: PostgresDataReadClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw new PostgresDataReadError(
        'DATA_AUDIT_FAILED',
        503,
        'The data audit append failed.',
      );
    }
    try {
      await client.query('BEGIN');
      await client.query(SET_SCOPE_SQL, [
        record.tenantId,
        record.projectId,
        'L3_CONFIDENTIAL',
        String(this.policyVersion),
      ]);
      await client.query(AUDIT_INSERT_SQL, [
        record.tenantId,
        record.projectId,
        record.actorId,
        record.capabilityId,
        record.traceId,
        record.decision,
        record.purpose,
        'L3_CONFIDENTIAL',
        this.policyVersion,
        record.traceId,
        record.auditLevel,
        record.actorType,
        record.delegatedBy ?? null,
        record.inputHash,
        record.outputHash ?? null,
        record.errorCode ?? null,
        record.occurredAt,
      ]);
      await client.query('COMMIT');
    } catch {
      await rollback(client);
      throw new PostgresDataReadError(
        'DATA_AUDIT_FAILED',
        503,
        'The data audit append failed.',
      );
    } finally {
      client.release();
    }
  }
}

export interface PostgresDataReadRuntime {
  readonly executors: readonly DataCapabilityExecutor[];
  readonly audit: DataCapabilityAuditPort;
  close(): Promise<void>;
}

export function createPostgresDataReadRuntime(
  pool: PostgresDataReadPool,
  options: { readonly auditPolicyVersion?: number } = {},
): PostgresDataReadRuntime {
  if (
    pool === null ||
    typeof pool?.connect !== 'function' ||
    typeof pool.end !== 'function'
  ) {
    throw new PostgresDataReadError(
      'INVALID_DATA_READ_CONFIG',
      500,
      'The data read pool is invalid.',
    );
  }
  const auditPolicyVersion = options.auditPolicyVersion ?? 1;
  if (!Number.isSafeInteger(auditPolicyVersion) || auditPolicyVersion < 1) {
    throw new PostgresDataReadError(
      'INVALID_DATA_READ_CONFIG',
      500,
      'The audit policy version is invalid.',
    );
  }
  const transactions = new ReadTransactions(pool);
  const define = (
    id: DataCapabilityId,
    execute: DataCapabilityExecutor['execute'],
  ): DataCapabilityExecutor => Object.freeze({ id, execute });

  const executors = Object.freeze([
    define('data.catalog.search', async (raw, context) => {
      const input = parsedInput('data.catalog.search', raw);
      const scope = cursorScope('data.catalog.search', context, input);
      const cursor = decodeCursor(input.after, scope);
      const first = input.first as number;
      return transactions.run(context, async (client) => {
        const result = await client.query(SEARCH_SQL, [
          input.query ?? null,
          input.businessDomains ?? null,
          input.processingStages ?? null,
          input.securityLevels ?? null,
          input.qualityGrades ?? null,
          input.acceptanceStatuses ?? null,
          cursor?.[0] ?? null,
          cursor?.[1] ?? null,
          first + 1,
        ]);
        const rows = result.rows.slice(0, first);
        const last = rows.at(-1);
        return {
          items: rows.map(dataItem),
          ...(result.rows.length > first && last !== undefined
            ? {
                nextCursor: encodeCursor(scope, [
                  text(last, 'updated_at'),
                  text(last, 'data_item_id'),
                ]),
              }
            : {}),
        };
      });
    }),
    define('data.catalog.get', async (raw, context) => {
      const input = parsedInput('data.catalog.get', raw);
      return transactions.run(context, async (client) => {
        const itemResult = await client.query(ITEM_SQL, [input.dataItemId]);
        const item = dataItem(requireRow(itemResult.rows));
        const versionResult = await client.query(VERSION_GET_SQL, [
          input.dataItemId,
          input.versionId ?? null,
        ]);
        if (
          input.versionId !== undefined &&
          versionResult.rows[0] === undefined
        ) {
          throw new PostgresDataReadNotFoundError();
        }
        return {
          item,
          ...(versionResult.rows[0] === undefined
            ? {}
            : { selectedVersion: version(versionResult.rows[0]) }),
        };
      });
    }),
    define('data.catalog.versions.list', async (raw, context) => {
      const input = parsedInput('data.catalog.versions.list', raw);
      const scope = cursorScope('data.catalog.versions.list', context, input);
      const cursor = decodeCursor(input.after, scope);
      const first = input.first as number;
      return transactions.run(context, async (client) => {
        requireRow((await client.query(ITEM_SQL, [input.dataItemId])).rows);
        const result = await client.query(VERSION_LIST_SQL, [
          input.dataItemId,
          cursor?.[0] ?? null,
          cursor?.[1] ?? null,
          first + 1,
        ]);
        const rows = result.rows.slice(0, first);
        const last = rows.at(-1);
        return {
          items: rows.map(version),
          ...(result.rows.length > first && last !== undefined
            ? {
                nextCursor: encodeCursor(scope, [
                  integer(last, 'version_number'),
                  text(last, 'version_id'),
                ]),
              }
            : {}),
        };
      });
    }),
    define('data.catalog.versions.get', async (raw, context) => {
      const input = parsedInput('data.catalog.versions.get', raw);
      return transactions.run(context, async (client) => ({
        version: version(
          requireRow(
            (
              await client.query(VERSION_GET_SQL, [
                input.dataItemId,
                input.versionId,
              ])
            ).rows,
          ),
        ),
      }));
    }),
    define('data.ingestion.get', async (raw, context) => {
      const input = parsedInput('data.ingestion.get', raw);
      return transactions.run(context, async (client) => {
        const ingestionId = input.ingestionId;
        const ingestionResult = await client.query(INGESTION_SQL, [
          ingestionId,
        ]);
        const ingestionDetail = ingestion(requireRow(ingestionResult.rows));
        const qualityIssuesResult = await client.query(
          INGESTION_QUALITY_ISSUES_SQL,
          [ingestionId],
        );
        const agentRunsResult = await client.query(INGESTION_AGENT_RUNS_SQL, [
          ingestionId,
        ]);
        const linkedItemsResult = await client.query(
          INGESTION_LINKED_ITEMS_SQL,
          [ingestionId],
        );
        const dataItemIds = linkedItemsResult.rows.map((row) =>
          text(row, 'data_item_id'),
        );
        const versionIds = linkedItemsResult.rows.map((row) =>
          text(row, 'version_id'),
        );
        const projectionStatusesResult =
          dataItemIds.length === 0
            ? { rows: [] as readonly Record<string, unknown>[] }
            : await client.query(INGESTION_PROJECTION_STATUSES_SQL, [
                dataItemIds,
                versionIds,
              ]);
        return {
          ingestion: ingestionDetail,
          qualityIssues: qualityIssuesResult.rows.map(qualityIssue),
          agentRuns: agentRunsResult.rows.map(agentRun),
          projectionStatuses:
            projectionStatusesResult.rows.map(projectionStatus),
        };
      });
    }),
    define('data.operation.get', async (raw, context) => {
      const input = parsedInput('data.operation.get', raw);
      return transactions.run(context, async (client) =>
        operation(
          requireRow(
            (await client.query(OPERATION_SQL, [input.operationId])).rows,
          ),
        ),
      );
    }),
    define('data.operation.events', async (raw, context) => {
      const input = parsedInput('data.operation.events', raw);
      const scope = cursorScope('data.operation.events', context, input);
      const cursor = decodeCursor(input.after, scope);
      const first = input.first as number;
      return transactions.run(context, async (client) => {
        requireRow(
          (await client.query(OPERATION_EXISTS_SQL, [input.operationId])).rows,
        );
        const result = await client.query(OPERATION_EVENTS_SQL, [
          input.operationId,
          cursor?.[0] ?? null,
          first + 1,
        ]);
        const rows = result.rows.slice(0, first);
        const last = rows.at(-1);
        return {
          items: rows.map(operationEvent),
          ...(result.rows.length > first && last !== undefined
            ? {
                nextCursor: encodeCursor(scope, [
                  integer(last, 'sequence_number'),
                ]),
              }
            : {}),
        };
      });
    }),
  ] satisfies readonly DataCapabilityExecutor[]);

  return Object.freeze({
    executors,
    audit: new PostgresAppendOnlyAuditPort(pool, auditPolicyVersion),
    async close(): Promise<void> {
      try {
        await pool.end();
      } catch {
        throw new PostgresDataReadError(
          'DATA_READ_CLOSE_FAILED',
          503,
          'The data authority pool could not close cleanly.',
        );
      }
    },
  });
}
