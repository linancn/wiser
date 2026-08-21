import { describe, expect, it } from 'vitest';

import type {
  ClaimedDataJob,
  DataJobFailure,
  DataJobLease,
  DataJobLifecycleResult,
  DataJobRepository,
  DataJobScope,
  DataJobSettlement,
} from '@wiser/data-infra';

import {
  DataJobHandlerError,
  DataWorkerScheduler,
  StaticJobHandlerRegistry,
  type DataJobHandler,
  type DataWorkerLogger,
} from '../src/index.js';

const scope: DataJobScope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  maxSecurityLevel: 'L3_CONFIDENTIAL',
  policyVersion: 1,
};

const claimedJob: ClaimedDataJob = {
  jobId: '33333333-3333-4333-8333-333333333333',
  operationId: '44444444-4444-4444-8444-444444444444',
  jobType: 'fixture.transform',
  payload: { fixture: 'water-quality' },
  attemptCount: 1,
  maxAttempts: 4,
  leaseOwner: 'worker-a',
  leaseExpiresAt: '2026-08-22T02:02:00.000Z',
  rowVersion: 2,
  cancelRequested: false,
};

class FakeRepository implements DataJobRepository {
  readonly settlements: DataJobSettlement[] = [];
  readonly failures: DataJobFailure[] = [];
  readonly observedTimes: string[] = [];
  jobs: ClaimedDataJob[] = [claimedJob];
  recovered: DataJobLifecycleResult[] = [];
  failureResult: DataJobLifecycleResult = {
    jobId: claimedJob.jobId,
    status: 'RETRY_SCHEDULED',
    rowVersion: 3,
    nextAttemptAt: '2026-08-22T02:00:05.000Z',
  };
  closed = false;

  recoverTimedOut(
    _scope: DataJobScope,
    observedAt: string,
  ): Promise<readonly DataJobLifecycleResult[]> {
    this.observedTimes.push(observedAt);
    return Promise.resolve(this.recovered);
  }

  claim(
    _scope: DataJobScope,
    _workerId: string,
    _limit: number,
    _leaseMs: number,
    observedAt: string,
  ): Promise<readonly ClaimedDataJob[]> {
    this.observedTimes.push(observedAt);
    const jobs = this.jobs;
    this.jobs = [];
    return Promise.resolve(jobs);
  }

  heartbeat(
    _scope: DataJobScope,
    lease: DataJobLease,
    _leaseMs: number,
    _observedAt: string,
  ): Promise<ClaimedDataJob> {
    return Promise.resolve({
      ...claimedJob,
      rowVersion: lease.rowVersion + 1,
    });
  }

  settle(
    _scope: DataJobScope,
    _lease: DataJobLease,
    settlement: DataJobSettlement,
    observedAt: string,
  ): Promise<DataJobLifecycleResult> {
    this.settlements.push(settlement);
    this.observedTimes.push(observedAt);
    return Promise.resolve({
      jobId: claimedJob.jobId,
      status: settlement.status,
      rowVersion: 3,
    });
  }

  fail(
    _scope: DataJobScope,
    _lease: DataJobLease,
    failure: DataJobFailure,
    observedAt: string,
  ): Promise<DataJobLifecycleResult> {
    this.failures.push(failure);
    this.observedTimes.push(observedAt);
    return Promise.resolve(this.failureResult);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

class MemoryLogger implements DataWorkerLogger {
  readonly events: string[] = [];

  info(event: string): void {
    this.events.push(event);
  }

  warn(event: string): void {
    this.events.push(event);
  }

  error(event: string): void {
    this.events.push(event);
  }
}

function scheduler(
  repository: FakeRepository,
  handler: DataJobHandler,
  now: () => Date = () => new Date('2026-08-22T02:00:00.000Z'),
): DataWorkerScheduler {
  return new DataWorkerScheduler({
    repository,
    handlers: new StaticJobHandlerRegistry([
      { jobType: 'fixture.transform', handler },
    ]),
    logger: new MemoryLogger(),
    scope,
    workerId: 'worker-a',
    claimLimit: 4,
    leaseMs: 120_000,
    heartbeatIntervalMs: 30_000,
    pollIntervalMs: 1_000,
    now,
  });
}

describe('static Data Worker handler registry', () => {
  it('rejects duplicate job types and exposes an immutable registry', () => {
    const handler: DataJobHandler = () =>
      Promise.resolve({ status: 'SUCCEEDED' });

    expect(
      () =>
        new StaticJobHandlerRegistry([
          { jobType: 'fixture.transform', handler },
          { jobType: 'fixture.transform', handler },
        ]),
    ).toThrow('Duplicate Data Worker handler');

    const registry = new StaticJobHandlerRegistry([
      { jobType: 'fixture.transform', handler },
    ]);
    expect(registry.resolve('fixture.transform')).toBe(handler);
    expect(registry.resolve('fixture.unknown')).toBeUndefined();
    expect(Object.isFrozen(registry.jobTypes)).toBe(true);
  });
});

describe('Data Worker scheduler', () => {
  it('settles successful and manual-wait outcomes while using the injected clock', async () => {
    const repository = new FakeRepository();
    const worker = scheduler(repository, () =>
      Promise.resolve({
        status: 'WAITING_INPUT',
        result: { prompt: 'confirm source CRS' },
      }),
    );

    await expect(worker.processOnce()).resolves.toBe(1);

    expect(repository.settlements).toEqual([
      {
        status: 'WAITING_INPUT',
        result: { prompt: 'confirm source CRS' },
      },
    ]);
    expect(new Set(repository.observedTimes)).toEqual(
      new Set(['2026-08-22T02:00:00.000Z']),
    );
    expect(worker.health()).toMatchObject({
      ready: true,
      phase: 'running',
      claimedJobs: 1,
      waitingInputJobs: 1,
      inFlightJobs: 0,
    });
  });

  it('records deterministic retry and dead-letter dispositions', async () => {
    const repository = new FakeRepository();
    const retryWorker = scheduler(repository, () =>
      Promise.reject(
        new DataJobHandlerError('PROJECTION_TEMPORARY', true, 'try again'),
      ),
    );

    await retryWorker.processOnce();
    expect(repository.failures).toEqual([
      {
        category: 'PROJECTION_TEMPORARY',
        retryable: true,
        detail: { message: 'try again' },
      },
    ]);
    expect(retryWorker.health()).toMatchObject({
      retriedJobs: 1,
      deadLetterJobs: 0,
    });

    repository.jobs = [claimedJob];
    repository.failureResult = {
      jobId: claimedJob.jobId,
      status: 'DEAD_LETTER',
      rowVersion: 3,
    };
    await retryWorker.processOnce();
    expect(retryWorker.health()).toMatchObject({
      retriedJobs: 1,
      deadLetterJobs: 1,
    });
  });

  it('fails an unknown job type without retrying it', async () => {
    const repository = new FakeRepository();
    repository.jobs = [{ ...claimedJob, jobType: 'fixture.unknown' }];
    repository.failureResult = {
      jobId: claimedJob.jobId,
      status: 'DEAD_LETTER',
      rowVersion: 3,
    };
    const worker = scheduler(repository, () =>
      Promise.resolve({ status: 'SUCCEEDED' }),
    );

    await worker.processOnce();

    expect(repository.failures[0]).toMatchObject({
      category: 'UNSUPPORTED_JOB_TYPE',
      retryable: false,
    });
  });

  it('waits for in-flight handlers before closing during graceful stop', async () => {
    const repository = new FakeRepository();
    let finish: (() => void) | undefined;
    const handlerStarted = Promise.withResolvers<void>();
    const worker = scheduler(repository, async () => {
      handlerStarted.resolve();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { status: 'SUCCEEDED' };
    });

    const processing = worker.processOnce();
    await handlerStarted.promise;
    const stopping = worker.stop();
    expect(worker.health()).toMatchObject({
      phase: 'draining',
      inFlightJobs: 1,
    });
    expect(repository.closed).toBe(false);

    finish?.();
    await Promise.all([processing, stopping]);
    expect(repository.closed).toBe(true);
    expect(worker.health()).toMatchObject({
      phase: 'stopped',
      live: false,
      inFlightJobs: 0,
    });
  });

  it('renders bounded Prometheus-compatible counters and gauges', async () => {
    const repository = new FakeRepository();
    const worker = scheduler(repository, () =>
      Promise.resolve({ status: 'WAITING_REVIEW' }),
    );
    await worker.processOnce();

    const metrics = worker.prometheusMetrics();
    expect(metrics).toContain('wiser_data_worker_jobs_claimed_total 1');
    expect(metrics).toContain('wiser_data_worker_jobs_waiting_review_total 1');
    expect(metrics).toContain('wiser_data_worker_inflight_jobs 0');
    expect(metrics).toContain('wiser_data_worker_ready 1');
    expect(metrics).not.toContain(claimedJob.jobId);
  });
});
