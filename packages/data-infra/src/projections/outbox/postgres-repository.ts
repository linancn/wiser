import { Pool } from 'pg';

import {
  PROJECTION_KINDS,
  type ProjectionEvent,
  type ProjectionKind,
  type ProjectionOutboxRepository,
  type ProjectionScope,
  type ProjectionState,
} from './types.js';

export type { ProjectionEvent, ProjectionScope } from './types.js';

const SET_SCOPE_SQL = `
select
  set_config('wiser.tenant_id', $1, true),
  set_config('wiser.project_id', $2, true),
  set_config('wiser.max_security_level', $3, true),
  set_config('wiser.policy_version', $4, true)
`;

const READ_BATCH_SQL = `
with checkpoint_seed as (
  insert into event.consumer_checkpoint (
    tenant_id,
    project_id,
    consumer_name,
    partition_key,
    security_level,
    policy_version
  ) values ($1, $2, $3, 'data.version.committed', $4, $5)
  on conflict (tenant_id, project_id, consumer_name, partition_key) do nothing
), checkpoint as (
  select consumer_checkpoint.last_outbox_event_id
  from event.consumer_checkpoint as consumer_checkpoint
  where consumer_checkpoint.tenant_id = $1
    and consumer_checkpoint.project_id = $2
    and consumer_checkpoint.consumer_name = $3
    and consumer_checkpoint.partition_key = 'data.version.committed'
)
select
  outbox_event.outbox_event_id,
  outbox_event.event_id,
  outbox_event.tenant_id,
  outbox_event.project_id,
  outbox_event.event_type,
  outbox_event.idempotency_key,
  outbox_event.security_level,
  outbox_event.policy_version,
  outbox_event.payload,
  outbox_event.created_at
from event.outbox_event as outbox_event
cross join checkpoint
where outbox_event.tenant_id = $1
  and outbox_event.project_id = $2
  and outbox_event.event_type = 'data.version.committed'
  and outbox_event.outbox_event_id > checkpoint.last_outbox_event_id
order by outbox_event.outbox_event_id
limit $6
`;

const PREPARE_PROJECTIONS_SQL = `
insert into service.projection_status (
  tenant_id,
  project_id,
  data_item_id,
  version_id,
  projection_kind,
  status,
  idempotency_key,
  security_level,
  policy_version
)
select
  $1,
  $2,
  $3,
  $4,
  requested.projection_kind,
  'PENDING',
  $5 || ':' || lower(requested.projection_kind),
  $6,
  $7
from unnest($8::text[]) as requested(projection_kind)
on conflict (tenant_id, project_id, version_id, projection_kind) do nothing
`;

const READ_PROJECTION_STATES_SQL = `
select projection_kind, status
from service.projection_status
where tenant_id = $1
  and project_id = $2
  and version_id = $3
  and projection_kind = any($4::text[])
order by projection_kind
`;

const MARK_RUNNING_SQL = `
update service.projection_status
set status = 'RUNNING',
    attempt_count = attempt_count + 1,
    error_detail = null,
    row_version = row_version + 1,
    updated_at = clock_timestamp()
where tenant_id = $1
  and project_id = $2
  and version_id = $3
  and projection_kind = $4
  and status <> 'SUCCEEDED'
`;

const MARK_SUCCEEDED_SQL = `
update service.projection_status
set status = 'SUCCEEDED',
    projected_at = clock_timestamp(),
    error_detail = null,
    row_version = row_version + 1,
    updated_at = clock_timestamp()
where tenant_id = $1
  and project_id = $2
  and version_id = $3
  and projection_kind = $4
`;

const MARK_FAILED_SQL = `
update service.projection_status
set status = 'FAILED',
    projected_at = null,
    error_detail = jsonb_build_object('category', $5),
    row_version = row_version + 1,
    updated_at = clock_timestamp()
where tenant_id = $1
  and project_id = $2
  and version_id = $3
  and projection_kind = $4
  and status <> 'SUCCEEDED'
`;

const ADVANCE_CHECKPOINT_SQL = `
insert into event.consumer_checkpoint (
  tenant_id,
  project_id,
  consumer_name,
  partition_key,
  last_outbox_event_id,
  last_event_id,
  security_level,
  policy_version
) values ($1, $2, $3, 'data.version.committed', $4, $5, $6, $7)
on conflict (tenant_id, project_id, consumer_name, partition_key) do update
set last_event_id = case
      when excluded.last_outbox_event_id > event.consumer_checkpoint.last_outbox_event_id
        then excluded.last_event_id
      else event.consumer_checkpoint.last_event_id
    end,
    last_outbox_event_id = greatest(
      event.consumer_checkpoint.last_outbox_event_id,
      excluded.last_outbox_event_id
    ),
    last_error = null,
    security_level = excluded.security_level,
    policy_version = excluded.policy_version,
    row_version = event.consumer_checkpoint.row_version + 1,
    updated_at = clock_timestamp()
`;

const projectionKindSet = new Set<ProjectionKind>(PROJECTION_KINDS);
const projectionStateSet = new Set<ProjectionState>([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
]);

export interface ProjectionQueryResult {
  readonly rows: readonly Record<string, unknown>[];
}

export interface ProjectionDatabaseClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<ProjectionQueryResult>;
  release(): void;
}

export interface ProjectionDatabasePool {
  connect(): Promise<ProjectionDatabaseClient>;
  end(): Promise<void>;
}

function requiredString(
  row: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = row[field];
  if (typeof value === 'string' && value.length > 0) return value;
  if (value instanceof Date) return value.toISOString();
  throw new TypeError(`Projection row requires ${field}.`);
}

function positiveInteger(
  row: Readonly<Record<string, unknown>>,
  field: string,
): number {
  const value = row[field];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`Projection row requires positive integer ${field}.`);
  }
  return parsed;
}

function record(
  row: Readonly<Record<string, unknown>>,
  field: string,
): Readonly<Record<string, unknown>> {
  const value = row[field];
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  throw new TypeError(`Projection row requires object ${field}.`);
}

function projectionEvent(
  row: Readonly<Record<string, unknown>>,
): ProjectionEvent {
  const payload = record(row, 'payload');
  const eventType = requiredString(row, 'event_type');
  if (eventType !== 'data.version.committed') {
    throw new TypeError('Projection row has an unsupported event_type.');
  }
  return Object.freeze({
    outboxEventId: requiredString(row, 'outbox_event_id'),
    eventId: requiredString(row, 'event_id'),
    tenantId: requiredString(row, 'tenant_id'),
    projectId: requiredString(row, 'project_id'),
    dataItemId: requiredString(payload, 'dataItemId'),
    versionId: requiredString(payload, 'versionId'),
    eventType,
    idempotencyKey: requiredString(row, 'idempotency_key'),
    securityLevel: requiredString(
      row,
      'security_level',
    ) as ProjectionEvent['securityLevel'],
    policyVersion: positiveInteger(row, 'policy_version'),
    payload,
    createdAt: requiredString(row, 'created_at'),
  });
}

function assertKinds(kinds: readonly ProjectionKind[]): void {
  if (
    kinds.length === 0 ||
    new Set(kinds).size !== kinds.length ||
    kinds.some((kind) => !projectionKindSet.has(kind))
  ) {
    throw new Error('Projection kinds are invalid.');
  }
}

function assertFailureCategory(category: string): void {
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(category)) {
    throw new Error('Projection failure category is invalid.');
  }
}

async function rollback(client: ProjectionDatabaseClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The pool discards a broken client after release.
  }
}

export class PostgresProjectionOutboxRepository implements ProjectionOutboxRepository {
  constructor(private readonly pool: ProjectionDatabasePool) {}

  static connect(connectionString: string): PostgresProjectionOutboxRepository {
    if (connectionString.length === 0) {
      throw new Error('A data-postgres connection string is required.');
    }
    return new PostgresProjectionOutboxRepository(
      new Pool({
        application_name: 'wiser-data-projection-outbox',
        connectionString,
        max: 5,
      }),
    );
  }

  readBatch(
    scope: ProjectionScope,
    consumerName: string,
    limit: number,
  ): Promise<readonly ProjectionEvent[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Projection batch limit must be from 1 to 100.');
    }
    return this.transaction(scope, async (client) => {
      const result = await client.query(READ_BATCH_SQL, [
        scope.tenantId,
        scope.projectId,
        consumerName,
        scope.maxSecurityLevel,
        scope.policyVersion,
        limit,
      ]);
      return Object.freeze(result.rows.map(projectionEvent));
    });
  }

  prepare(
    event: ProjectionEvent,
    kinds: readonly ProjectionKind[],
  ): Promise<ReadonlyMap<ProjectionKind, ProjectionState>> {
    assertKinds(kinds);
    return this.transaction(this.scopeOf(event), async (client) => {
      await client.query(PREPARE_PROJECTIONS_SQL, [
        event.tenantId,
        event.projectId,
        event.dataItemId,
        event.versionId,
        event.eventId,
        event.securityLevel,
        event.policyVersion,
        kinds,
      ]);
      const result = await client.query(READ_PROJECTION_STATES_SQL, [
        event.tenantId,
        event.projectId,
        event.versionId,
        kinds,
      ]);
      const states = new Map<ProjectionKind, ProjectionState>();
      for (const row of result.rows) {
        const kind = requiredString(row, 'projection_kind') as ProjectionKind;
        const state = requiredString(row, 'status') as ProjectionState;
        if (!projectionKindSet.has(kind) || !projectionStateSet.has(state)) {
          throw new TypeError('Projection ledger row is invalid.');
        }
        states.set(kind, state);
      }
      return states;
    });
  }

  markRunning(event: ProjectionEvent, kind: ProjectionKind): Promise<void> {
    return this.updateState(event, kind, MARK_RUNNING_SQL);
  }

  markSucceeded(event: ProjectionEvent, kind: ProjectionKind): Promise<void> {
    return this.updateState(event, kind, MARK_SUCCEEDED_SQL);
  }

  markFailed(
    event: ProjectionEvent,
    kind: ProjectionKind,
    category: string,
  ): Promise<void> {
    assertFailureCategory(category);
    return this.updateState(event, kind, MARK_FAILED_SQL, category);
  }

  advanceCheckpoint(
    scope: ProjectionScope,
    consumerName: string,
    event: ProjectionEvent,
  ): Promise<void> {
    return this.transaction(scope, async (client) => {
      await client.query(ADVANCE_CHECKPOINT_SQL, [
        scope.tenantId,
        scope.projectId,
        consumerName,
        event.outboxEventId,
        event.eventId,
        scope.maxSecurityLevel,
        scope.policyVersion,
      ]);
    });
  }

  close(): Promise<void> {
    return this.pool.end();
  }

  private scopeOf(event: ProjectionEvent): ProjectionScope {
    return {
      tenantId: event.tenantId,
      projectId: event.projectId,
      maxSecurityLevel: event.securityLevel,
      policyVersion: event.policyVersion,
    };
  }

  private updateState(
    event: ProjectionEvent,
    kind: ProjectionKind,
    sql: string,
    category?: string,
  ): Promise<void> {
    if (!projectionKindSet.has(kind)) {
      throw new Error('Projection kind is invalid.');
    }
    return this.transaction(this.scopeOf(event), async (client) => {
      await client.query(sql, [
        event.tenantId,
        event.projectId,
        event.versionId,
        kind,
        ...(category === undefined ? [] : [category]),
      ]);
    });
  }

  private async transaction<T>(
    scope: ProjectionScope,
    operation: (client: ProjectionDatabaseClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(SET_SCOPE_SQL, [
        scope.tenantId,
        scope.projectId,
        scope.maxSecurityLevel,
        String(scope.policyVersion),
      ]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
