import type {
  ClaimedDataJob,
  ProjectionBatchResult,
  ProjectionEvent,
  ProjectionKind,
  ProjectionOutboxRepository,
  ProjectionScope,
  ProjectionState,
} from '@wiser/data-infra';

import { DATA_INGESTION_PROCESS_JOB_TYPE } from './handlers/ingestion-pipeline.js';
import {
  StaticJobHandlerRegistry as HandlerRegistry,
  type DataJobHandler,
  type DataJobHandlerResult,
  type StaticJobHandlerRegistry,
} from './handlers/registry.js';

export interface ProjectionPublicationGate {
  publish(event: ProjectionEvent): Promise<'PUBLISHED' | 'TERMINAL_OPERATION'>;
  isPublished(input: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly versionId: string;
    readonly securityLevel: ProjectionEvent['securityLevel'];
    readonly policyVersion: number;
  }): Promise<boolean>;
  close(): Promise<void>;
}

export class PublishingProjectionRepository implements ProjectionOutboxRepository {
  constructor(
    private readonly delegate: ProjectionOutboxRepository,
    private readonly publication: ProjectionPublicationGate,
  ) {}

  readBatch(
    scope: ProjectionScope,
    consumerName: string,
    limit: number,
  ): Promise<readonly ProjectionEvent[]> {
    return this.delegate.readBatch(scope, consumerName, limit);
  }

  prepare(
    event: ProjectionEvent,
    kinds: readonly ProjectionKind[],
  ): Promise<ReadonlyMap<ProjectionKind, ProjectionState>> {
    return this.delegate.prepare(event, kinds);
  }

  markRunning(event: ProjectionEvent, kind: ProjectionKind): Promise<void> {
    return this.delegate.markRunning(event, kind);
  }

  markSucceeded(event: ProjectionEvent, kind: ProjectionKind): Promise<void> {
    return this.delegate.markSucceeded(event, kind);
  }

  markFailed(
    event: ProjectionEvent,
    kind: ProjectionKind,
    category: string,
  ): Promise<void> {
    return this.delegate.markFailed(event, kind, category);
  }

  async advanceCheckpoint(
    scope: ProjectionScope,
    consumerName: string,
    event: ProjectionEvent,
  ): Promise<void> {
    const outcome = await this.publication.publish(event);
    await this.delegate.advanceCheckpoint(
      scope,
      consumerName,
      event,
      outcome === 'TERMINAL_OPERATION'
        ? 'PUBLICATION_OPERATION_TERMINAL'
        : undefined,
    );
  }

  close(): Promise<void> {
    return this.delegate.close();
  }
}

export function createDefaultHandlerRegistry(
  ingestionHandler: DataJobHandler,
): StaticJobHandlerRegistry {
  return new HandlerRegistry([
    { jobType: DATA_INGESTION_PROCESS_JOB_TYPE, handler: ingestionHandler },
  ]);
}

export interface RuntimeScheduler {
  start(signal?: AbortSignal): Promise<void>;
  stop(): Promise<void>;
}

export interface RuntimeProjectionConsumer {
  processBatch(
    scope: ProjectionScope,
    limit: number,
  ): Promise<Pick<ProjectionBatchResult, 'readEvents'>>;
  close(): Promise<void>;
}

export interface DataWorkerRuntimeOptions {
  readonly scheduler: RuntimeScheduler;
  readonly projectionConsumer: RuntimeProjectionConsumer;
  readonly projectionScope: ProjectionScope;
  readonly projectionBatchLimit: number;
  readonly projectionPollIntervalMs: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly onProjectionError?: (category: string) => void;
  readonly close?: readonly (() => Promise<void>)[];
}

function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    timer.unref();
    signal.addEventListener('abort', finish, { once: true });
  });
}

export class DataWorkerRuntime {
  readonly #scheduler: RuntimeScheduler;
  readonly #projectionConsumer: RuntimeProjectionConsumer;
  readonly #projectionScope: ProjectionScope;
  readonly #projectionBatchLimit: number;
  readonly #projectionPollIntervalMs: number;
  readonly #wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly #onProjectionError: (category: string) => void;
  readonly #close: readonly (() => Promise<void>)[];
  #stopPromise: Promise<void> | null = null;

  constructor(options: DataWorkerRuntimeOptions) {
    if (
      !Number.isSafeInteger(options.projectionBatchLimit) ||
      options.projectionBatchLimit < 1 ||
      options.projectionBatchLimit > 100 ||
      !Number.isSafeInteger(options.projectionPollIntervalMs) ||
      options.projectionPollIntervalMs < 1 ||
      options.projectionPollIntervalMs > 60_000
    ) {
      throw new Error('Invalid Data Worker projection runtime configuration.');
    }
    this.#scheduler = options.scheduler;
    this.#projectionConsumer = options.projectionConsumer;
    this.#projectionScope = options.projectionScope;
    this.#projectionBatchLimit = options.projectionBatchLimit;
    this.#projectionPollIntervalMs = options.projectionPollIntervalMs;
    this.#wait = options.wait ?? defaultWait;
    this.#onProjectionError = options.onProjectionError ?? (() => undefined);
    this.#close = Object.freeze([...(options.close ?? [])]);
  }

  async start(signal: AbortSignal): Promise<void> {
    const projectionAbort = new AbortController();
    const projectionLoop = this.#runProjectionLoop(projectionAbort.signal);
    try {
      await this.#scheduler.start(signal);
    } finally {
      projectionAbort.abort();
      await projectionLoop;
    }
  }

  stop(): Promise<void> {
    if (this.#stopPromise !== null) return this.#stopPromise;
    this.#stopPromise = (async () => {
      const results = await Promise.allSettled([
        this.#scheduler.stop(),
        this.#projectionConsumer.close(),
        ...this.#close.map((close) => close()),
      ]);
      if (results.some(({ status }) => status === 'rejected')) {
        throw new Error('Data Worker resources could not close cleanly.');
      }
    })();
    return this.#stopPromise;
  }

  async #runProjectionLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const result = await this.#projectionConsumer.processBatch(
          this.#projectionScope,
          this.#projectionBatchLimit,
        );
        if (result.readEvents === 0) {
          await this.#wait(this.#projectionPollIntervalMs, signal);
        }
      } catch {
        this.#onProjectionError('PROJECTION_BATCH_FAILED');
        await this.#wait(this.#projectionPollIntervalMs, signal);
      }
    }
  }
}

export interface ProjectionAwareHandlerOptions {
  readonly handler: DataJobHandler;
  readonly publication: ProjectionPublicationGate;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

export function createProjectionAwareIngestionHandler(
  options: ProjectionAwareHandlerOptions,
): DataJobHandler {
  const now = options.now ?? Date.now;
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, milliseconds);
        timer.unref();
      }));
  return async (job: ClaimedDataJob): Promise<DataJobHandlerResult> => {
    const result = await options.handler(job);
    const state = result.result?.['state'];
    const versionId = result.result?.['versionId'];
    if (
      result.status !== 'SUCCEEDED' ||
      state === 'PUBLISHED' ||
      (state !== 'COMMITTED' && state !== 'PROJECTING')
    ) {
      return result;
    }
    if (
      typeof job.tenantId !== 'string' ||
      typeof job.projectId !== 'string' ||
      typeof job.securityLevel !== 'string' ||
      typeof job.policyVersion !== 'number' ||
      typeof versionId !== 'string'
    ) {
      throw new Error('Projection-aware ingestion result is invalid.');
    }
    const deadline = now() + options.timeoutMs;
    while (now() <= deadline) {
      if (
        await options.publication.isPublished({
          tenantId: job.tenantId,
          projectId: job.projectId,
          versionId,
          securityLevel: job.securityLevel,
          policyVersion: job.policyVersion,
        })
      ) {
        return {
          ...result,
          result: Object.freeze({ ...result.result, state: 'PUBLISHED' }),
        };
      }
      await wait(options.pollIntervalMs);
    }
    throw new Error('Projection publication timed out safely.');
  };
}
