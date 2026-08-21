import { Pool } from 'pg';

import type {
  ClaimedDataJob,
  DataJobDatabaseClient,
  DataJobDatabasePool,
  DataJobFailure,
  DataJobLease,
  DataJobLifecycleResult,
  DataJobRepository,
  DataJobScope,
  DataJobSettlement,
  DataJobStatus,
} from './types.js';

const SET_SCOPE_SQL = `
select
  set_config('wiser.tenant_id', $1, true),
  set_config('wiser.project_id', $2, true),
  set_config('wiser.max_security_level', $3, true),
  set_config('wiser.policy_version', $4, true)
`;

const CLAIM_SQL = `
select *
from ingestion.claim_jobs_at($1, $2, $3, ($4::bigint * interval '1 millisecond'), $5, $6)
`;

const HEARTBEAT_SQL = `
select *
from ingestion.heartbeat_job($1, $2, $3, $4, $5, ($6::bigint * interval '1 millisecond'), $7)
`;

const SETTLE_SQL = `
select *
from ingestion.settle_job($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
`;

const FAIL_SQL = `
select *
from ingestion.fail_job($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
`;

const RECOVER_SQL = `
select *
from ingestion.recover_jobs($1, $2, $3, $4)
`;

export class JobLeaseLostError extends Error {
  constructor(
    readonly jobId: string,
    options?: ErrorOptions,
  ) {
    super(
      `The lease for Data Foundation job ${jobId} is stale or lost.`,
      options,
    );
    this.name = 'JobLeaseLostError';
  }
}

function requiredString(
  row: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = row[field];
  if (typeof value === 'string' && value.length > 0) return value;
  if (value instanceof Date) return value.toISOString();
  throw new TypeError(`Data job row requires ${field}.`);
}

function integer(
  row: Readonly<Record<string, unknown>>,
  field: string,
): number {
  const value = row[field];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(`Data job row requires integer ${field}.`);
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
  throw new TypeError(`Data job row requires object ${field}.`);
}

function lifecycleResult(
  row: Readonly<Record<string, unknown>>,
): DataJobLifecycleResult {
  const nextAttempt = row.next_attempt_at;
  return {
    jobId: requiredString(row, 'job_id'),
    status: requiredString(row, 'status') as DataJobStatus,
    rowVersion: integer(row, 'row_version'),
    ...(nextAttempt === null || nextAttempt === undefined
      ? {}
      : { nextAttemptAt: requiredString(row, 'next_attempt_at') }),
  };
}

function claimedJob(row: Readonly<Record<string, unknown>>): ClaimedDataJob {
  const leaseOwner = requiredString(row, 'lease_owner');
  return {
    jobId: requiredString(row, 'job_id'),
    operationId: requiredString(row, 'operation_id'),
    jobType: requiredString(row, 'job_type'),
    payload: record(row, 'payload'),
    attemptCount: integer(row, 'attempt_count'),
    maxAttempts: integer(row, 'max_attempts'),
    leaseOwner,
    leaseExpiresAt: requiredString(row, 'lease_expires_at'),
    rowVersion: integer(row, 'row_version'),
    cancelRequested: row.cancel_requested_at !== null,
  };
}

function firstRow(
  rows: readonly Record<string, unknown>[],
  operation: string,
): Readonly<Record<string, unknown>> {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Data job ${operation} returned no row.`);
  }
  return row;
}

function postgresCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const code: unknown = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

async function rollback(client: DataJobDatabaseClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Releasing the connection is still mandatory; the pool discards bad clients.
  }
}

export class PostgresDataJobRepository implements DataJobRepository {
  constructor(private readonly pool: DataJobDatabasePool) {}

  static connect(connectionString: string): PostgresDataJobRepository {
    if (connectionString.length === 0) {
      throw new Error(
        'A non-empty data-postgres connection string is required.',
      );
    }
    return new PostgresDataJobRepository(
      new Pool({
        application_name: 'wiser-data-worker',
        connectionString,
        max: 5,
      }),
    );
  }

  claim(
    scope: DataJobScope,
    workerId: string,
    limit: number,
    leaseMs: number,
    observedAt: string,
  ): Promise<readonly ClaimedDataJob[]> {
    return this.transaction(scope, async (client) => {
      const result = await client.query(CLAIM_SQL, [
        scope.tenantId,
        scope.projectId,
        workerId,
        leaseMs,
        limit,
        observedAt,
      ]);
      return result.rows.map(claimedJob);
    });
  }

  heartbeat(
    scope: DataJobScope,
    lease: DataJobLease,
    leaseMs: number,
    observedAt: string,
  ): Promise<ClaimedDataJob> {
    return this.transaction(scope, async (client) => {
      try {
        const result = await client.query(HEARTBEAT_SQL, [
          scope.tenantId,
          scope.projectId,
          lease.jobId,
          lease.workerId,
          lease.rowVersion,
          leaseMs,
          observedAt,
        ]);
        return claimedJob(firstRow(result.rows, 'heartbeat'));
      } catch (error) {
        if (postgresCode(error) === '55000') {
          throw new JobLeaseLostError(lease.jobId, { cause: error });
        }
        throw error;
      }
    });
  }

  settle(
    scope: DataJobScope,
    lease: DataJobLease,
    settlement: DataJobSettlement,
    observedAt: string,
  ): Promise<DataJobLifecycleResult> {
    return this.transaction(scope, async (client) => {
      const result = await client.query(SETTLE_SQL, [
        scope.tenantId,
        scope.projectId,
        lease.jobId,
        lease.workerId,
        lease.rowVersion,
        settlement.status,
        JSON.stringify(settlement.result ?? {}),
        observedAt,
      ]);
      return lifecycleResult(firstRow(result.rows, 'settlement'));
    });
  }

  fail(
    scope: DataJobScope,
    lease: DataJobLease,
    failure: DataJobFailure,
    observedAt: string,
  ): Promise<DataJobLifecycleResult> {
    return this.transaction(scope, async (client) => {
      const result = await client.query(FAIL_SQL, [
        scope.tenantId,
        scope.projectId,
        lease.jobId,
        lease.workerId,
        lease.rowVersion,
        failure.category.slice(0, 128),
        failure.retryable,
        JSON.stringify(failure.detail ?? {}),
        observedAt,
      ]);
      return lifecycleResult(firstRow(result.rows, 'failure'));
    });
  }

  recoverTimedOut(
    scope: DataJobScope,
    observedAt: string,
    limit = 100,
  ): Promise<readonly DataJobLifecycleResult[]> {
    return this.transaction(scope, async (client) => {
      const result = await client.query(RECOVER_SQL, [
        scope.tenantId,
        scope.projectId,
        observedAt,
        limit,
      ]);
      return result.rows.map(lifecycleResult);
    });
  }

  close(): Promise<void> {
    return this.pool.end();
  }

  private async transaction<Result>(
    scope: DataJobScope,
    work: (client: DataJobDatabaseClient) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(SET_SCOPE_SQL, [
        scope.tenantId,
        scope.projectId,
        scope.maxSecurityLevel,
        scope.policyVersion.toString(),
      ]);
      const result = await work(client);
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
