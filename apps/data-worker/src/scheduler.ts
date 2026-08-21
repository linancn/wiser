import {
  JobLeaseLostError,
  type ClaimedDataJob,
  type DataJobFailure,
  type DataJobLease,
  type DataJobLifecycleResult,
  type DataJobRepository,
  type DataJobScope,
  type DataJobSettlement,
} from '@wiser/data-infra';

import {
  DataJobHandlerError,
  type StaticJobHandlerRegistry,
} from './handlers/registry.js';

export interface DataWorkerLogger {
  info(event: string, context?: Readonly<Record<string, unknown>>): void;
  warn(event: string, context?: Readonly<Record<string, unknown>>): void;
  error(event: string, context?: Readonly<Record<string, unknown>>): void;
}

export interface DataWorkerHealth {
  readonly live: boolean;
  readonly ready: boolean;
  readonly phase: 'idle' | 'running' | 'draining' | 'stopped';
  readonly inFlightJobs: number;
  readonly claimedJobs: number;
  readonly succeededJobs: number;
  readonly retriedJobs: number;
  readonly deadLetterJobs: number;
  readonly cancelledJobs: number;
  readonly waitingInputJobs: number;
  readonly waitingReviewJobs: number;
  readonly recoveredJobs: number;
}

export interface DataWorkerSchedulerOptions {
  readonly repository: DataJobRepository;
  readonly handlers: StaticJobHandlerRegistry;
  readonly logger: DataWorkerLogger;
  readonly scope: DataJobScope;
  readonly workerId: string;
  readonly claimLimit: number;
  readonly leaseMs: number;
  readonly heartbeatIntervalMs: number;
  readonly pollIntervalMs: number;
  readonly now?: () => Date;
}

function safeMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 2_048)
    : 'Unknown error';
}

function leaseOf(job: ClaimedDataJob): DataJobLease {
  return {
    jobId: job.jobId,
    workerId: job.leaseOwner,
    rowVersion: job.rowVersion,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

export class DataWorkerScheduler {
  readonly #repository: DataJobRepository;
  readonly #handlers: StaticJobHandlerRegistry;
  readonly #logger: DataWorkerLogger;
  readonly #scope: DataJobScope;
  readonly #workerId: string;
  readonly #claimLimit: number;
  readonly #leaseMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #pollIntervalMs: number;
  readonly #now: () => Date;
  readonly #inFlight = new Set<Promise<void>>();

  #phase: DataWorkerHealth['phase'] = 'idle';
  #ready = false;
  #stopPromise: Promise<void> | null = null;
  #claimedJobs = 0;
  #succeededJobs = 0;
  #retriedJobs = 0;
  #deadLetterJobs = 0;
  #cancelledJobs = 0;
  #waitingInputJobs = 0;
  #waitingReviewJobs = 0;
  #recoveredJobs = 0;

  constructor(options: DataWorkerSchedulerOptions) {
    if (
      options.workerId.length === 0 ||
      options.claimLimit < 1 ||
      options.leaseMs < 1 ||
      options.heartbeatIntervalMs < 1 ||
      options.pollIntervalMs < 1
    ) {
      throw new Error('Invalid Data Worker scheduler configuration.');
    }
    this.#repository = options.repository;
    this.#handlers = options.handlers;
    this.#logger = options.logger;
    this.#scope = options.scope;
    this.#workerId = options.workerId;
    this.#claimLimit = options.claimLimit;
    this.#leaseMs = options.leaseMs;
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs;
    this.#pollIntervalMs = options.pollIntervalMs;
    this.#now = options.now ?? (() => new Date());
  }

  #observedAt(): string {
    const now = this.#now();
    if (!Number.isFinite(now.valueOf())) {
      throw new Error('Data Worker clock returned an invalid timestamp.');
    }
    return now.toISOString();
  }

  async processOnce(): Promise<number> {
    if (this.#phase === 'draining' || this.#phase === 'stopped') return 0;
    this.#phase = 'running';
    const observedAt = this.#observedAt();
    const recovered = await this.#repository.recoverTimedOut(
      this.#scope,
      observedAt,
    );
    this.#recordRecovered(recovered);
    const jobs = await this.#repository.claim(
      this.#scope,
      this.#workerId,
      this.#claimLimit,
      this.#leaseMs,
      observedAt,
    );
    this.#ready = true;
    this.#claimedJobs += jobs.length;

    const processing = jobs.map((job) => this.#track(job));
    await Promise.all(processing);
    return jobs.length;
  }

  async start(signal?: AbortSignal): Promise<void> {
    while (
      this.#phase !== 'draining' &&
      this.#phase !== 'stopped' &&
      signal?.aborted !== true
    ) {
      try {
        const processed = await this.processOnce();
        if (processed === 0) await delay(this.#pollIntervalMs);
      } catch (error) {
        this.#ready = false;
        this.#logger.error('data_worker_poll_failed', {
          message: safeMessage(error),
        });
        await delay(this.#pollIntervalMs);
      }
    }
  }

  stop(): Promise<void> {
    if (this.#stopPromise !== null) return this.#stopPromise;
    this.#phase = 'draining';
    this.#ready = false;
    this.#stopPromise = (async () => {
      await Promise.all([...this.#inFlight]);
      await this.#repository.close();
      this.#phase = 'stopped';
    })();
    return this.#stopPromise;
  }

  health(): DataWorkerHealth {
    return Object.freeze({
      live: this.#phase !== 'stopped',
      ready: this.#ready && this.#phase === 'running',
      phase: this.#phase,
      inFlightJobs: this.#inFlight.size,
      claimedJobs: this.#claimedJobs,
      succeededJobs: this.#succeededJobs,
      retriedJobs: this.#retriedJobs,
      deadLetterJobs: this.#deadLetterJobs,
      cancelledJobs: this.#cancelledJobs,
      waitingInputJobs: this.#waitingInputJobs,
      waitingReviewJobs: this.#waitingReviewJobs,
      recoveredJobs: this.#recoveredJobs,
    });
  }

  prometheusMetrics(): string {
    const health = this.health();
    return [
      `wiser_data_worker_jobs_claimed_total ${health.claimedJobs}`,
      `wiser_data_worker_jobs_succeeded_total ${health.succeededJobs}`,
      `wiser_data_worker_jobs_retried_total ${health.retriedJobs}`,
      `wiser_data_worker_jobs_dead_letter_total ${health.deadLetterJobs}`,
      `wiser_data_worker_jobs_cancelled_total ${health.cancelledJobs}`,
      `wiser_data_worker_jobs_waiting_input_total ${health.waitingInputJobs}`,
      `wiser_data_worker_jobs_waiting_review_total ${health.waitingReviewJobs}`,
      `wiser_data_worker_jobs_recovered_total ${health.recoveredJobs}`,
      `wiser_data_worker_inflight_jobs ${health.inFlightJobs}`,
      `wiser_data_worker_ready ${health.ready ? 1 : 0}`,
      '',
    ].join('\n');
  }

  #track(job: ClaimedDataJob): Promise<void> {
    const work = this.#processJob(job).finally(() => {
      this.#inFlight.delete(work);
    });
    this.#inFlight.add(work);
    return work;
  }

  async #processJob(job: ClaimedDataJob): Promise<void> {
    let lease = leaseOf(job);
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void this.#repository
        .heartbeat(this.#scope, lease, this.#leaseMs, this.#observedAt())
        .then((renewed) => {
          lease = leaseOf(renewed);
        })
        .catch((error: unknown) => {
          this.#logger.warn('data_worker_heartbeat_failed', {
            category:
              error instanceof JobLeaseLostError
                ? 'LEASE_LOST'
                : 'HEARTBEAT_FAILED',
          });
        })
        .finally(() => {
          heartbeatRunning = false;
        });
    }, this.#heartbeatIntervalMs);
    heartbeat.unref();

    try {
      if (job.cancelRequested) {
        await this.#settle(lease, { status: 'CANCELLED' });
        return;
      }
      const handler = this.#handlers.resolve(job.jobType);
      if (handler === undefined) {
        await this.#fail(lease, {
          category: 'UNSUPPORTED_JOB_TYPE',
          retryable: false,
          detail: { jobType: job.jobType },
        });
        return;
      }
      const result = await handler(job);
      await this.#settle(lease, result);
    } catch (error) {
      if (error instanceof JobLeaseLostError) {
        this.#logger.warn('data_worker_job_lease_lost');
        return;
      }
      const failure: DataJobFailure =
        error instanceof DataJobHandlerError
          ? {
              category: error.category,
              retryable: error.retryable,
              detail: { message: safeMessage(error) },
            }
          : {
              category: 'HANDLER_UNEXPECTED',
              retryable: true,
              detail: { message: safeMessage(error) },
            };
      await this.#fail(lease, failure);
    } finally {
      clearInterval(heartbeat);
    }
  }

  async #settle(
    lease: DataJobLease,
    settlement: DataJobSettlement,
  ): Promise<void> {
    const result = await this.#repository.settle(
      this.#scope,
      lease,
      settlement,
      this.#observedAt(),
    );
    switch (result.status) {
      case 'SUCCEEDED':
        this.#succeededJobs += 1;
        break;
      case 'WAITING_INPUT':
        this.#waitingInputJobs += 1;
        break;
      case 'WAITING_REVIEW':
        this.#waitingReviewJobs += 1;
        break;
      case 'CANCELLED':
        this.#cancelledJobs += 1;
        break;
    }
  }

  async #fail(lease: DataJobLease, failure: DataJobFailure): Promise<void> {
    const result = await this.#repository.fail(
      this.#scope,
      lease,
      failure,
      this.#observedAt(),
    );
    if (result.status === 'RETRY_SCHEDULED') this.#retriedJobs += 1;
    if (result.status === 'DEAD_LETTER') this.#deadLetterJobs += 1;
  }

  #recordRecovered(results: readonly DataJobLifecycleResult[]): void {
    this.#recoveredJobs += results.length;
    for (const result of results) {
      if (result.status === 'RETRY_SCHEDULED') this.#retriedJobs += 1;
      if (result.status === 'DEAD_LETTER') this.#deadLetterJobs += 1;
      if (result.status === 'CANCELLED') this.#cancelledJobs += 1;
    }
  }
}
