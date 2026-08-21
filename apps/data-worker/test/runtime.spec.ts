import { describe, expect, it, vi } from 'vitest';

import {
  DATA_INGESTION_PROCESS_JOB_TYPE,
  ProjectionOutboxConsumer,
  type ProjectionEvent,
  type ProjectionKind,
  type ProjectionOutboxRepository,
  type ProjectionScope,
  type ProjectionState,
  type ProjectionTarget,
} from '@wiser/data-infra';

import {
  DataWorkerRuntime,
  PublishingProjectionRepository,
  createDefaultHandlerRegistry,
  createProjectionAwareIngestionHandler,
  type ProjectionPublicationGate,
} from '../src/runtime.js';

const scope: ProjectionScope = {
  tenantId: '51000000-0000-4000-8000-000000000001',
  projectId: '51000000-0000-4000-8000-000000000002',
  maxSecurityLevel: 'L3_CONFIDENTIAL',
  policyVersion: 1,
};

const event: ProjectionEvent = {
  outboxEventId: '1',
  eventId: '51000000-0000-4000-8000-000000000003',
  tenantId: scope.tenantId,
  projectId: scope.projectId,
  dataItemId: '51000000-0000-4000-8000-000000000004',
  versionId: '51000000-0000-4000-8000-000000000005',
  eventType: 'data.version.committed',
  idempotencyKey: 'data.version.committed:runtime-fixture',
  securityLevel: 'L2_RESTRICTED',
  policyVersion: scope.policyVersion,
  payload: {},
  createdAt: '2026-08-22T04:00:00.000Z',
};

class MemoryRepository implements ProjectionOutboxRepository {
  readonly states = new Map<ProjectionKind, ProjectionState>();
  checkpoint = 0;

  readBatch(): Promise<readonly ProjectionEvent[]> {
    return Promise.resolve(this.checkpoint === 0 ? [event] : []);
  }
  prepare(
    _event: ProjectionEvent,
    kinds: readonly ProjectionKind[],
  ): Promise<ReadonlyMap<ProjectionKind, ProjectionState>> {
    return Promise.resolve(
      new Map(kinds.map((kind) => [kind, this.states.get(kind) ?? 'PENDING'])),
    );
  }
  markRunning(_event: ProjectionEvent, kind: ProjectionKind): Promise<void> {
    this.states.set(kind, 'RUNNING');
    return Promise.resolve();
  }
  markSucceeded(_event: ProjectionEvent, kind: ProjectionKind): Promise<void> {
    this.states.set(kind, 'SUCCEEDED');
    return Promise.resolve();
  }
  markFailed(_event: ProjectionEvent, kind: ProjectionKind): Promise<void> {
    this.states.set(kind, 'FAILED');
    return Promise.resolve();
  }
  advanceCheckpoint(): Promise<void> {
    this.checkpoint = 1;
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

describe('default Data Worker runtime', () => {
  it('always registers the static ingestion handler', () => {
    const handler = vi.fn(() =>
      Promise.resolve({ status: 'SUCCEEDED' as const }),
    );
    const registry = createDefaultHandlerRegistry(handler);
    expect(registry.jobTypes).toEqual([DATA_INGESTION_PROCESS_JOB_TYPE]);
    expect(registry.resolve(DATA_INGESTION_PROCESS_JOB_TYPE)).toBe(handler);
  });

  it('publishes only after all five ledgers succeed and retries publication without replaying targets', async () => {
    const delegate = new MemoryRepository();
    let unavailable = true;
    const gate: ProjectionPublicationGate = {
      publish: vi.fn(() => {
        if (unavailable) return Promise.reject(new Error('temporary'));
        return Promise.resolve();
      }),
      isPublished: () => Promise.resolve(false),
      close: () => Promise.resolve(),
    };
    const repository = new PublishingProjectionRepository(delegate, gate);
    const project = vi.fn(() => Promise.resolve());
    const targets: ProjectionTarget[] = [
      'POSTGIS',
      'WEAVIATE',
      'OPENSEARCH',
      'NEO4J',
      'STAC',
    ].map((kind) => ({ kind: kind as ProjectionKind, project }));
    const consumer = new ProjectionOutboxConsumer({
      repository,
      targets,
      consumerName: 'data-worker-projection-v1',
    });

    await expect(consumer.processBatch(scope, 1)).rejects.toThrow('temporary');
    expect(delegate.checkpoint).toBe(0);
    expect(project).toHaveBeenCalledTimes(5);

    unavailable = false;
    await expect(consumer.processBatch(scope, 1)).resolves.toMatchObject({
      checkpointedEvents: 1,
      attemptedTargets: 0,
      skippedTargets: 5,
    });
    expect(project).toHaveBeenCalledTimes(5);
    expect(delegate.checkpoint).toBe(1);
  });

  it('runs scheduler and projection loop together, then drains and closes both', async () => {
    const scheduler = {
      start: vi.fn(
        (signal?: AbortSignal) =>
          new Promise<void>((resolve) =>
            signal?.addEventListener('abort', () => resolve(), { once: true }),
          ),
      ),
      stop: vi.fn(() => Promise.resolve()),
    };
    const consumer = {
      processBatch: vi.fn(() => Promise.resolve({ readEvents: 0 })),
      close: vi.fn(() => Promise.resolve()),
    };
    const runtime = new DataWorkerRuntime({
      scheduler,
      projectionConsumer: consumer,
      projectionScope: scope,
      projectionBatchLimit: 8,
      projectionPollIntervalMs: 10,
      wait: (_milliseconds, signal) =>
        new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        ),
    });
    const abort = new AbortController();
    const started = runtime.start(abort.signal);
    await vi.waitFor(() => expect(consumer.processBatch).toHaveBeenCalled());
    abort.abort();
    await started;
    await runtime.stop();

    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(consumer.close).toHaveBeenCalledOnce();
  });

  it('keeps the ingestion job running until publication becomes authoritative', async () => {
    let checks = 0;
    let clock = 0;
    const gate: ProjectionPublicationGate = {
      publish: () => Promise.resolve(),
      isPublished: () => Promise.resolve(++checks >= 2),
      close: () => Promise.resolve(),
    };
    const handler = createProjectionAwareIngestionHandler({
      handler: () =>
        Promise.resolve({
          status: 'SUCCEEDED',
          result: {
            state: 'COMMITTED',
            versionId: event.versionId,
          },
        }),
      publication: gate,
      timeoutMs: 1_000,
      pollIntervalMs: 10,
      now: () => clock,
      wait: (milliseconds) => {
        clock += milliseconds;
        return Promise.resolve();
      },
    });
    await expect(
      handler({
        jobId: '51000000-0000-4000-8000-000000000006',
        tenantId: event.tenantId,
        projectId: event.projectId,
        operationId: '51000000-0000-4000-8000-000000000007',
        jobType: DATA_INGESTION_PROCESS_JOB_TYPE,
        payload: {},
        attemptCount: 1,
        maxAttempts: 5,
        leaseOwner: 'worker-a',
        leaseExpiresAt: '2026-08-22T05:02:00.000Z',
        rowVersion: 2,
        cancelRequested: false,
        securityLevel: event.securityLevel,
        policyVersion: event.policyVersion,
      }),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      result: { state: 'PUBLISHED', versionId: event.versionId },
    });
    expect(checks).toBe(2);
  });
});
