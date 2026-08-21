import { describe, expect, it, vi } from 'vitest';

import {
  ProjectionBatchError,
  ProjectionOutboxConsumer,
  type ProjectionEvent,
  type ProjectionKind,
  type ProjectionOutboxRepository,
  type ProjectionScope,
  type ProjectionState,
  type ProjectionTarget,
} from '../../../src/projections/outbox/index.js';

const scope: ProjectionScope = {
  tenantId: '71000000-0000-4000-8000-000000000001',
  projectId: '71000000-0000-4000-8000-000000000002',
  maxSecurityLevel: 'L3_CONFIDENTIAL',
  policyVersion: 7,
};

function event(sequence: number): ProjectionEvent {
  const suffix = String(sequence).padStart(12, '0');
  return Object.freeze({
    outboxEventId: String(sequence),
    eventId: `71000000-0000-4000-8000-${suffix}`,
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    dataItemId: `72000000-0000-4000-8000-${suffix}`,
    versionId: `73000000-0000-4000-8000-${suffix}`,
    eventType: 'data.version.committed',
    idempotencyKey: `version-${sequence}:committed`,
    securityLevel: 'L2_RESTRICTED',
    policyVersion: scope.policyVersion,
    payload: Object.freeze({ sequence }),
    createdAt: `2026-08-22T03:00:0${sequence}.000Z`,
  });
}

class MemoryProjectionRepository implements ProjectionOutboxRepository {
  readonly events = [event(1), event(2)];
  readonly states = new Map<string, ProjectionState>();
  readonly failures: Array<{
    readonly eventId: string;
    readonly kind: ProjectionKind;
    readonly category: string;
  }> = [];
  checkpoint = 0;

  readBatch(
    requestedScope: ProjectionScope,
    consumerName: string,
    limit: number,
  ): Promise<readonly ProjectionEvent[]> {
    expect(requestedScope).toEqual(scope);
    expect(consumerName).toBe('projection-worker-v1');
    return Promise.resolve(
      this.events.filter(
        ({ outboxEventId }) => Number(outboxEventId) > this.checkpoint,
      ).slice(0, limit),
    );
  }

  prepare(
    projectionEvent: ProjectionEvent,
    kinds: readonly ProjectionKind[],
  ): Promise<ReadonlyMap<ProjectionKind, ProjectionState>> {
    return Promise.resolve(
      new Map(
        kinds.map((kind) => [
          kind,
          this.states.get(`${projectionEvent.eventId}:${kind}`) ?? 'PENDING',
        ]),
      ),
    );
  }

  markRunning(
    projectionEvent: ProjectionEvent,
    kind: ProjectionKind,
  ): Promise<void> {
    this.states.set(`${projectionEvent.eventId}:${kind}`, 'RUNNING');
    return Promise.resolve();
  }

  markSucceeded(
    projectionEvent: ProjectionEvent,
    kind: ProjectionKind,
  ): Promise<void> {
    this.states.set(`${projectionEvent.eventId}:${kind}`, 'SUCCEEDED');
    return Promise.resolve();
  }

  markFailed(
    projectionEvent: ProjectionEvent,
    kind: ProjectionKind,
    category: string,
  ): Promise<void> {
    this.states.set(`${projectionEvent.eventId}:${kind}`, 'FAILED');
    this.failures.push({ eventId: projectionEvent.eventId, kind, category });
    return Promise.resolve();
  }

  advanceCheckpoint(
    requestedScope: ProjectionScope,
    consumerName: string,
    projectionEvent: ProjectionEvent,
  ): Promise<void> {
    expect(requestedScope).toEqual(scope);
    expect(consumerName).toBe('projection-worker-v1');
    this.checkpoint = Number(projectionEvent.outboxEventId);
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

describe('at-least-once projection outbox consumer', () => {
  it('persists target progress, skips succeeded targets, and checkpoints only complete events', async () => {
    const repository = new MemoryProjectionRepository();
    let graphUnavailable = true;
    const vectorProject = vi.fn(() => Promise.resolve());
    const graphProject = vi.fn(() => {
      if (graphUnavailable) {
        return Promise.reject(
          new Error('neo4j password=must-never-enter-the-ledger'),
        );
      }
      return Promise.resolve();
    });
    const targets: readonly ProjectionTarget[] = [
      { kind: 'WEAVIATE', project: vectorProject },
      { kind: 'NEO4J', project: graphProject },
    ];
    const consumer = new ProjectionOutboxConsumer({
      repository,
      targets,
      consumerName: 'projection-worker-v1',
    });

    await expect(consumer.processBatch(scope, 2)).rejects.toMatchObject({
      name: 'ProjectionBatchError',
      eventId: repository.events[0]?.eventId,
      failedKinds: ['NEO4J'],
    });
    expect(repository.checkpoint).toBe(0);
    expect(repository.events[1]).toBeDefined();
    expect(vectorProject).toHaveBeenCalledOnce();
    expect(graphProject).toHaveBeenCalledOnce();
    expect(repository.failures).toEqual([
      {
        eventId: repository.events[0]?.eventId,
        kind: 'NEO4J',
        category: 'PROJECTION_TARGET_FAILED',
      },
    ]);
    expect(JSON.stringify(repository.failures)).not.toContain('password');

    graphUnavailable = false;
    await expect(consumer.processBatch(scope, 2)).resolves.toEqual({
      readEvents: 2,
      checkpointedEvents: 2,
      attemptedTargets: 3,
      skippedTargets: 1,
    });
    expect(repository.checkpoint).toBe(2);
    expect(vectorProject).toHaveBeenCalledTimes(2);
    expect(graphProject).toHaveBeenCalledTimes(3);
    await expect(consumer.processBatch(scope, 2)).resolves.toEqual({
      readEvents: 0,
      checkpointedEvents: 0,
      attemptedTargets: 0,
      skippedTargets: 0,
    });
  });

  it('rejects duplicate target kinds and invalid consumer configuration', () => {
    const repository = new MemoryProjectionRepository();
    const target: ProjectionTarget = {
      kind: 'STAC',
      project: () => Promise.resolve(),
    };

    expect(
      () =>
        new ProjectionOutboxConsumer({
          repository,
          targets: [target, target],
          consumerName: 'projection-worker-v1',
        }),
    ).toThrow('Duplicate projection target STAC');
    expect(
      () =>
        new ProjectionOutboxConsumer({
          repository,
          targets: [target],
          consumerName: '',
        }),
    ).toThrow('consumerName');
    expect(() => new ProjectionBatchError(event(1), [])).toThrow(
      'failedKinds',
    );
  });
});
