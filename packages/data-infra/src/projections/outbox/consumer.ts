import {
  PROJECTION_KINDS,
  type ProjectionBatchResult,
  type ProjectionEvent,
  type ProjectionKind,
  type ProjectionOutboxRepository,
  type ProjectionScope,
  type ProjectionSecurityLevel,
  type ProjectionState,
  type ProjectionTarget,
} from './types.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONSUMER_NAME_PATTERN = /^[a-z][a-z0-9._:-]{2,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const FAILURE_CATEGORY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const projectionKindSet = new Set<ProjectionKind>(PROJECTION_KINDS);
const projectionStateSet = new Set<ProjectionState>([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
]);
const securityRank: Readonly<Record<ProjectionSecurityLevel, number>> = {
  L0_PUBLIC: 0,
  L1_INTERNAL: 1,
  L2_RESTRICTED: 2,
  L3_CONFIDENTIAL: 3,
};

export class ProjectionTargetError extends Error {
  constructor(readonly category: string) {
    if (!FAILURE_CATEGORY_PATTERN.test(category)) {
      throw new Error('Projection target error category is invalid.');
    }
    super(`Projection target failed with category ${category}.`);
    this.name = 'ProjectionTargetError';
  }
}

export class ProjectionBatchError extends Error {
  readonly eventId: string;
  readonly failedKinds: readonly ProjectionKind[];

  constructor(event: ProjectionEvent, failedKinds: readonly ProjectionKind[]) {
    if (failedKinds.length === 0) {
      throw new Error('ProjectionBatchError requires failedKinds.');
    }
    super(
      `Projection event ${event.eventId} failed for ${failedKinds.join(', ')}.`,
    );
    this.name = 'ProjectionBatchError';
    this.eventId = event.eventId;
    this.failedKinds = Object.freeze([...failedKinds]);
  }
}

export interface ProjectionOutboxConsumerOptions {
  readonly repository: ProjectionOutboxRepository;
  readonly targets: readonly ProjectionTarget[];
  readonly consumerName: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertScope(scope: ProjectionScope): void {
  if (
    !UUID_PATTERN.test(scope.tenantId) ||
    !UUID_PATTERN.test(scope.projectId) ||
    !Number.isSafeInteger(scope.policyVersion) ||
    scope.policyVersion < 1 ||
    securityRank[scope.maxSecurityLevel] === undefined
  ) {
    throw new Error('Projection scope is invalid.');
  }
}

function assertEvent(event: ProjectionEvent, scope: ProjectionScope): void {
  if (
    !/^\d+$/.test(event.outboxEventId) ||
    BigInt(event.outboxEventId) < 1n ||
    !UUID_PATTERN.test(event.eventId) ||
    !UUID_PATTERN.test(event.dataItemId) ||
    !UUID_PATTERN.test(event.versionId) ||
    event.tenantId !== scope.tenantId ||
    event.projectId !== scope.projectId ||
    event.eventType !== 'data.version.committed' ||
    !IDEMPOTENCY_KEY_PATTERN.test(event.idempotencyKey) ||
    event.policyVersion !== scope.policyVersion ||
    securityRank[event.securityLevel] === undefined ||
    securityRank[event.securityLevel] > securityRank[scope.maxSecurityLevel] ||
    !isRecord(event.payload) ||
    !Number.isFinite(Date.parse(event.createdAt))
  ) {
    throw new Error('Projection outbox event violates its security contract.');
  }
}

function failureCategory(error: unknown): string {
  return error instanceof ProjectionTargetError
    ? error.category
    : 'PROJECTION_TARGET_FAILED';
}

export class ProjectionOutboxConsumer {
  readonly #repository: ProjectionOutboxRepository;
  readonly #targets: readonly ProjectionTarget[];
  readonly #kinds: readonly ProjectionKind[];
  readonly #consumerName: string;

  constructor(options: ProjectionOutboxConsumerOptions) {
    if (!CONSUMER_NAME_PATTERN.test(options.consumerName)) {
      throw new Error('Projection consumerName is invalid.');
    }
    if (options.targets.length === 0) {
      throw new Error('At least one projection target is required.');
    }
    const kinds = new Set<ProjectionKind>();
    for (const target of options.targets) {
      if (!projectionKindSet.has(target.kind)) {
        throw new Error('Projection target kind is invalid.');
      }
      if (kinds.has(target.kind)) {
        throw new Error(`Duplicate projection target ${target.kind}.`);
      }
      kinds.add(target.kind);
    }
    this.#repository = options.repository;
    this.#targets = Object.freeze([...options.targets]);
    this.#kinds = Object.freeze(options.targets.map(({ kind }) => kind));
    this.#consumerName = options.consumerName;
  }

  async processBatch(
    scope: ProjectionScope,
    limit: number,
  ): Promise<ProjectionBatchResult> {
    assertScope(scope);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Projection batch limit must be from 1 to 100.');
    }
    const events = await this.#repository.readBatch(
      scope,
      this.#consumerName,
      limit,
    );
    let previousOutboxEventId = 0n;
    for (const event of events) {
      assertEvent(event, scope);
      const outboxEventId = BigInt(event.outboxEventId);
      if (outboxEventId <= previousOutboxEventId) {
        throw new Error('Projection outbox batch must be strictly ordered.');
      }
      previousOutboxEventId = outboxEventId;
    }

    let checkpointedEvents = 0;
    let attemptedTargets = 0;
    let skippedTargets = 0;
    for (const event of events) {
      const states = await this.#repository.prepare(event, this.#kinds);
      const failures: ProjectionKind[] = [];
      const pending: ProjectionTarget[] = [];
      for (const target of this.#targets) {
        const state = states.get(target.kind);
        if (state === undefined || !projectionStateSet.has(state)) {
          throw new Error(
            `Projection ledger omitted a valid ${target.kind} state.`,
          );
        }
        if (state === 'SUCCEEDED') {
          skippedTargets += 1;
        } else {
          pending.push(target);
        }
      }
      attemptedTargets += pending.length;
      const results = await Promise.all(
        pending.map(async (target) => {
          try {
            await this.#repository.markRunning(event, target.kind);
            await target.project(event);
            await this.#repository.markSucceeded(event, target.kind);
            return null;
          } catch (error) {
            try {
              await this.#repository.markFailed(
                event,
                target.kind,
                failureCategory(error),
              );
            } catch {
              // The event is intentionally not checkpointed. A later replay
              // invokes the idempotent target again and repairs the ledger.
            }
            return target.kind;
          }
        }),
      );
      for (const result of results) {
        if (result !== null) failures.push(result);
      }
      if (failures.length > 0) {
        throw new ProjectionBatchError(event, failures);
      }
      await this.#repository.advanceCheckpoint(
        scope,
        this.#consumerName,
        event,
      );
      checkpointedEvents += 1;
    }

    return Object.freeze({
      readEvents: events.length,
      checkpointedEvents,
      attemptedTargets,
      skippedTargets,
    });
  }

  close(): Promise<void> {
    return this.#repository.close();
  }
}
