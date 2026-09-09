import { expect, it, vi } from 'vitest';
import {
  PROJECTION_KINDS,
  type EmbeddingModelIdentity,
  type ProjectionEvent,
  type ProjectionKind,
  type ProjectionOutboxRepository,
  type ProjectionScope,
  type ProjectionState,
} from '@wiser/data-infra';
import { createProfiledProjectionConsumer } from '../src/runtime/projection-profile.js';

const scope: ProjectionScope = {
  tenantId: '51000000-0000-4000-8000-000000000001',
  projectId: '51000000-0000-4000-8000-000000000002',
  maxSecurityLevel: 'L3_CONFIDENTIAL',
  policyVersion: 1,
};
const fake: EmbeddingModelIdentity = {
  provider: 'fake',
  model: 'deterministic-fake',
  version: '1.0.0-fixture',
  dimensions: 32,
};
const qwen: EmbeddingModelIdentity = {
  provider: 'openai-compatible',
  model: 'Qwen/Qwen3-Embedding-8B',
  version: '1.0.0-qwen3',
  dimensions: 4096,
};
const consumerName = 'data-worker-projection-v1';
function event(id: number): ProjectionEvent {
  return {
    ...scope,
    outboxEventId: String(id),
    eventId: `51000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    dataItemId: '51000000-0000-4000-8000-000000000004',
    versionId: `52000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    eventType: 'data.version.committed',
    idempotencyKey: `data.version.committed:${id}`,
    securityLevel: 'L2_RESTRICTED',
    payload: {},
    createdAt: '2026-09-09T00:00:00Z',
  };
}
class MemoryRepository implements ProjectionOutboxRepository {
  readonly events = [event(1), event(2)];
  readonly checkpoints = new Map([[consumerName, 2]]);
  readonly states = new Map<string, ProjectionState>();
  readBatch(_scope: ProjectionScope, name: string, limit: number) {
    return Promise.resolve(
      this.events
        .filter(
          (item) =>
            Number(item.outboxEventId) > (this.checkpoints.get(name) ?? 0),
        )
        .slice(0, limit),
    );
  }
  prepare(item: ProjectionEvent, kinds: readonly ProjectionKind[]) {
    return Promise.resolve(
      new Map(
        kinds.map((kind) => [
          kind,
          this.states.get(`${item.outboxEventId}:${kind}`) ?? 'SUCCEEDED',
        ]),
      ),
    );
  }
  markRunning(item: ProjectionEvent, kind: ProjectionKind) {
    this.states.set(`${item.outboxEventId}:${kind}`, 'RUNNING');
    return Promise.resolve();
  }
  markSucceeded(item: ProjectionEvent, kind: ProjectionKind) {
    this.states.set(`${item.outboxEventId}:${kind}`, 'SUCCEEDED');
    return Promise.resolve();
  }
  markFailed(item: ProjectionEvent, kind: ProjectionKind) {
    this.states.set(`${item.outboxEventId}:${kind}`, 'FAILED');
    return Promise.resolve();
  }
  advanceCheckpoint(
    _scope: ProjectionScope,
    name: string,
    item: ProjectionEvent,
  ) {
    this.checkpoints.set(name, Number(item.outboxEventId));
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}
function consumer(repository: MemoryRepository, model = qwen) {
  const vector = vi.fn((_event: ProjectionEvent) => Promise.resolve());
  const other = vi.fn(() => Promise.resolve());
  const publish = vi.fn(() => Promise.resolve('PUBLISHED' as const));
  return {
    vector,
    other,
    publish,
    worker: createProfiledProjectionConsumer({
      repository,
      consumerName,
      embeddingModel: model,
      publication: {
        publish,
        isPublished: () => Promise.resolve(true),
        close: () => Promise.resolve(),
      },
      targets: PROJECTION_KINDS.map((kind) => ({
        kind,
        project: kind === 'WEAVIATE' ? vector : other,
      })),
    }),
  };
}

it('catches cutover-window events despite the old checkpoint and successful shared ledgers', async () => {
  const repository = new MemoryRepository();
  // The rebuild saw event 1; the old live worker then published event 2.
  const indexed = new Set(['1']);
  const next = consumer(repository);
  next.vector.mockImplementation((item) => {
    indexed.add(item.outboxEventId);
    return Promise.resolve();
  });
  await next.worker.processBatch(scope, 10);
  expect([...indexed]).toEqual(['1', '2']);
  expect(next.other).not.toHaveBeenCalled();
  expect(repository.checkpoints.get(consumerName)).toBe(2);
  const restarted = consumer(repository);
  expect((await restarted.worker.processBatch(scope, 10)).readEvents).toBe(0);
  expect(restarted.vector).not.toHaveBeenCalled();
});

it('replays new-model events into the old collection on rollback without repeating other projections', async () => {
  const repository = new MemoryRepository();
  await consumer(repository).worker.processBatch(scope, 10);
  repository.events.push(event(3));
  await consumer(repository).worker.processBatch(scope, 10);
  const rollback = consumer(repository, fake);
  await rollback.worker.processBatch(scope, 10);
  expect(
    rollback.vector.mock.calls.map(([item]) => item.outboxEventId),
  ).toEqual(['3']);
  expect(rollback.other).not.toHaveBeenCalled();
});

it('keeps failed profile writes retryable across restart and separates later model revisions', async () => {
  const repository = new MemoryRepository();
  const first = consumer(repository);
  first.vector.mockImplementation((item) =>
    item.outboxEventId === '2'
      ? Promise.reject(new Error('unavailable'))
      : Promise.resolve(),
  );
  await expect(first.worker.processBatch(scope, 10)).rejects.toThrow();
  expect(first.publish).toHaveBeenCalledTimes(1);
  const restarted = consumer(repository);
  await restarted.worker.processBatch(scope, 10);
  expect(
    restarted.vector.mock.calls.map(([item]) => item.outboxEventId),
  ).toEqual(['2']);
  const revision = consumer(repository, { ...qwen, version: '2.0.0' });
  await revision.worker.processBatch(scope, 10);
  expect(
    revision.vector.mock.calls.map(([item]) => item.outboxEventId),
  ).toEqual(['1', '2']);
});
