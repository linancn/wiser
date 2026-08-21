import { describe, expect, it } from 'vitest';

import {
  JobLeaseLostError,
  PostgresDataJobRepository,
  calculateExponentialBackoffMs,
  type DataJobDatabaseClient,
  type DataJobDatabasePool,
  type DataJobScope,
} from '../src/index.js';

const scope: DataJobScope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  maxSecurityLevel: 'L3_CONFIDENTIAL',
  policyVersion: 7,
};

class FakeClient implements DataJobDatabaseClient {
  readonly queries: Array<{
    readonly text: string;
    readonly values?: readonly unknown[];
  }> = [];
  released = false;
  staleLease = false;

  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }> {
    this.queries.push(values === undefined ? { text } : { text, values });
    if (this.staleLease && /heartbeat_job/i.test(text)) {
      return Promise.reject(
        Object.assign(new Error('stale worker lease'), { code: '55000' }),
      );
    }
    if (/claim_jobs_at/i.test(text)) {
      return Promise.resolve({
        rows: [
          {
            job_id: lease.jobId,
            tenant_id: scope.tenantId,
            project_id: scope.projectId,
            operation_id: '44444444-4444-4444-8444-444444444444',
            job_type: 'data.ingestion.process',
            payload: {
              ingestionId: '55555555-5555-4555-8555-555555555555',
              expectedState: 'RECEIVED',
              expectedVersion: 1,
            },
            attempt_count: 1,
            max_attempts: 5,
            lease_owner: 'worker-a',
            lease_expires_at: '2026-08-22T02:02:00.000Z',
            row_version: 2,
            cancel_requested_at: null,
            security_level: 'L2_RESTRICTED',
            policy_version: 7,
          },
        ],
      });
    }
    if (/settle_job/i.test(text)) {
      return Promise.resolve({
        rows: [
          {
            job_id: '33333333-3333-4333-8333-333333333333',
            status: 'WAITING_REVIEW',
            row_version: '3',
            next_attempt_at: null,
          },
        ],
      });
    }
    return Promise.resolve({ rows: [] });
  }

  release(): void {
    this.released = true;
  }
}

class FakePool implements DataJobDatabasePool {
  readonly client = new FakeClient();
  ended = false;

  connect(): Promise<DataJobDatabaseClient> {
    return Promise.resolve(this.client);
  }

  end(): Promise<void> {
    this.ended = true;
    return Promise.resolve();
  }
}

const lease = {
  jobId: '33333333-3333-4333-8333-333333333333',
  workerId: 'worker-a',
  rowVersion: 2,
} as const;

describe('deterministic job retry policy', () => {
  it('calculates capped exponential backoff without reading the system clock', () => {
    expect(calculateExponentialBackoffMs(1, 5_000, 3_600_000)).toBe(5_000);
    expect(calculateExponentialBackoffMs(4, 5_000, 3_600_000)).toBe(40_000);
    expect(calculateExponentialBackoffMs(99, 5_000, 3_600_000)).toBe(3_600_000);
    expect(() => calculateExponentialBackoffMs(0, 5_000, 3_600_000)).toThrow(
      'attemptCount',
    );
  });
});

describe('Postgres Data Job repository', () => {
  it('carries authoritative tenant, project, security, and policy scope on claims', async () => {
    const repository = new PostgresDataJobRepository(new FakePool());
    await expect(
      repository.claim(
        scope,
        'worker-a',
        1,
        120_000,
        '2026-08-22T02:00:00.000Z',
      ),
    ).resolves.toMatchObject([
      {
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        securityLevel: 'L2_RESTRICTED',
        policyVersion: scope.policyVersion,
      },
    ]);
  });

  it('settles job, Operation event, and Outbox through one short transaction', async () => {
    const pool = new FakePool();
    const repository = new PostgresDataJobRepository(pool);

    await expect(
      repository.settle(
        scope,
        lease,
        { status: 'WAITING_REVIEW', result: { reviewId: 'review-1' } },
        '2026-08-22T02:00:00.000Z',
      ),
    ).resolves.toEqual({
      jobId: lease.jobId,
      status: 'WAITING_REVIEW',
      rowVersion: 3,
    });

    const statements = pool.client.queries.map(({ text }) => text.trim());
    expect(statements.at(0)).toBe('BEGIN');
    expect(statements.filter((text) => /set_config/i.test(text))).toHaveLength(
      1,
    );
    expect(statements.some((text) => /ingestion\.settle_job/i.test(text))).toBe(
      true,
    );
    expect(statements.at(-1)).toBe('COMMIT');
    expect(pool.client.released).toBe(true);
  });

  it('maps a stale owner/version/expiry rejection to JobLeaseLostError and rolls back', async () => {
    const pool = new FakePool();
    pool.client.staleLease = true;
    const repository = new PostgresDataJobRepository(pool);

    await expect(
      repository.heartbeat(scope, lease, 120_000, '2026-08-22T02:00:00.000Z'),
    ).rejects.toBeInstanceOf(JobLeaseLostError);

    expect(pool.client.queries.map(({ text }) => text.trim())).toContain(
      'ROLLBACK',
    );
    expect(pool.client.released).toBe(true);
  });
});
