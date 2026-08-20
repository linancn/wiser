import {
  evaluateWaterAllocationPlan,
  type EvaluationResult,
} from '@agent-excon/core';

import { toLogFields } from './logger.js';
import type {
  ClaimedEvaluationJob,
  EvaluationInput,
  EvaluationRepository,
  StructuredLogger,
  WorkerHealth,
  WorkerPhase,
} from './types.js';
import { WorkerError } from './types.js';

export interface EvaluationWorkerOptions {
  readonly repository: EvaluationRepository;
  readonly logger: StructuredLogger;
  readonly workerId: string;
  readonly claimLimit: number;
  readonly leaseMs: number;
  readonly pollIntervalMs: number;
  readonly evaluator?: (input: EvaluationInput) => EvaluationResult;
  readonly now?: () => Date;
}

function errorCode(error: unknown): string {
  if (error instanceof WorkerError) return error.code;
  if (
    error instanceof Error &&
    /invalid.*evaluation.*input/i.test(error.message)
  ) {
    return 'INVALID_EVALUATION_INPUT';
  }
  return 'EVALUATION_FAILED';
}

export class EvaluationWorker {
  private readonly repository: EvaluationRepository;
  private readonly logger: StructuredLogger;
  private readonly workerId: string;
  private readonly claimLimit: number;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly evaluator: (input: EvaluationInput) => EvaluationResult;
  private readonly now: () => Date;
  private phase: WorkerPhase = 'idle';
  private startedAt: string | null = null;
  private lastPollAt: string | null = null;
  private lastSuccessfulPollAt: string | null = null;
  private lastCompletedAt: string | null = null;
  private lastErrorAt: string | null = null;
  private lastErrorCode: string | null = null;
  private consecutivePollFailures = 0;
  private claimedJobs = 0;
  private completedJobs = 0;
  private failedJobs = 0;
  private recoveredLeases = 0;
  private readonly inFlight = new Set<Promise<void>>();
  private wakePoll: (() => void) | undefined;
  private stopping: Promise<void> | undefined;

  constructor(options: EvaluationWorkerOptions) {
    if (options.workerId.trim().length === 0) {
      throw new WorkerError('INVALID_WORKER_CONFIG', 'workerId is required.');
    }
    if (
      !Number.isInteger(options.claimLimit) ||
      options.claimLimit < 1 ||
      options.claimLimit > 100 ||
      !Number.isFinite(options.leaseMs) ||
      options.leaseMs <= 0 ||
      !Number.isFinite(options.pollIntervalMs) ||
      options.pollIntervalMs < 0
    ) {
      throw new WorkerError(
        'INVALID_WORKER_CONFIG',
        'claimLimit, leaseMs, or pollIntervalMs is invalid.',
      );
    }
    this.repository = options.repository;
    this.logger = options.logger;
    this.workerId = options.workerId;
    this.claimLimit = options.claimLimit;
    this.leaseMs = options.leaseMs;
    this.pollIntervalMs = options.pollIntervalMs;
    this.evaluator = options.evaluator ?? evaluateWaterAllocationPlan;
    this.now = options.now ?? (() => new Date());
  }

  health(): WorkerHealth {
    return {
      live: this.phase !== 'stopped',
      ready:
        this.phase === 'running' &&
        this.lastSuccessfulPollAt !== null &&
        this.consecutivePollFailures < 3,
      phase: this.phase,
      workerId: this.workerId,
      startedAt: this.startedAt,
      lastPollAt: this.lastPollAt,
      lastSuccessfulPollAt: this.lastSuccessfulPollAt,
      lastCompletedAt: this.lastCompletedAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorCode: this.lastErrorCode,
      consecutivePollFailures: this.consecutivePollFailures,
      inFlightJobs: this.inFlight.size,
      claimedJobs: this.claimedJobs,
      completedJobs: this.completedJobs,
      failedJobs: this.failedJobs,
      recoveredLeases: this.recoveredLeases,
    };
  }

  async processOnce(): Promise<number> {
    this.startIfIdle();
    if (this.phase !== 'running') return 0;
    this.lastPollAt = this.timestamp();
    try {
      const recovered = await this.repository.recoverExpiredLeases();
      this.recoveredLeases += recovered;
      if (recovered > 0) {
        this.logger.warn('evaluation_leases_recovered', {
          workerId: this.workerId,
          count: recovered,
        });
      }
      if (this.phase !== 'running') return 0;
      const jobs = await this.repository.claim(
        this.workerId,
        this.claimLimit,
        this.leaseMs,
      );
      this.claimedJobs += jobs.length;
      const pending = jobs.map((job) => this.track(this.processJob(job)));
      await Promise.all(pending);
      this.lastSuccessfulPollAt = this.timestamp();
      this.consecutivePollFailures = 0;
      return jobs.length;
    } catch (error) {
      this.consecutivePollFailures += 1;
      this.recordError('POLL_FAILED');
      this.logger.error('evaluation_poll_failed', {
        workerId: this.workerId,
        ...toLogFields(error),
      });
      throw error;
    }
  }

  async run(): Promise<void> {
    this.startIfIdle();
    while (this.phase === 'running') {
      try {
        await this.processOnce();
      } catch {
        // Health and structured logs are updated by processOnce; polling continues.
      }
      if (this.phase === 'running') await this.waitForNextPoll();
    }
  }

  stop(): Promise<void> {
    if (this.stopping !== undefined) return this.stopping;
    this.stopping = this.performStop();
    return this.stopping;
  }

  private startIfIdle(): void {
    if (this.phase !== 'idle') return;
    this.phase = 'running';
    this.startedAt = this.timestamp();
    this.logger.info('evaluation_worker_started', {
      workerId: this.workerId,
      claimLimit: this.claimLimit,
      leaseMs: this.leaseMs,
    });
  }

  private async processJob(job: ClaimedEvaluationJob): Promise<void> {
    this.logger.info('evaluation_job_started', {
      workerId: this.workerId,
      jobId: job.id,
      episodeId: job.episodeId,
      submissionId: job.submissionId,
      attempt: job.attempts,
    });
    try {
      const item = await this.repository.load(job);
      // The pure evaluator deliberately runs outside the completion transaction.
      const result = this.evaluator(item.input);
      await this.repository.complete(this.workerId, item, result);
      this.completedJobs += 1;
      this.lastCompletedAt = this.timestamp();
      this.logger.info('evaluation_job_completed', {
        workerId: this.workerId,
        jobId: job.id,
        verdict: result.verdict,
        totalScore: result.metrics.totalScore,
      });
    } catch (error) {
      const code = errorCode(error);
      this.failedJobs += 1;
      this.recordError(code);
      try {
        const disposition = await this.repository.fail(
          this.workerId,
          job,
          code,
        );
        this.logger.error('evaluation_job_failed', {
          workerId: this.workerId,
          jobId: job.id,
          errorCode: code,
          disposition,
          ...toLogFields(error),
        });
      } catch (failureError) {
        this.logger.error('evaluation_retry_update_failed', {
          workerId: this.workerId,
          jobId: job.id,
          errorCode: code,
          ...toLogFields(failureError),
        });
      }
    }
  }

  private track(promise: Promise<void>): Promise<void> {
    this.inFlight.add(promise);
    void promise.finally(() => {
      this.inFlight.delete(promise);
    });
    return promise;
  }

  private async performStop(): Promise<void> {
    if (this.phase === 'stopped') return;
    this.phase = 'draining';
    this.wakePoll?.();
    this.wakePoll = undefined;
    this.logger.info('evaluation_worker_draining', {
      workerId: this.workerId,
      inFlightJobs: this.inFlight.size,
    });
    await Promise.allSettled([...this.inFlight]);
    await this.repository.close();
    this.phase = 'stopped';
    this.logger.info('evaluation_worker_stopped', { workerId: this.workerId });
  }

  private waitForNextPoll(): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.wakePoll = undefined;
        resolve();
      }, this.pollIntervalMs);
      this.wakePoll = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  }

  private recordError(code: string): void {
    this.lastErrorAt = this.timestamp();
    this.lastErrorCode = code;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
